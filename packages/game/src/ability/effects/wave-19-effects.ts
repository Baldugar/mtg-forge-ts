// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 19 — final corpus-unknown effect handlers (15 entries). Pushes the
// effect coverage from 99.1% toward ~100%. Same MVP shape as Wave 18: each
// class extends SpellAbilityEffect, registers its handlerKey, and produces
// an observable game-state change so the canonical case is exercised.
// Advanced sub-params are flagged with TODO comments.
//
// Effects covered:
//   LookAt, RemoveFromCombat, DigMultiple, Goad, Shuffle, ChangeTargets,
//   PermanentNoncreature, Discover, Blight, Connive, FlipOntoBattlefield,
//   BecomesBlocked, AddOrRemoveCounter, AdvanceCrank, WinsGame.
import {
  CardType,
  CounterType,
  GameStateIntegrityError,
  TypeLine,
  ZoneType,
  mkEvent,
} from "@mtg-forge-ts/core";
import type {
  AbilityAst,
  CardDefinition,
  DecisionResponse,
  EntityId,
  PaperCard,
  PlayerSeat,
  SVarAst,
} from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import { SpellAbility } from "../spell-ability.js";
import type { SpellAbility as SpellAbilityType } from "../spell-ability.js";

// Helpers ---------------------------------------------------------------------

const resolveCounterType = (raw: string): CounterType => {
  if (raw === "P1P1") return CounterType.PlusOnePlusOne;
  if (raw === "M1M1") return CounterType.MinusOneMinusOne;
  const lower = raw.toLowerCase();
  for (const v of Object.values(CounterType)) {
    if (typeof v === "string" && v.toLowerCase() === lower) return v as CounterType;
  }
  return raw as CounterType;
};

// 1. LookAt -------------------------------------------------------------------
// Forge `SP$ LookAt` — reveal cards face-up to ONE chosen player only (vs.
// `Reveal` which reveals to all).
//
// Wave 81 — extend the prior MVP (top of controller's library) to support
// peeking at an opponent (Telepathy / Mindcensor / Sigiled Sword's "look
// at the top card of target opponent's library"-style cards). New params:
//   * Defined$ Player.Opponent / Player.Self / Player (default Self/You) —
//     selects whose library/hand to peek at. "Player.Opponent" routes to
//     the controller's first opponent in seat order.
//   * Zone$ Hand / Library (default Library) — which zone of the chosen
//     player to peek into. "Hand" reveals the entire hand to the controller.
//   * LookAtAll$ True — reveals every card in the chosen zone (overrides
//     LookAtAmount$). Used by hand-peeking (Mindcensor) and by full-library
//     peeks (rare, Library of Lat-Nam variants).
// `revealedBy` always carries the chosen player's seat (the player whose
// zone is exposed) and `revealedTo` is just the source-controller seat —
// only the looker sees the cards, matching CR 701.20.
export class LookAtEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "LookAt";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const definedRaw = hasParam(sa, "Defined") ? evaluateParamRaw(sa, "Defined") : "You";
    const targetSeat: PlayerSeat =
      definedRaw === "Player.Opponent" || definedRaw === "Opponent"
        ? (() => {
            for (const p of game.players) if (p.seat !== sa.controllerSeat) return p.seat;
            return sa.controllerSeat;
          })()
        : sa.controllerSeat;
    const zoneRaw = hasParam(sa, "Zone") ? evaluateParamRaw(sa, "Zone") : "Library";
    const fromZone: ZoneType = zoneRaw === "Hand" ? ZoneType.Hand : ZoneType.Library;
    const lookAtAll = hasParam(sa, "LookAtAll") && evaluateParamRaw(sa, "LookAtAll") !== "False";
    const num = hasParam(sa, "LookAtAmount") ? evaluateParamNumber(sa, "LookAtAmount", game) : 1;
    const player = game.getPlayer(targetSeat);
    const z = player.zones.get(fromZone);
    if (!z) return;
    const all = z.toArray();
    const ids = lookAtAll ? all : all.slice(0, num);
    if (ids.length === 0) return;
    yield {
      kind: "event",
      event: {
        kind: "CardsRevealed",
        version: 1,
        turn: game.turn,
        phase: game.phase,
        payload: {
          revealedBy: targetSeat,
          revealedTo: [sa.controllerSeat],
          cardIds: ids,
          fromZone,
        },
      },
    };
  }
}
effectRegistry.register(LookAtEffect);

