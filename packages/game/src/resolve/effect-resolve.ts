// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Task 67 — resolve-time decisions. A StackItem may carry a resolver
// whose `resolve(game)` generator yields decisions and events during
// resolution. After resolution:
//   - Emit StackItemResolved { stackItemId, fizzled }.
//   - For copies: cease (no zone-change on source — copies have no real
//     card to move per CR 111.7).
//   - For non-copies: move the source to its destination — Graveyard by
//     default for spells, or `provenance.alternativeZoneDestination` when
//     set (flashback → Exile, buyback → Hand, etc.).
//   - For activated / triggered ability items: the source card stays put.
//
// Triggered stack items re-check intervening-if at resolve time (CR 603.4).
// If the condition is now false, the trigger fizzles without running its
// body; still pops the stack slot and emits StackItemResolved(fizzled=true).
import type { EntityId, GameEvent, TriggeredAbility } from "@mtg-forge-ts/core";
import { CARD_TYPE_IS_PERMANENT, type CardType, ZoneType, mkEvent } from "@mtg-forge-ts/core";

// Wave 10 — set of CardTypes that classify as permanents (CR 110.4). Used
// in the spell-resolution path to route permanent spells to Battlefield
// (CR 608.3a) and non-permanent spells to Graveyard (CR 608.2g) when
// provenance.alternativeZoneDestination doesn't already pin a destination.
const PERMANENT_TYPES: ReadonlySet<CardType> = new Set(
  (Object.entries(CARD_TYPE_IS_PERMANENT) as readonly [CardType, boolean][])
    .filter(([, isPerm]) => isPerm)
    .map(([t]) => t),
);
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";
import type { StackItem, StackItemResolver } from "../stack/stack-item.js";
import { interveningIfStillTrue } from "../triggers/intervening-if.js";

// SP2 Task 78 (fix 5) — helper: pop the stack slot for `itemId`. Stack.pop()
// is unconditional (top-only), but the Stack may contain other items above
// the resolving one (ordinary spells/abilities added in-between by copies,
// cascade, etc.). We walk the items backwards to find the one with the
// matching id and remove it. For a CR-correct resolver this will always be
// the top item, but the id-based lookup makes the helper resilient to
// out-of-order drain paths SP3 may introduce.
const popStackItemById = (game: Game, itemId: EntityId): void => {
  const stack = game.sharedZones.stack;
  const arr = stack.toArray();
  // Happy path: the top matches.
  const top = stack.top();
  if (top?.id === itemId) {
    stack.pop();
    return;
  }
  // Fallback: rebuild the stack without the target id. Reuse push() so any
  // future Stack invariants (if added) are honored.
  const retained = arr.filter((it) => it.id !== itemId);
  if (retained.length === arr.length) {
    // Not on the stack — silent no-op (reached only when the stack item
    // was never pushed / already popped by an earlier path).
    return;
  }
  (stack as unknown as { items: StackItem[] }).items.length = 0;
  for (const it of retained) stack.push(it);
};

