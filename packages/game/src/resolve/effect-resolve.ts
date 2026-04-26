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
      const destination =
        item.provenance.alternativeZoneDestination ??
        (isPermanent ? ZoneType.Battlefield : ZoneType.Graveyard);
      yield* game.action.moveTo(item.sourceCardId, destination);
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