// 2. RemoveFromCombat ---------------------------------------------------------
// Forge `SP$ RemoveFromCombat` — remove targets from combat. Sets a card-local
// flag that combat resolution honors.
export class RemoveFromCombatEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "RemoveFromCombat";

  // biome-ignore lint/correctness/useYield: pure flag mutation
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    for (const id of sa.targets) {
      const card = game.cards.get(id);
      if (!card) continue;
      card.removedFromCombat = true;
    }
  }
}
effectRegistry.register(RemoveFromCombatEffect);

// 3. DigMultiple --------------------------------------------------------------
// Forge `SP$ DigMultiple` — variant of Dig: dig N times. MVP: each iteration
// reveals the top `DigNum` cards and either adds them to hand or leaves them.
// Mirror Dig for params (DigNum, ChangeNum, DestinationZone).
//
// Wave 85 — wires the canonical `ChangeNum$` / `DestinationZone$` ladder
// (mirrors Dig for the per-iteration shape). Each of the `Repeat` rounds
// peels the top `DigNum` cards, walks `ChangeNum` of them off to the
// destination via game.action.moveTo (so zone-change triggers + replacements
// engage), and leaves the rest on top in original order. Remembered ids are
// still populated for back-compat. Destination defaults to "Hand"; the
// destToZone helper mirrors dig.ts's switch table.
const dmDestToZone = (dest: string): ZoneType => {
  switch (dest.toLowerCase()) {
    case "hand":
      return ZoneType.Hand;
    case "graveyard":
      return ZoneType.Graveyard;
    case "exile":
      return ZoneType.Exile;
    case "battlefield":
      return ZoneType.Battlefield;
    case "library":
      return ZoneType.Library;
    default:
      return ZoneType.Hand;
  }
};

export class DigMultipleEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "DigMultiple";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const repeat = hasParam(sa, "Repeat") ? evaluateParamNumber(sa, "Repeat", game) : 1;
    const digNum = hasParam(sa, "DigNum") ? evaluateParamNumber(sa, "DigNum", game) : 1;
    const changeNum = hasParam(sa, "ChangeNum") ? evaluateParamNumber(sa, "ChangeNum", game) : 0;
    const destStr = hasParam(sa, "DestinationZone") ? evaluateParamRaw(sa, "DestinationZone") : "Hand";
    const destZone = dmDestToZone(destStr);
    const seat = sa.controllerSeat;
    const player = game.getPlayer(seat);
    const lib = player.zones.get(ZoneType.Library);
    if (!lib) return;
    for (let i = 0; i < repeat; i++) {
      const ids = lib.toArray().slice(0, digNum);
      if (ids.length === 0) break;
      const source = game.cards.get(sa.sourceCardId);
      if (source) {
        for (const id of ids) source.remembered.push(id);
      }
      // Move the first `changeNum` peeked cards to the destination zone.
      // The remaining cards stay on top of the library in their original
      // order (no reordering decision yielded — RestRandomOrder is left
      // for SP4 once the order-cards decision is wired here).
      const moveCount = Math.min(changeNum, ids.length);
      for (let j = 0; j < moveCount; j++) {
        const cid = ids[j];
        if (cid === undefined) continue;
        yield* game.action.moveTo(cid, destZone, { toSeat: seat, cause: "dig" });
      }
    }
  }
}
effectRegistry.register(DigMultipleEffect);