export function* resolveStackItem(game: Game, item: StackItem): Generator<EngineYield, void, unknown> {
  // CR 603.4 — intervening-if re-check for triggered abilities. Without
  // the stored event we can't evaluate; in that case we let the resolver
  // run (SP3 will carry the event forward at push time for all
  // triggered items — Task 67 accepts the optional field).
  if (item.kind === "triggeredAbility") {
    const storedEvent = item.event;
    const triggerId = item.triggerId;
    if (triggerId !== undefined && triggerId !== null && storedEvent !== undefined) {
      const trigger: TriggeredAbility | undefined = game.triggerRegistry.getTrigger(triggerId as EntityId);
      if (trigger && !interveningIfStillTrue(trigger, storedEvent as GameEvent, game)) {
        // Fizzle — no resolver, no zone-change. Still emits resolved event
        // so the stack-drain driver can pop the slot. SP2 Task 78 (fix 5):
        // pop the stack here too so the engine doesn't see a zombie fizzled
        // slot that every subsequent resolve attempt would misinterpret.
        popStackItemById(game, item.id);
        yield game.emitEvent(
          mkEvent("StackItemResolved", game.turn, game.phase, {
            stackItemId: item.id,
            fizzled: true,
          }),
        );
        return;
      }
    }
  }

  // Drive the resolver generator if present. We forward decisions +
  // events bidirectionally: the engine driver responds to yielded
  // decisions with a DecisionResponse, and we relay that back to the
  // resolver's next() call.
  if (item.resolver !== null && item.resolver !== undefined) {
    const resolver = item.resolver as StackItemResolver;
    const gen = resolver.resolve(game) as Generator<EngineYield, void, unknown>;
    let step = gen.next();
    while (!step.done) {
      const response = yield step.value;
      // Bidirectional generator bridging: forward whatever the outer
      // driver provided as a DecisionResponse back into the resolver's
      // pending yield. The response type is whatever the resolver's own
      // TNext is — `unknown` at this level, cast through the generator's
      // own next(): Generator<T, R, TNext>.
      step = (gen as Generator<EngineYield, void, unknown>).next(response);
    }
  }

  // SP2 Task 78 (fix 5): pop the resolved item off the stack BEFORE the
  // StackItemResolved event emits so triggers observing StackItemResolved
  // (and any downstream zone-change moveTo for the source card below) see
  // the post-resolution stack state. Previously resolveStackItem left the
  // resolved item on the stack, letting a subsequent resolve re-target it
  // and corrupt priority orchestration.
  popStackItemById(game, item.id);
  yield game.emitEvent(
    mkEvent("StackItemResolved", game.turn, game.phase, {
      stackItemId: item.id,
      fizzled: false,
    }),
  );

  // Post-resolution zone change for the source card. Spells go to the
  // graveyard (or the alternative destination if one was captured during
  // cast — flashback: Exile; Foretell-cast: Exile; buyback: Hand …).
  // Activated / triggered / copy items leave the source alone.
  switch (item.kind) {
    case "copy":
      // CR 111.7 — a copy of a spell ceases to exist when it resolves; no
      // card to move.
      return;
    case "spell": {
      // Wave 25 — Mutate (CR 702.139). A mutate spell merges with the
      // chosen target instead of entering the battlefield as a separate
      // permanent. The resolver yields a chooseMutateOrder decision so
      // the caster picks "top" (new card defines the merged permanent's
      // characteristics) or "bottom" (existing top stays). After the
      // decision, the new card is moved to the battlefield, the host's
      // mutatedPile + the mutator's mutatedInto are stitched together,
      // and a CardMutated event fires for trigger consumption.
      if (item.provenance.altCostUsed === "Mutate") {
        const targets = item.targets as
          | readonly { readonly kind: string; readonly id?: EntityId }[]
          | null
          | undefined;
        const firstCardTarget = Array.isArray(targets)
          ? targets.find((t): t is { readonly kind: "card"; readonly id: EntityId } => t.kind === "card")
          : undefined;
        if (!firstCardTarget) {
          // No legal mutate target at resolve time — fizzle softly: send
          // the source to its owner's graveyard (CR 608.2b — a spell with
          // all illegal targets fizzles).
          yield* game.action.moveTo(item.sourceCardId, ZoneType.Graveyard);
          return;
        }
        const hostId = firstCardTarget.id;
        const mutatorId = item.sourceCardId;

        const orderResp = (yield {
          kind: "decision",
          request: {
            kind: "chooseMutateOrder",
            playerSeat: item.controllerSeat,
            mutatorCardId: mutatorId,
            hostCardId: hostId,
          },
        }) as { readonly kind: "chooseMutateOrder"; readonly placement: "top" | "bottom" };
        const placeOnTop = orderResp.placement === "top";

        // Move the new card onto the battlefield first; once both cards are
        // there, perform the merge bookkeeping. The mutated-into back-
        // pointer hides the underlying card from independent characteristic
        // derivation (see deriveBaseCharacteristics for the Wave 25 branch).
        yield* game.action.moveTo(mutatorId, ZoneType.Battlefield);

        const host = game.cards.get(hostId);
        const mutator = game.cards.get(mutatorId);
        if (!host || !mutator) return;

        const existing = host.mutatedPile;
        const seeded: readonly EntityId[] = existing === undefined ? [hostId] : existing;
        const pile: readonly EntityId[] = placeOnTop ? [mutatorId, ...seeded] : [...seeded, mutatorId];
        host.mutatedPile = pile;

        if (placeOnTop) {
          // The new card defines the merged permanent. The previous
          // "topmost" card (host or earlier mutator) becomes hidden inside
          // the mutator's pile slot. We track the hidden cards via
          // mutatedInto so deriveBaseCharacteristics can return empty
          // characteristics for them.
          //
          // For "top" placement, the merged permanent inhabits the new
          // card's slot — copy the pile onto the mutator and clear the
          // host's pile so the mutator becomes the canonical pile owner.
          mutator.mutatedPile = pile;
          // Clear the host's pile so the canonical pile owner moves to the
          // mutator. Reflect.deleteProperty satisfies both biome's no-delete
          // rule and exactOptionalPropertyTypes (which forbids `= undefined`
          // on a typed-undefined-disallowed optional).
          Reflect.deleteProperty(host as object, "mutatedPile");
          for (const id of pile) {
            if (id === mutatorId) continue;
            const c = game.cards.get(id);
            if (c) c.mutatedInto = mutatorId;
          }
        } else {
          // "bottom" placement: the host stays the canonical pile owner;
          // the new card slides under and gets hidden.
          mutator.mutatedInto = hostId;
        }

        // Migrate the hidden cards' triggered abilities onto the merged
        // pile owner so trigger inheritance works (CR 702.139c — abilities
        // of every card in the pile fire as if from the merged permanent).
        // We move triggeredAbilities so the existing TriggerRegistry index
        // (keyed by ability id) keeps firing without re-registration; the
        // sourceCardId on each ability points at the original card, which
        // is fine — it's still a registered live ability.
        const owner = placeOnTop ? mutator : host;
        const hiddenIds = pile.filter((id) => id !== owner.id);
        for (const hid of hiddenIds) {
          const hidden = game.cards.get(hid);
          if (!hidden) continue;
          if (hidden.triggeredAbilities.length === 0) continue;
          owner.triggeredAbilities = [...owner.triggeredAbilities, ...hidden.triggeredAbilities];
        }

        game.layerEngine.bumpEpoch("mutate");
        yield game.emitEvent(
          mkEvent("CardMutated", game.turn, game.phase, {
            mutatorId,
            hostId,
            controllerSeat: item.controllerSeat,
          }),
        );
        return;
      }
      // Wave 10 — Bestow (CR 702.103). A bestowed creature spell becomes
      // an Aura with enchant creature; on resolution it enters the
      // battlefield attached to the chosen target rather than as a stand-
      // alone creature. We detect a bestow-cast via provenance, set the
      // `bestowed` flag, move the source to its controller's battlefield,
      // then attach it to the target.
      if (item.provenance.altCostUsed === "Bestow") {
        const source = game.cards.get(item.sourceCardId);
        if (source) {
          source.bestowed = true;
          // Bump epoch BEFORE moveTo so the layer cache reflects the new
          // bestowed flag when zone-activation registers the source's
          // intrinsic statics (Boon Satyr's +4/+2 to enchanted creature).
          game.layerEngine.bumpEpoch("bestow-set");
        }
        yield* game.action.moveTo(item.sourceCardId, ZoneType.Battlefield);
        // Attach to chosen target. item.targets is the TargetChoices-shaped
        // record; we lift the first card-typed entry. If targets are
        // missing or a player ref slipped in, the bestow attempt fizzles
        // softly — the card is on the battlefield as a bestow-flagged
        // permanent without a valid target, and the SBA pipeline (Wave 10
        // bestowAuraDetach path) will collapse it back to creature form.
        const targets = item.targets as
          | readonly { readonly kind: string; readonly id?: EntityId }[]
          | null
          | undefined;
        const firstCardTarget = Array.isArray(targets)
          ? targets.find((t): t is { readonly kind: "card"; readonly id: EntityId } => t.kind === "card")
          : undefined;
        if (firstCardTarget) {
          yield* game.action.attach(item.sourceCardId, firstCardTarget.id, "cast");
        }
        return;
      }
      // For permanent spells, the source enters the battlefield on
      // resolution (CR 608.3a). For non-permanent spells (instant/sorcery)
      // it goes to its owner's graveyard (CR 608.2g). The provenance
      // override (alternativeZoneDestination) wins when set — flashback
      // sends to Exile, foretell may set Battlefield/Graveyard explicitly,
      // etc. — and we only fall through to the default-from-types path
      // when no override is recorded.
      const source = game.cards.get(item.sourceCardId);
      const def = source?.paperCard.definition;
      let isPermanent = false;
      if (def) {
        for (const t of def.types.types) {
          if (PERMANENT_TYPES.has(t)) {
            isPermanent = true;
            break;
          }
        }
      }
      // Wave 65.C — Adventure (CR 715.2). When the adventure half resolves,
      // the card is exiled (with a "may cast as a creature spell" permission
      // the AdventureAltCost reads later) instead of going to the graveyard.
      // Detection: the StackItem's faceChosen is "adventure". On detection:
      //   • stamp `card.adventureSide = "spell"` so the AdventureAltCost
      //     `isAvailable` lights up,
      //   • override destination Graveyard → Exile.
      // The flag is cleared by the AdventureAltCost when the creature half
      // is then cast (modifyCastContext flips adventureSide to "creature");
      // a subsequent zone change off battlefield clears it via the
      // post-move clear below as a defense-in-depth.
      const isAdventureSpellResolve = item.provenance.faceChosen === "adventure";
      let destination =
        item.provenance.alternativeZoneDestination ??
        (isPermanent ? ZoneType.Battlefield : ZoneType.Graveyard);
      if (isAdventureSpellResolve && source !== undefined) {
        source.adventureSide = "spell";
        // Adventure half is an instant/sorcery — non-permanent. Override
        // its post-resolve destination to Exile (CR 715.2). If the
        // alternativeZoneDestination is already set (e.g. flashback +
        // adventure interaction — not in the printed corpus, but defensive),
        // we still pin to Exile because the adventure mechanic specifies the
        // exile destination as part of CR 715.
        destination = ZoneType.Exile;
      }
      yield* game.action.moveTo(item.sourceCardId, destination);
      // Wave 65.C — defensive clear. If the spell-resolve path moved the
      // card OFF Exile (shouldn't happen for the printed adventure path,
      // but keeps the flag honest if a future replacement effect rewrites
      // the destination), clear adventureSide so subsequent moves don't
      // keep redirecting. The Exile-stays case keeps the flag set so the
      // AdventureAltCost can read it when the creature half is cast.
      if (isAdventureSpellResolve && source !== undefined && source.zone !== ZoneType.Exile) {
        source.adventureSide = undefined;
      }
      return;
    }
    case "activatedAbility":
    case "triggeredAbility":
      // Source card stays put — activated/triggered abilities aren't the
      // card itself, just an effect sourced by it.
      return;
    default: {
      const _never: never = item.kind;
      throw new Error(`resolveStackItem: unreachable kind ${JSON.stringify(_never)}`);
    }
  }
}