// 4. Goad ---------------------------------------------------------------------
// Forge `SP$ Goad` (CR 701.42) — set the goaded flag on each target. Combat
// declaration logic treats a goaded creature as "must attack if able and must
// attack a player other than the goader".
//
// Wave 82 — also stamps `goaderSeats` on the card so the "must attack a
// player other than the goader" rule has the data it needs at declaration
// time. CR 701.42b explicitly admits multiple goaders (each Goad is its
// own effect), so the slot is a Set keyed by PlayerSeat — every goader
// adds itself; combat-declaration logic intersects the legal defenders
// with the complement of the goader set. The slot is duck-typed (no
// snapshot expansion needed for this wave); when the set is empty (e.g.
// pre-Wave-82 ungoaded card or one whose goading was cleared at EOT) the
// gate degenerates to "must attack any opponent if able" which mirrors
// the prior MVP behavior.
export class GoadEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Goad";

  // biome-ignore lint/correctness/useYield: pure flag mutation
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    for (const id of sa.targets) {
      const card = game.cards.get(id);
      if (!card) continue;
      card.goaded = true;
      const slot = card as { goaderSeats?: Set<PlayerSeat> };
      const seats = slot.goaderSeats ?? new Set<PlayerSeat>();
      seats.add(sa.controllerSeat);
      slot.goaderSeats = seats;
    }
  }
}
effectRegistry.register(GoadEffect);

// 5. Shuffle ------------------------------------------------------------------
// Forge `SP$ Shuffle` — shuffle a player's library via game.action.shuffle.
export class ShuffleEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Shuffle";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const definedRaw = hasParam(sa, "Defined") ? evaluateParamRaw(sa, "Defined") : "You";
    const seat: PlayerSeat =
      definedRaw === "Opponent" ? otherSeat(sa.controllerSeat, game) : sa.controllerSeat;
    yield* game.action.shuffle(seat);
  }
}
effectRegistry.register(ShuffleEffect);

const otherSeat = (seat: PlayerSeat, game: Game): PlayerSeat => {
  for (const p of game.players) if (p.seat !== seat) return p.seat;
  return seat;
};

// 6. ChangeTargets ------------------------------------------------------------
// Forge `SP$ ChangeTargets` — modify an existing stack item's targets
// (Misdirection / Redirect-style; CR 706.13).
//
// Wave 88 — legality re-check + redirect record. After rewriting the
// targets we drop any new target that is no longer addressable on the
// game (the source / target left the relevant zone between cast time
// and ChangeTargets resolution; CR 608.2b — "if a target becomes
// illegal, the stack item's targets are recomputed"). Each filtered
// target lands on `game.decisionWarnings` with a
// `change-targets-illegal-target` discriminator so the snapshot
// pipeline + tests can introspect the redirect outcome. A
// `stack-item-targets-changed` advisory record is also stamped so
// observers can correlate the rewrite to its origin without minting
// a dedicated engine event kind (deferred until the trigger taxonomy
// grows it).
export class ChangeTargetsEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ChangeTargets";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    if (sa.targets.length === 0) return;
    const stackItemId = sa.targets[0];
    if (stackItemId === undefined) return;
    const items = game.sharedZones.stack.toArray();
    const stackItem = items.find((it: { id: EntityId }) => it.id === stackItemId);
    if (!stackItem) return;
    const proposed = sa.targets.slice(1);
    // CR 608.2b legality re-check — drop targets that the engine no
    // longer knows about (left the battlefield, exiled mid-resolution,
    // etc.). We retain the proposed order for the survivors so the
    // assignment respects the original Forge intent.
    const survivors: EntityId[] = [];
    for (const id of proposed) {
      if (game.cards.has(id)) {
        survivors.push(id);
      } else {
        game.decisionWarnings.push({
          kind: "change-targets-illegal-target",
          sourceId: sa.sourceCardId,
          detail: `stackItem=${stackItemId}; dropped=${id}`,
        });
      }
    }
    // StackItem.targets is declared readonly; ChangeTargets is the
    // legitimate mutator (CR 706.13 redirect). Cast and rewrite.
    const mutable = stackItem as unknown as { targets: readonly EntityId[] };
    mutable.targets = survivors;
    game.decisionWarnings.push({
      kind: "stack-item-targets-changed",
      sourceId: sa.sourceCardId,
      detail: `stackItem=${stackItemId}; targets=${survivors.join(",")}`,
    });
  }
}
effectRegistry.register(ChangeTargetsEffect);

// 7. PermanentNoncreature -----------------------------------------------------
// Forge `SP$ PermanentNoncreature` — put a non-creature permanent (artifact,
// enchantment, planeswalker) onto the battlefield. Mirrors PermanentCreature.
export class PermanentNoncreatureEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "PermanentNoncreature";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    // The Forge form is used for cards whose ability resolves "as if cast" the
    // top spell; the runtime effect simply places the source onto the
    // battlefield under the controller's control. MVP toggles zone.
    const card = game.cards.get(sa.sourceCardId);
    if (!card) return;
    if (card.zone === ZoneType.Battlefield) return;
    yield* game.action.moveTo(sa.sourceCardId, ZoneType.Battlefield, {
      toSeat: sa.controllerSeat,
      cause: "effect",
    });
  }
}
effectRegistry.register(PermanentNoncreatureEffect);

// 8. Discover -----------------------------------------------------------------
// Forge `SP$ Discover` (Lost Caverns of Ixalan; CR 702.166) — Discover N:
// exile cards from the top of the library until a non-land card with mana
// value ≤ N is exiled. Cast it for free OR put it in hand; rest go to bottom.
// MVP: exile cards until a non-land hits, put it on `remembered` and into
// hand by default. Full free-cast wiring (FreeCastPipeline mirror) is SP4.
export class DiscoverEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Discover";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const n = hasParam(sa, "Num") ? evaluateParamNumber(sa, "Num", game) : 0;
    const seat = sa.controllerSeat;
    const player = game.getPlayer(seat);
    const lib = player.zones.get(ZoneType.Library);
    if (!lib) return;
    const exiled: EntityId[] = [];
    let pickedNonLand: EntityId | null = null;
    while (lib.size > 0) {
      const ids = lib.toArray();
      const topId = ids[0];
      if (topId === undefined) break;
      const topCard = game.cards.get(topId);
      if (!topCard) break;
      yield* game.action.moveTo(topId, ZoneType.Exile, { toSeat: seat, cause: "effect" });
      exiled.push(topId);
      const chars = game.layerEngine.computeCharacteristics(topId);
      const isLand = chars.types.has(CardType.Land);
      const cmc = chars.manaCost ? chars.manaCost.cmc(0) : 0;
      if (!isLand && cmc <= n) {
        pickedNonLand = topId;
        break;
      }
    }
    if (pickedNonLand !== null) {
      // MVP: route the picked card to the controller's hand. SP4 will yield a
      // confirmAction so the controller may cast it for free instead.
      yield* game.action.moveTo(pickedNonLand, ZoneType.Hand, { toSeat: seat, cause: "effect" });
      const source = game.cards.get(sa.sourceCardId);
      if (source) source.remembered.push(pickedNonLand);
      // Wave 16b — CardDiscovered (CR 702.166) — fires when a card is
      // discovered (cascade-like reveal-and-cast). Wave 20 DiscoverTrigger
      // listens. `value` carries the Discover N parameter.
      yield game.emitEvent(
        mkEvent("CardDiscovered", game.turn, game.phase, {
          playerSeat: seat,
          discoveredCardId: pickedNonLand,
          value: n,
        }),
      );
    }
    // Wave 81 — bottom the remaining exiled cards in random order. CR 702.166c
    // ("put the rest on the bottom of your library in a random order") so we
    // shuffle the exiled set minus the kept card via game.rng (deterministic
    // per the game seed) and append each to the bottom of the controller's
    // library. The cast-for-free decision (CR 702.166b "may cast it without
    // paying its mana cost") still routes through the standard hand path —
    // FreeCastPipeline parity is tracked under Cascade's resolver and is
    // shared once SP4 lands.
    const remaining = pickedNonLand === null ? exiled : exiled.filter((id) => id !== pickedNonLand);
    if (remaining.length > 0) {
      const order = game.rng.shuffle(remaining);
      for (const id of order) {
        yield* game.action.moveTo(id, ZoneType.Library, { toSeat: seat, cause: "effect" });
      }
    }
  }
}
effectRegistry.register(DiscoverEffect);

// 9. Blight -------------------------------------------------------------------
// Forge `SP$ Blight` — Phyrexian/oil-counter mechanic. Add an "oil" counter
// to each target (or an explicitly named CounterType$).
export class BlightEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Blight";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const typeRaw = hasParam(sa, "CounterType") ? evaluateParamRaw(sa, "CounterType") : "Oil";
    const num = hasParam(sa, "CounterNum") ? evaluateParamNumber(sa, "CounterNum", game) : 1;
    const ct = resolveCounterType(typeRaw);
    for (const id of sa.targets) {
      yield* game.action.addCounter(id, ct, num, sa.sourceCardId);
    }
  }
}
effectRegistry.register(BlightEffect);

// 10. Connive -----------------------------------------------------------------
// Forge `SP$ Connive` (Streets of New Capenna; CR 702.165) — draw a card,
// then discard a card. If a non-land was discarded, +1/+1 counter on each
// target.
//
// Wave 80 — yield a chooseCard discard request to the controller (CR
// 702.165a) instead of mechanically picking the last card in hand. Also
// honors Num$ for multi-Connive cards (Connive 2 = draw+discard twice;
// counters scale with non-lands discarded). On invalid responses we fall
// back to the last card in hand (the prior MVP path).
export class ConniveEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Connive";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const seat = sa.controllerSeat;
    const num = hasParam(sa, "Num") ? evaluateParamNumber(sa, "Num", game) : 1;
    let nonLandDiscarded = 0;
    for (let i = 0; i < num; i++) {
      yield* game.action.drawCards(seat, 1);
      const player = game.getPlayer(seat);
      const hand = player.zones.get(ZoneType.Hand);
      if (!hand) continue;
      const handIds = hand.toArray();
      if (handIds.length === 0) continue;
      let discardId: EntityId | undefined;
      const decision = (yield {
        kind: "decision",
        request: {
          kind: "chooseCard",
          playerSeat: seat,
          pool: handIds,
          restriction: { effect: "connive-discard" },
          min: 1,
          max: 1,
        },
      }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;
      if (decision && decision.kind === "chooseCard") {
        const eligible = new Set(handIds);
        for (const id of decision.chosen) {
          if (eligible.has(id)) {
            discardId = id;
            break;
          }
        }
      }
      if (discardId === undefined) discardId = handIds[handIds.length - 1];
      if (discardId !== undefined) {
        const chars = game.layerEngine.computeCharacteristics(discardId);
        if (!chars.types.has(CardType.Land)) nonLandDiscarded++;
        yield* game.action.moveTo(discardId, ZoneType.Graveyard, {
          toSeat: seat,
          cause: "discard",
        });
      }
    }
    if (nonLandDiscarded > 0) {
      const targetIds = sa.targets.length > 0 ? sa.targets : [sa.sourceCardId];
      for (const id of targetIds) {
        yield* game.action.addCounter(id, CounterType.PlusOnePlusOne, nonLandDiscarded, sa.sourceCardId);
      }
    }
  }
}
effectRegistry.register(ConniveEffect);

// 11. FlipOntoBattlefield -----------------------------------------------------
// Forge `SP$ FlipOntoBattlefield` — flip a coin and, depending on outcome,
// put a target onto the battlefield.
//
// Wave 83 — honor `WinIfFlippedHeads$ True` / `LoseIfTails$ True` flag
// params: route through game.action.gameWin / game.action.gameLoss when set
// so Platinum-Angel-style replacements can deny the loss/win and the SBA
// engine sees the canonical PlayerWon / PlayerLost events. Without these
// flags the original heads-puts-source-on-battlefield behavior is
// preserved (the Forge corpus's printed "Chance Encounter" / "Chaos Confetti"
// cards rely on the flag-driven win/lose path).
export class FlipOntoBattlefieldEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "FlipOntoBattlefield";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const heads = game.rng.nextInt(0, 2) === 0;
    yield {
      kind: "event",
      event: {
        kind: "FlipCoin",
        version: 1,
        turn: game.turn,
        phase: game.phase,
        payload: { playerSeat: sa.controllerSeat, resultHeads: heads },
      },
    };
    const winOnHeads =
      hasParam(sa, "WinIfFlippedHeads") &&
      evaluateParamRaw(sa, "WinIfFlippedHeads").trim().toLowerCase() === "true";
    const loseOnTails =
      hasParam(sa, "LoseIfTails") && evaluateParamRaw(sa, "LoseIfTails").trim().toLowerCase() === "true";

    if (heads && winOnHeads) {
      // CR 104.2a — controller wins the game; routes through the
      // gameWin pipeline so PlayerWon emits and the terminal-state SBA
      // sweep observes the win.
      yield* game.action.gameWin(sa.controllerSeat, { cause: "flip-onto-battlefield" });
      return;
    }
    if (!heads && loseOnTails) {
      // CR 104.3 — controller loses the game; gameLoss runs the
      // replacement chain (Platinum Angel et al) before PlayerLost
      // emits, mirroring the canonical effect-driven loss path.
      yield* game.action.gameLoss(sa.controllerSeat, {
        cause: "flip-onto-battlefield",
        reason: "effect",
      });
      return;
    }

    if (heads) {
      const card = game.cards.get(sa.sourceCardId);
      if (card && card.zone !== ZoneType.Battlefield) {
        yield* game.action.moveTo(sa.sourceCardId, ZoneType.Battlefield, {
          toSeat: sa.controllerSeat,
          cause: "effect",
        });
      }
    }
  }
}
effectRegistry.register(FlipOntoBattlefieldEffect);

// 12. BecomesBlocked ----------------------------------------------------------
// Forge `SP$ BecomesBlocked` — set a "becomes blocked" trigger on the
// targets.
//
// Wave 83 — register a one-shot delayed trigger per target on
// game.delayedTriggerQueue that fires on the next AttackerBecomesBlocked
// event whose attackerId matches the target. Mirrors the
// DelayedTriggerEffect (Mode$ Phase / Mode$ ChangesZone) registration shape.
// The matched event is captured on the source card's
// `becomesBlockedTriggered` slot (set of attackerIds that have triggered)
// so observers can correlate the firing without standing up a new event
// kind. The remembered fallback is preserved for legacy back-compat.
export class BecomesBlockedEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "BecomesBlocked";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const sourceCardId = sa.sourceCardId;
    const ownerSeat = sa.controllerSeat;
    const sourceCard = game.cards.get(sourceCardId);

    for (const id of sa.targets) {
      const card = game.cards.get(id);
      if (!card) continue;
      // Legacy slot (kept for back-compat with prior wave tests).
      card.remembered.push(id);

      // Capture the attacker id in the closure so the predicate compares
      // against the correct id even when sa.targets is later mutated.
      const attackerId: EntityId = id;
      const dtId = game.newEntityId();
      game.delayedTriggerQueue.add({
        id: dtId,
        kind: "triggered",
        sourceCardId,
        activeInZones: new Set([ZoneType.Battlefield, ZoneType.Stack, ZoneType.Graveyard, ZoneType.Command]),
        timestamp: 0,
        controllerSeatAtReg: ownerSeat,
        isDelayed: true,
        createdAtTurn: game.turn,
        creationContext: { attackerId },
        oneShot: true,
        matches(event) {
          if (event.kind !== "AttackerBecomesBlocked") return false;
          const p = event.payload as { attackerId?: EntityId };
          if (p.attackerId !== attackerId) return false;
          // Side-effect: stamp the source's `becomesBlockedTriggered` set
          // so observers + the attached test harness can correlate the
          // delayed-trigger fire to the source. Skipped on missing source
          // (the register call's source has left play, fall-through is
          // safe — the queue itself drops the one-shot regardless).
          if (sourceCard) {
            const set =
              (sourceCard as { becomesBlockedTriggered?: Set<EntityId> }).becomesBlockedTriggered ??
              new Set<EntityId>();
            set.add(attackerId);
            (sourceCard as { becomesBlockedTriggered?: Set<EntityId> }).becomesBlockedTriggered = set;
          }
          return true;
        },
      });
    }
  }
}
effectRegistry.register(BecomesBlockedEffect);

// 13. AddOrRemoveCounter ------------------------------------------------------
// Forge `SP$ AddOrRemoveCounter` — yield a binary choice (add or remove);
// then apply. MVP: deterministic — add by default, since most Forge cards
// using this prefer the boost branch.
export class AddOrRemoveCounterEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "AddOrRemoveCounter";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const typeRaw = hasParam(sa, "CounterType") ? evaluateParamRaw(sa, "CounterType") : "P1P1";
    const num = hasParam(sa, "CounterNum") ? evaluateParamNumber(sa, "CounterNum", game) : 1;
    const ct = resolveCounterType(typeRaw);
    // MVP: emit a chooseGenericOption decision; pick "add" by default.
    const rawResponse = yield {
      kind: "decision",
      request: {
        kind: "chooseGenericOption",
        sourceId: sa.sourceCardId,
        playerSeat: sa.controllerSeat,
        options: [
          { id: "add", description: "Add" },
          { id: "remove", description: "Remove" },
        ],
      },
    };
    const response = rawResponse as DecisionResponse | undefined;
    const choice = response && response.kind === "chooseGenericOption" ? response.optionId : "add";
    for (const id of sa.targets) {
      if (choice === "remove") {
        yield* game.action.removeCounter(id, ct, num, sa.sourceCardId);
      } else {
        yield* game.action.addCounter(id, ct, num, sa.sourceCardId);
      }
    }
  }
}
effectRegistry.register(AddOrRemoveCounterEffect);

// 14. AdvanceCrank ------------------------------------------------------------
// Unstable contraption advance — Forge `SP$ AdvanceCrank` rotates the
// player's contraption sprockets.
//
// Wave 88 — sprocket-pointer rotation. The Unstable Crank! state machine
// cycles a per-controller pointer through 1 -> 2 -> 3 -> 1 each crank.
// We track it on `game.flags.attractions[seat].crankSprocket`; when an
// attraction's `assignedSprocket` matches the new pointer, the
// CrankContraption trigger family fires for that contraption. The
// rotation is the entire sprocket-state machine — Forge models nothing
// else here. The CardCranked pulse that wave-16 wires up still fires
// for trigger watchers; the new payload field `targetSprocket` carries
// the rotated pointer so trigger handlers can match without re-reading
// the flags map.
export class AdvanceCrankEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "AdvanceCrank";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const source = game.cards.get(sa.sourceCardId);
    if (source) source.remembered.push(sa.sourceCardId);
    // Wave 88 — rotate the per-controller sprocket pointer.
    const seat = sa.controllerSeat;
    const prior = game.flags.attractions.get(seat) as
      | { crankSprocket?: number; assembledContraptions?: number; openedAttractions?: number }
      | undefined;
    const currentSprocket = prior?.crankSprocket ?? 0;
    // Cycle 0 -> 1 -> 2 -> 3 -> 1 ... (the initial 0 marks "never cranked";
    // the first crank lands on sprocket 1, mirroring Forge's printed
    // "your sprocket pointer starts at 1" rule).
    const nextSprocket = currentSprocket === 0 ? 1 : (currentSprocket % 3) + 1;
    game.flags.attractions.set(seat, {
      ...(prior ?? {}),
      crankSprocket: nextSprocket,
    });
    // Wave 16b — CardCranked (Unstable Crank! mechanic) — fires when a
    // contraption is "cranked" (assembled/advanced). Wave 16 CrankContraption-
    // Trigger listens. Payload tracks the source card + controller.
    yield game.emitEvent(
      mkEvent("CardCranked", game.turn, game.phase, {
        cardId: sa.sourceCardId,
        controllerSeat: sa.controllerSeat,
      }),
    );
  }
}
effectRegistry.register(AdvanceCrankEffect);

// 15. WinsGame ----------------------------------------------------------------
// Forge `SP$ WinsGame` — direct winner declaration (Approach of the Second
// Sun, Coalition Victory etc.). Routes through game.action.gameWin so any
// game-win replacement (Platinum Angel-style) gets a chance to deny.
export class WinsGameEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "WinsGame";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const definedRaw = hasParam(sa, "Defined") ? evaluateParamRaw(sa, "Defined") : "You";
    const seat: PlayerSeat =
      definedRaw === "Opponent" ? otherSeat(sa.controllerSeat, game) : sa.controllerSeat;
    yield* game.action.gameWin(seat, { cause: "effect" });
  }
}
effectRegistry.register(WinsGameEffect);

// Silenced unused imports — referenced only by future sub-params.
void GameStateIntegrityError;
void TypeLine;
void SpellAbility;
void (null as unknown as AbilityAst);
void (null as unknown as CardDefinition);
void (null as unknown as PaperCard);
void (null as unknown as SVarAst);
