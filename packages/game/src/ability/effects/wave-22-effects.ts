// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 22 — final corpus long-tail effect handlers (20 entries). Pushes the
// effect coverage from ~99.8% toward 100%. Same MVP shape as Wave 21:
// each class extends SpellAbilityEffect, registers its handlerKey, and
// produces an observable game-state change so the canonical case is
// exercised. Advanced sub-params are flagged with TODO comments.
//
// Effects covered:
//   Detain, DayTime, Poison, BecomeMonarch, ChooseEvenOdd, AddPhase,
//   SwitchBlock, ProtectionAll, Meld, GainControlVariant, UnlockDoor, Clash,
//   ChooseSector, ExchangeControlVariant, GainOwnership, Unattach,
//   ActivateAbility, TakeInitiative, VillainousChoice, RollPlanarDice.
import { tokenDatabase } from "@mtg-forge-ts/cards";
import type {
  AbilityAst,
  CardDefinition,
  DecisionResponse,
  EntityId,
  PaperCard,
  PlayerSeat,
  SVarAst,
} from "@mtg-forge-ts/core";
import {
  ColorSet,
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  TypeLine,
  ZoneType,
  mkEvent,
} from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { applyUndercityRoomEffect, grantInitiative } from "../../dnd/initiative-tracker.js";
import type { Game } from "../../game.js";
import { grantMonarch } from "../../monarch/monarch-tracker.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import { SpellAbility } from "../spell-ability.js";
import type { SpellAbility as SpellAbilityType } from "../spell-ability.js";

// Helpers ---------------------------------------------------------------------

const otherSeat = (seat: PlayerSeat, game: Game): PlayerSeat => {
  for (const p of game.players) if (p.seat !== seat) return p.seat;
  return seat;
};

// 1. Detain ------------------------------------------------------------------
// Forge `SP$ Detain` (Ravnica: Return to Ravnica; CR 701.32) — tap target
// permanent and prevent it from attacking or blocking until its
// controller's next turn.
//
// Wave 82 — wires `detainedUntilTurn` into the combat-declaration gate.
// canAttack and canBlock (statics/wave65-combat-gates.ts) both consult
// the flag: while `game.turn < card.detainedUntilTurn` the creature is
// rejected as an attacker AND as a blocker. The flag clears
// automatically once the affected controller's next turn opens
// (no manual cleanup needed — the gate just stops firing). Activated-
// ability gating (CR 701.32 — "can't activate non-mana abilities") is
// `// TODO(advanced)` until SP3+ enumerates activated abilities through
// the priority orchestrator (legal-action-enumerator stops at castSpell).
export class DetainEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Detain";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const ids = sa.targets.length > 0 ? sa.targets : [sa.sourceCardId];
    for (const id of ids) {
      const card = game.cards.get(id);
      if (!card) continue;
      yield* game.action.tap(id);
      (card as { detainedUntilTurn?: number }).detainedUntilTurn = game.turn + 1;
    }
  }
}
effectRegistry.register(DetainEffect);

// 2. DayTime -----------------------------------------------------------------
// Forge `SP$ DayTime` (Innistrad: Midnight Hunt; CR 726) — manually set the
// day/night state. MVP: stamp the requested value on game and emit
// DayTimeChanged so observers see the transition.
export class DayTimeEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "DayTime";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const requested = hasParam(sa, "Value") ? evaluateParamRaw(sa, "Value") : "day";
    const newValue: "day" | "night" | "neither" =
      requested === "night" ? "night" : requested === "neither" ? "neither" : "day";
    // Wave 27 — canonical day/night state lives at game.flags.dayNight
    // (snapshot-backed). Earlier waves stashed a duck-typed `dayTime` slot
    // on Game; the auto-transition tracker reads/writes the flag, so this
    // handler must too — otherwise the manual SP$ DayTime path would be
    // invisible to CR 726.4's upkeep checks.
    const old = game.flags.dayNight;
    game.flags.dayNight = newValue;
    if (old !== newValue) {
      yield {
        kind: "event",
        event: {
          kind: "DayTimeChanged",
          version: 1,
          turn: game.turn,
          phase: game.phase,
          payload: { oldValue: old, newValue },
        },
      };
    }
    // TODO(advanced): trigger transform-on-day/night daybound/nightbound permanents.
  }
}
effectRegistry.register(DayTimeEffect);

// 3. Poison ------------------------------------------------------------------
// Forge `SP$ Poison` (CR 704.5c) — give target player N poison counters.
//
// Wave 82 — write the canonical `player.counters.get(CounterType.Poison)`
// slot (the same store the SBA loss-condition checker reads at
// sba/loss-conditions.ts) instead of the duck-typed `poisonCounters` slot.
// Earlier waves stored counts on `(player as { poisonCounters?: number })`,
// which meant the SBA threshold (CR 704.5c — 10 poison counters → lose)
// never fired off this handler. Mirroring the Wither/Infect damage path
// (game-action.ts:1064) wires Poison through the canonical store so loss
// + proliferate + snapshot all engage. Bumps the poison counter directly
// (no MutationIntent for player counters yet — same shape as the wither
// path) and additionally stamps the legacy `poisonCounters` slot so any
// observers reading the duck-typed field still see the same total.
// Vorinclex-style replacement parity is `// TODO(advanced)` for the
// Player-counter MutationIntent layer (SP3+).
export class PoisonEffect extends SpellAbilityEffect {
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "Num") ? evaluateParamNumber(sa, "Num", game) : 1;
    const definedRaw = hasParam(sa, "Defined") ? evaluateParamRaw(sa, "Defined") : "Opponent";
    const seat: PlayerSeat =
      definedRaw === "Opponent" ? otherSeat(sa.controllerSeat, game) : sa.controllerSeat;
    const player = game.getPlayer(seat);
    const curCanonical = player.counters.get(CounterType.Poison) ?? 0;
    player.counters.set(CounterType.Poison, curCanonical + num);
    // Back-compat: keep the legacy duck-typed slot in sync for any consumers
    // still reading off `(player as { poisonCounters?: number })`.
    const curLegacy = (player as { poisonCounters?: number }).poisonCounters ?? 0;
    (player as { poisonCounters?: number }).poisonCounters = curLegacy + num;
    yield {
      kind: "event",
      event: {
        kind: "PlayerPoisoned",
        version: 1,
        turn: game.turn,
        phase: game.phase,
        payload: { playerSeat: seat, amount: num },
      },
    };
  }

  static override readonly handlerKey = "Poison";
}
effectRegistry.register(PoisonEffect);

// 4. BecomeMonarch -----------------------------------------------------------
// Forge `SP$ BecomeMonarch` (Conspiracy: Take the Crown; CR 716) — designated
// player becomes the monarch. MVP: stamp game.monarch + emit BecameMonarch.
export class BecomeMonarchEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "BecomeMonarch";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const definedRaw = hasParam(sa, "Defined") ? evaluateParamRaw(sa, "Defined") : "You";
    const seat: PlayerSeat =
      definedRaw === "Opponent" ? otherSeat(sa.controllerSeat, game) : sa.controllerSeat;
    // Wave 27 — canonical monarch lives at game.flags.monarch (snapshot-
    // backed). Use the shared monarch-tracker so BecomeMonarchEffect, the
    // combat-damage transfer hook, and any future card-driven mutator all
    // route through one path.
    const events = grantMonarch(game, seat);
    for (const evt of events) yield { kind: "event", event: evt };
  }
}
effectRegistry.register(BecomeMonarchEffect);

// 5. ChooseEvenOdd -----------------------------------------------------------
// Forge `SP$ ChooseEvenOdd` — controller chooses even or odd (rare; e.g.
// Odric's Helm or Yidris-style mana-value referencing).
//
// Wave 81 — yield the typed `chooseEvenOdd` decision (request kind exists in
// Wave 56's player-decisions schema) so the controller actually picks. The
// chosen result is stamped on `source.chosenEvenOdd` for downstream SVar
// selectors that read it (e.g. `chosenEvenOdd` checks in cost / static
// payloads). Falls back to a Choice$ param default ("odd" if absent) when
// the decision response is missing or wrong-shape — matches the prior MVP
// fallback for tests that drain without a controller. The Choice$ override
// lets a card pre-resolve the choice (the Wave 22 stub used this for
// determinism); when no override is present we look for a chooseEvenOdd
// response.
export class ChooseEvenOddEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ChooseEvenOdd";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const source = game.cards.get(sa.sourceCardId);
    if (!source) return;
    const fallback: "even" | "odd" =
      hasParam(sa, "Choice") && evaluateParamRaw(sa, "Choice") === "even" ? "even" : "odd";
    let choice: "even" | "odd" = fallback;
    if (!hasParam(sa, "Choice")) {
      const rawResponse = yield {
        kind: "decision",
        request: {
          kind: "chooseEvenOdd",
          playerSeat: sa.controllerSeat,
          sourceId: sa.sourceCardId,
        },
      };
      const response = rawResponse as DecisionResponse | undefined;
      if (response && response.kind === "chooseEvenOdd") {
        choice = response.choice === "even" ? "even" : "odd";
      }
    }
    (source as { chosenEvenOdd?: string }).chosenEvenOdd = choice;
  }
}
effectRegistry.register(ChooseEvenOddEffect);

// 6. AddPhase ----------------------------------------------------------------
// Forge `SP$ AddPhase` (Aggravated Assault, Relentless Assault, etc.) — add
// an additional combat (or other) phase after the current one. MVP: append a
// pending phase token to game.flags.
export class AddPhaseEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "AddPhase";

  // biome-ignore lint/correctness/useYield: pure mutation
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const phaseRaw = hasParam(sa, "Phase") ? evaluateParamRaw(sa, "Phase") : "Combat";
    const pending = (game as { pendingExtraPhases?: string[] }).pendingExtraPhases ?? [];
    pending.push(phaseRaw);
    (game as { pendingExtraPhases?: string[] }).pendingExtraPhases = pending;
    // TODO(advanced): turn-loop integration — pop one entry and inject the
    // matching phase before the cleanup step; emit PhaseInjected.
  }
}
effectRegistry.register(AddPhaseEffect);

// 7. SwitchBlock -------------------------------------------------------------
// Forge `SP$ SwitchBlock` — variant of damage redirection: redirect a
// blocker's combat assignment to another creature. MVP: stash a redirect map
// on game so combat damage can read it.
export class SwitchBlockEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "SwitchBlock";

  // biome-ignore lint/correctness/useYield: pure mutation
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const redirects =
      (game as { blockRedirects?: Map<EntityId, EntityId> }).blockRedirects ?? new Map<EntityId, EntityId>();
    if (sa.targets.length >= 2) {
      const a = sa.targets[0];
      const b = sa.targets[1];
      if (a !== undefined && b !== undefined) redirects.set(a, b);
    }
    (game as { blockRedirects?: Map<EntityId, EntityId> }).blockRedirects = redirects;
    // TODO(advanced): integrate into combat damage assignment so the
    // attacker's damage targets the redirected blocker.
  }
}
effectRegistry.register(SwitchBlockEffect);

// 8. ProtectionAll -----------------------------------------------------------
// Forge `SP$ ProtectionAll` — grant protection to a group of permanents.
// MVP: stash a per-card protection flag on each target.
export class ProtectionAllEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ProtectionAll";

  // biome-ignore lint/correctness/useYield: pure mutation
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const fromRaw = hasParam(sa, "Gains") ? evaluateParamRaw(sa, "Gains") : "everything";
    const ids = sa.targets.length > 0 ? sa.targets : [sa.sourceCardId];
    for (const id of ids) {
      const card = game.cards.get(id);
      if (!card) continue;
      const list = (card as { temporaryProtections?: string[] }).temporaryProtections ?? [];
      list.push(fromRaw);
      (card as { temporaryProtections?: string[] }).temporaryProtections = list;
    }
    // TODO(advanced): plumb through the layers engine so ProtectionFrom
    // characteristics propagate properly.
  }
}
effectRegistry.register(ProtectionAllEffect);

// 9. Meld --------------------------------------------------------------------
// Forge `SP$ Meld` (Eldritch Moon; CR 701.37) — meld two cards into one. MVP:
// stamp a melded flag + emit a Melded event with stub source IDs.
export class MeldEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Meld";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const ids = sa.targets.length > 0 ? sa.targets : [sa.sourceCardId];
    const meldedId = ids[0] ?? sa.sourceCardId;
    yield {
      kind: "event",
      event: {
        kind: "Melded",
        version: 1,
        turn: game.turn,
        phase: game.phase,
        payload: { meldedId, sourceIds: ids },
      },
    };
    // TODO(advanced): mint a new combined card via cardFactory + register the
    // back-face characteristics override.
  }
}
effectRegistry.register(MeldEffect);

// 10. GainControlVariant ------------------------------------------------------
// Forge `SP$ GainControlVariant` — variant of GainControl with conditions
// (e.g. only if a creature has summoning sickness). MVP: route through
// game.action.controlChange for each target.
export class GainControlVariantEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "GainControlVariant";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    for (const id of sa.targets) {
      yield* game.action.changeControl(id, sa.controllerSeat, sa.sourceCardId);
    }
    // TODO(advanced): full Condition$ DSL — gating + Until$ duration.
  }
}
effectRegistry.register(GainControlVariantEffect);

// 11. UnlockDoor (effect form) ------------------------------------------------
// Forge `SP$ UnlockDoor` (Outlaws of Thunder Junction) — unlock a door on a
// Room/Door card. MVP: set unlocked=true on each target + emit DoorOpened.
export class UnlockDoorEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "UnlockDoor";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const ids = sa.targets.length > 0 ? sa.targets : [sa.sourceCardId];
    const doorId = hasParam(sa, "Door") ? evaluateParamRaw(sa, "Door") : "front";
    for (const id of ids) {
      const card = game.cards.get(id);
      if (!card) continue;
      const doors = (card as { unlockedDoors?: Set<string> }).unlockedDoors ?? new Set<string>();
      doors.add(doorId);
      (card as { unlockedDoors?: Set<string> }).unlockedDoors = doors;
      yield {
        kind: "event",
        event: {
          kind: "DoorOpened",
          version: 1,
          turn: game.turn,
          phase: game.phase,
          payload: { cardId: id, doorId },
        },
      };
    }
    // TODO(advanced): wire fully-unlocked detection so the front face
    // characteristics activate when both doors are open.
  }
}
effectRegistry.register(UnlockDoorEffect);

// 12. Clash ------------------------------------------------------------------
// Forge `SP$ Clash` (Lorwyn; CR 701.4) — both players reveal top card; higher
// mana value wins. MVP: deterministic — controller wins the clash; emit
// CardClashed for the controller.
export class ClashEffect extends SpellAbilityEffect {
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    yield {
      kind: "event",
      event: {
        kind: "CardClashed",
        version: 1,
        turn: game.turn,
        phase: game.phase,
        payload: { playerSeat: sa.controllerSeat, winner: sa.controllerSeat },
      },
    };
    // TODO(advanced): route through library top peek + actual MV comparison +
    // surface the winner choice on whether to keep on top or send to bottom.
  }

  static override readonly handlerKey = "Clash";
}
effectRegistry.register(ClashEffect);

// 13. ChooseSector ------------------------------------------------------------
// Forge `SP$ ChooseSector` — Unfinity Attractions / sector picker. The
// controller picks among printed sectors (1 / 2 / 3 / 4 / 5 / 6) so a later
// roll-die check can compare against the chosen sector.
//
// Wave 81 — yield the typed `chooseSector` decision (Wave 56's schema). The
// chosen sectorId is stamped on `source.chosenSector` for downstream consumers
// (Attraction cards' "When you visit ~"-style triggers read this slot, as do
// roll-die comparators). The candidate set defaults to sectors 1-6 (the
// printed Unfinity range). When the card's `Sectors$` param lists explicit
// sectors (comma-separated) we honor that. On missing / wrong-shape response
// we fall back to the legacy `Sector$` deterministic param (or "1").
export class ChooseSectorEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ChooseSector";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const source = game.cards.get(sa.sourceCardId);
    if (!source) return;
    const sectorListRaw = hasParam(sa, "Sectors") ? evaluateParamRaw(sa, "Sectors") : "1,2,3,4,5,6";
    const sectorIds = sectorListRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const fallback = hasParam(sa, "Sector") ? evaluateParamRaw(sa, "Sector") : (sectorIds[0] ?? "1");
    let sector: string = fallback;
    const rawResponse = yield {
      kind: "decision",
      request: {
        kind: "chooseSector",
        sourceId: sa.sourceCardId,
        sectorIds,
      },
    };
    const response = rawResponse as DecisionResponse | undefined;
    if (response && response.kind === "chooseSector" && sectorIds.includes(response.sectorId)) {
      sector = response.sectorId;
    }
    (source as { chosenSector?: string }).chosenSector = sector;
  }
}
effectRegistry.register(ChooseSectorEffect);

// 14. ExchangeControlVariant --------------------------------------------------
// Forge `SP$ ExchangeControlVariant` — exchange control of two permanents
// (variant rules form). MVP: swap controllerSeat on the two targets.
export class ExchangeControlVariantEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ExchangeControlVariant";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    if (sa.targets.length < 2) return;
    const a = sa.targets[0];
    const b = sa.targets[1];
    if (a === undefined || b === undefined) return;
    const cardA = game.cards.get(a);
    const cardB = game.cards.get(b);
    if (!cardA || !cardB) return;
    const ctrlA = cardA.controllerSeat;
    const ctrlB = cardB.controllerSeat;
    yield* game.action.changeControl(a, ctrlB, sa.sourceCardId);
    yield* game.action.changeControl(b, ctrlA, sa.sourceCardId);
    // TODO(advanced): full Condition$ DSL + duration handling.
  }
}
effectRegistry.register(ExchangeControlVariantEffect);

// 15. GainOwnership -----------------------------------------------------------
// Forge `SP$ GainOwnership` (Beacon of Unrest, etc. variants) — change the
// owner of a card permanently. MVP: stamp ownerSeat directly on the card.
export class GainOwnershipEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "GainOwnership";

  // biome-ignore lint/correctness/useYield: pure mutation
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const ids = sa.targets.length > 0 ? sa.targets : [sa.sourceCardId];
    for (const id of ids) {
      const card = game.cards.get(id);
      if (!card) continue;
      (card as { ownerSeat?: PlayerSeat }).ownerSeat = sa.controllerSeat;
    }
    // TODO(advanced): when the card leaves the battlefield, send it to the
    // new owner's appropriate zone (CR 400.7). Wire through ownership table.
  }
}
effectRegistry.register(GainOwnershipEffect);

// 16. Unattach (effect form) --------------------------------------------------
// Forge `SP$ Unattach` — unattach an Aura/Equipment from its host.
//
// Wave 82 — route through `game.action.unattach` so the canonical
// replacement chain runs (Replace$ Unattach handlers — Wave 26's
// AttachReplacement family) AND the per-attachment Layer 6 grants are
// removed via auraGrantLedger.onUnattach (Task 43). The MVP path stamped
// `attachedTo = null` directly, which left aura grants stale (a buffed
// creature kept the +1/+1 grant after the aura "unattached" via SP$
// Unattach because the ledger never fired). The action mutator also
// updates the host card's `attachments[]` array, mirroring the SBA-
// driven unattach path used by sba-engine.ts:210.
export class UnattachEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Unattach";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const ids = sa.targets.length > 0 ? sa.targets : [sa.sourceCardId];
    for (const id of ids) {
      const card = game.cards.get(id);
      if (!card) continue;
      // game.action.unattach is a no-op if attachedTo is already null
      // (matches tap/untap convention — no spurious event/replacement
      // chain). Tests stamp a fake attachedTo so the unattach actually
      // runs.
      yield* game.action.unattach(id, "effect");
    }
  }
}
effectRegistry.register(UnattachEffect);

// 17. ActivateAbility ---------------------------------------------------------
// Forge `SP$ ActivateAbility` — auto-activate a printed ability of the source
// card (rare; usually Mode$/Choose). MVP: stash an activate-intent on the
// source card so a follow-up handler can replay it.
export class ActivateAbilityEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ActivateAbility";

  // biome-ignore lint/correctness/useYield: stub
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const abilityKey = hasParam(sa, "Ability") ? evaluateParamRaw(sa, "Ability") : "0";
    const source = game.cards.get(sa.sourceCardId);
    if (!source) return;
    const queue = (source as { pendingAbilityActivations?: string[] }).pendingAbilityActivations ?? [];
    queue.push(abilityKey);
    (source as { pendingAbilityActivations?: string[] }).pendingAbilityActivations = queue;
    // TODO(advanced): resolve the named ability via the SVar pipeline; route
    // through stack like a normal activation.
  }
}
effectRegistry.register(ActivateAbilityEffect);

// 18. TakeInitiative ----------------------------------------------------------
// Forge `SP$ TakeInitiative` (D&D Initiative; CR 716.7) — designated player
// takes the initiative. MVP: stamp game.initiativeSeat + emit BecameInitiative.
export class TakeInitiativeEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "TakeInitiative";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const definedRaw = hasParam(sa, "Defined") ? evaluateParamRaw(sa, "Defined") : "You";
    const seat: PlayerSeat =
      definedRaw === "Opponent" ? otherSeat(sa.controllerSeat, game) : sa.controllerSeat;
    // Wave 27 — route through the shared initiative-tracker so card-driven
    // and combat-damage transfers all write the same canonical slot
    // (game.flags.initiative). The old duck-typed `Game.initiativeSeat`
    // was incompatible with the snapshot pipeline.
    // Wave 70.B — when grantInitiative emits an UndercityRoomEntered pulse
    // (the immediate venture-on-take), apply the room's printed effect so
    // Initiative-granting cards from Commander Legends 2 / Battle for
    // Baldur's Gate produce the canonical board impact (treasure /
    // skeleton / draw / etc.) rather than just stamping the flag.
    const events = grantInitiative(game, seat);
    for (const evt of events) {
      yield { kind: "event", event: evt };
      if (evt.kind === "UndercityRoomEntered") {
        yield* applyUndercityRoomEffect(game, evt.payload.playerSeat, evt.payload.room);
      }
    }
  }
}
effectRegistry.register(TakeInitiativeEffect);

// 19. VillainousChoice --------------------------------------------------------
// Forge `SP$ VillainousChoice` (Innistrad: Crimson Vow + ~5 cards from
// Murders at Karlov Manor). Each affected opponent picks one of N branches;
// the chosen branch resolves for that opponent.
//
// Wave 61.C — migrated from generic `chooseOption` (Wave 54) to
// `chooseGenericOption` so the request carries an explicit `playerSeat`
// (the OPPONENT of the source's controller — Forge: "an opponent of you
// chooses"). The chosen sub-SVar is dispatched via the existing SVar
// resolver. Validation: the response option id must be present in
// the request's choices list; on missing / invalid response we fall
// back to the first choice (deterministic default for tests without
// a controller). Canonical card: `Ensnared by the Mara`:
//   A:SP$ VillainousChoice | Defined$ Opponent | Choices$ DBDig,DBDamage
// MVP: drives a SINGLE chooser (the source-controller's first opponent
// in seat order). TODO(advanced): per-opponent branch resolution + the
// "you choose for them" override that some cards emit when an opponent
// can't make a legal choice.
export class VillainousChoiceEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "VillainousChoice";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const source = game.cards.get(sa.sourceCardId);
    if (source) source.remembered.push(sa.sourceCardId);

    const choicesRaw = hasParam(sa, "Choices") ? evaluateParamRaw(sa, "Choices") : "";
    const choices = choicesRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    if (choices.length === 0) return;

    const def = source?.paperCard.definition;
    const svars = (def?.svars ?? new Map()) as ReadonlyMap<string, SVarAst>;

    // Yield a chooseGenericOption decision (Wave 15 schema, has explicit
    // playerSeat). The chooser is the OPPONENT of the source's controller.
    // Deterministic fallback (no driver attached, or invalid pick): first
    // option in the printed order.
    const chooserSeat = otherSeat(sa.controllerSeat, game);
    const rawResponse = yield {
      kind: "decision",
      request: {
        kind: "chooseGenericOption",
        sourceId: sa.sourceCardId,
        playerSeat: chooserSeat,
        options: choices.map((id) => ({ id, description: id })),
      },
    };
    const response = rawResponse as DecisionResponse | undefined;
    // Validate: the response must be of the matching kind AND its optionId
    // must be one of the printed choices. On any mismatch fall back to
    // the first choice (canonical safe default — the legal set is non-
    // empty by the early `if (choices.length === 0) return;` above).
    const validIds = new Set(choices);
    const pickedId =
      response && response.kind === "chooseGenericOption" && validIds.has(response.optionId)
        ? response.optionId
        : choices[0];
    if (pickedId === undefined) return;

    const sv = svars.get(pickedId);
    if (!sv || sv.kind !== "ability" || !sv.ability) return;
    const fakeAst: AbilityAst = { kind: "spell", effect: sv.ability, cost: { raw: "" } };
    const sub = new SpellAbility(fakeAst, sa.sourceCardId, sa.controllerSeat, svars, sa.targets);
    yield* sub.makeResolver().resolve(game) as Generator<EngineYield, void, unknown>;
  }
}
effectRegistry.register(VillainousChoiceEffect);

// 20. RollPlanarDice ----------------------------------------------------------
// Forge `SP$ RollPlanarDice` (Planechase) — roll the planar die. MVP: emit
// PlanarDieRolled with deterministic "blank" face so handlers see the canonical
// shape; full RNG-driven roll is a SP4 follow-up.
export class RollPlanarDiceEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "RollPlanarDice";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    yield {
      kind: "event",
      event: {
        kind: "PlanarDieRolled",
        version: 1,
        turn: game.turn,
        phase: game.phase,
        payload: { rollingSeat: sa.controllerSeat, result: "blank" },
      },
    };
    // TODO(advanced): route through game.rng for the actual 1-in-6 chaos /
    // 1-in-6 planeswalk roll, and re-roll on chaos-die replacement effects.
  }
}
effectRegistry.register(RollPlanarDiceEffect);

// 21. ImmediateTrigger --------------------------------------------------------
// Forge `SP$ ImmediateTrigger` — fires the SubAbility immediately as if it
// were a triggered ability. MVP: resolve SubAbility$ inline.
export class ImmediateTriggerEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ImmediateTrigger";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const subParam = sa.ast.effect.params.SubAbility;
    if (!subParam || subParam.kind !== "literal") return;
    const subKey = subParam.raw;
    if (!subKey) return;
    const def = game.cards.get(sa.sourceCardId)?.paperCard.definition;
    const svars = (def?.svars ?? new Map()) as ReadonlyMap<string, SVarAst>;
    const sv = svars.get(subKey);
    if (!sv || sv.kind !== "ability" || !sv.ability) return;
    const fakeAst: AbilityAst = { kind: "spell", effect: sv.ability, cost: { raw: "" } };
    const sub = new SpellAbility(fakeAst, sa.sourceCardId, sa.controllerSeat, svars, sa.targets);
    yield* sub.makeResolver().resolve(game) as Generator<EngineYield, void, unknown>;
  }
}
effectRegistry.register(ImmediateTriggerEffect);

// 22. RestartGame -------------------------------------------------------------
// Forge `SP$ RestartGame` (Karn Liberated -14, Time Reversal-style ults).
// Wave 54 — emit a `GameRestartRequested` engine pulse and stamp
// `game.flags.restartRequested = true` so the priority orchestrator /
// SubgameRunner observe the request and tear down the active game state.
// MVP keeps state intact (the actual library re-shuffle + life-reset +
// turn-0 advance lives in the GameSession bootstrap layer); the flag +
// pulse give downstream wiring the canonical hook. Riding the existing
// `SubgameStarted`/`SubgameEnded` family avoids minting a new event
// kind in this wave; TODO(advanced) lands a dedicated GameRestart event
// once the GameSession harness is ready to consume it.
export class RestartGameEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "RestartGame";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    (game.flags as unknown as { restartRequested?: boolean }).restartRequested = true;
    (game.flags as unknown as { restartRequestedBy?: PlayerSeat }).restartRequestedBy = sa.controllerSeat;
    // Surface the request via an SubgameStarted pulse — the closest
    // existing canonical event family. `parentTurn` carries the current
    // turn so observers can correlate the restart point to its trigger.
    yield game.emitEvent(
      mkEvent("SubgameStarted", game.turn, game.phase, {
        parentTurn: game.turn,
      }),
    );
    // TODO(advanced): emit a dedicated GameRestartRequested event + actually
    // tear down + re-seed the game state (libraries, life, hand, turn=0,
    // active player = the spell's controller) once the GameSession layer
    // exposes the harness hook.
  }
}
effectRegistry.register(RestartGameEffect);

// 23. Endure ------------------------------------------------------------------
// Bloomburrow `SP$ Endure` (CR 702.171). When a creature dies, choose:
// put N +1/+1 counters on a creature you control (counter mode), OR create
// an N/N white Spirit creature token with bands-with-other Spirits (token
// mode).
//
// Wave 61.B — migrated from the Wave 54 generic chooseOption to the typed
// `chooseEndureOption` decision request added in Wave 56. The response
// carries a `option: "counters" | "token"` discriminator instead of a
// free-form string. Counter mode applies N +1/+1 counters to the first
// target (or to the source as fallback). Token mode synthesizes the N/N
// Spirit via tokenDatabase + game.action.createToken; bands-with-other
// is left as TODO(advanced) until the keyword resolver handles
// bands-with-other on tokens.
export class EndureEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Endure";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "Num") ? evaluateParamNumber(sa, "Num", game) : 1;
    const rawResponse = yield {
      kind: "decision",
      request: {
        kind: "chooseEndureOption",
        playerSeat: sa.controllerSeat,
        sourceId: sa.sourceCardId,
        amount: num,
      },
    };
    const response = rawResponse as DecisionResponse | undefined;
    // Validate the response — accept only the typed discriminator. On any
    // invalid / missing response fall back to "counters" (the safer
    // canonical default — counters on a creature you already control vs
    // synthesizing a token from outside the corpus).
    const picked: "counters" | "token" =
      response &&
      response.kind === "chooseEndureOption" &&
      (response.option === "counters" || response.option === "token")
        ? response.option
        : "counters";

    if (picked === "token") {
      // Mint an N/N white Spirit creature token. tokenDatabase only carries
      // a fixed-size 1/1 white Spirit entry today (Wave 14 token canon);
      // for Endure we synthesize a tailored Spirit paperCard inline so the
      // printed P/T scales with the Endure N param. The
      // bands-with-other-Spirits keyword is omitted here (TODO(advanced) —
      // the bands resolver doesn't yet honour token-source keywords; the
      // canonical 1/1-flying Spirit entry is referenced for color identity
      // so the synthesized token stays consistent with the existing Spirit
      // canon).
      const referenceSpirit = tokenDatabase.get("w_1_1_spirit_flying");
      const definition: CardDefinition = {
        name: "Spirit",
        oracle: "Bands with other Spirits.",
        types: TypeLine.parse("Creature — Spirit"),
        manaCost: null,
        pt: { power: String(num), toughness: String(num) },
        colors: referenceSpirit?.colors ?? ColorSet.empty(),
        abilities: [],
        triggers: [],
        replacements: [],
        statics: [],
        keywords: [],
        svars: new Map(),
      };
      const paperCard: PaperCard = {
        name: "Spirit",
        edition: "TOK",
        collectorNumber: "0",
        language: "en",
        foil: false,
        flags: DEFAULT_PAPER_CARD_FLAGS,
        definition,
      };
      yield* game.action.createToken({
        paperCard,
        controller: sa.controllerSeat,
        count: 1,
      });
      // Stamp the requested amount on the source so observers can correlate
      // the resolved branch (back-compat with Wave 54 tests). TODO(advanced):
      // remove once consumers migrate to inspecting the actual token entity.
      const source = game.cards.get(sa.sourceCardId);
      if (source) {
        (source as unknown as { endureTokenRequested?: number }).endureTokenRequested = num;
      }
      return;
    }
    // Counter mode — apply N +1/+1 counters. MVP: place all counters on the
    // first target (or the source as fallback). TODO(advanced): yield a
    // distributeCounters request so the controller can split across multiple
    // creatures they control (canonical Endure rule allows distribution).
    const ids = sa.targets.length > 0 ? sa.targets : [sa.sourceCardId];
    let remaining = num;
    for (const id of ids) {
      if (remaining <= 0) break;
      const card = game.cards.get(id);
      if (!card) continue;
      yield* game.action.addCounter(id, CounterType.PlusOnePlusOne, remaining, sa.sourceCardId);
      remaining = 0;
    }
  }
}
effectRegistry.register(EndureEffect);

// 24. Learn -------------------------------------------------------------------
// Strixhaven `SP$ Learn` (CR 701.27, ~21 cards). "Reveal a Lesson card you
// own from outside the game and put it into your hand, OR discard a card;
// if you do, draw a card."
//
// Wave 61.B — migrated from the Wave 54 generic chooseOption to the typed
// `chooseLearnOption` decision request added in Wave 56. The response
// carries `option: "lesson" | "discardDraw"` instead of a free-form string.
// The discard-then-draw branch is fully implemented; the lesson-tutor
// branch is a graceful fallback (sideboard-as-OutsideTheGame zone lands
// in Wave 66 — see project memory). When the chooser picks lesson but no
// Lesson is reachable, we stamp a flag on the source so observers can see
// the branch resolved without crashing.
export class LearnEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Learn";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const seat = sa.controllerSeat;
    const player = game.getPlayer(seat);
    const hand = player.zones.get(ZoneType.Hand);
    const handCards = hand ? hand.toArray() : [];
    const canDiscard = handCards.length > 0;

    const rawResponse = yield {
      kind: "decision",
      request: {
        kind: "chooseLearnOption",
        playerSeat: seat,
        sourceId: sa.sourceCardId,
        canDiscard,
      },
    };
    const response = rawResponse as DecisionResponse | undefined;
    // Validate the response shape. Accept only the typed Wave 56
    // discriminator. On any invalid / missing response fall back to the
    // legal default: discardDraw when the hand is non-empty, else lesson
    // (the sideboard-tutor stub). This matches RandomLegalController's
    // canDiscard-aware default in `chooseLearnOption`.
    let picked: "lesson" | "discardDraw" = canDiscard ? "discardDraw" : "lesson";
    if (response && response.kind === "chooseLearnOption") {
      if (response.option === "lesson" || response.option === "discardDraw") {
        picked = response.option;
      }
    }
    // Engine guard: discard branch requires a non-empty hand. If the
    // chooser picks discardDraw with an empty hand (the controller misread
    // canDiscard), gracefully degrade to the lesson branch.
    if (picked === "discardDraw" && !canDiscard) picked = "lesson";

    if (picked === "lesson") {
      // Wave 66 — lesson tutor. Search the sideboard for cards with the
      // "Lesson" subtype, yield chooseCard, and move the chosen card from
      // sideboard → hand. CR 701.27a: "the player may reveal a Lesson card
      // they own from outside the game and put it into their hand."
      // CR 701.27b: if there is no Lesson, the lesson branch is a no-op
      // (we stamp `learnLessonRequested` so observers can see the branch
      // resolved without a tutor target).
      const source = game.cards.get(sa.sourceCardId);
      const sideboard = player.zones.get(ZoneType.Sideboard);
      const sideboardIds = sideboard ? sideboard.toArray() : [];
      const lessons = sideboardIds.filter((id) => {
        const c = game.cards.get(id);
        if (!c) return false;
        const subtypes = c.paperCard.definition?.types?.subtypes;
        // `subtypes` may be a readonly array (TypeLine.subtypes) or
        // undefined for tokens / emblems / no-definition cards. Lesson is
        // a Sorcery subtype (CR 205.3m) printed exactly as "Lesson".
        return subtypes?.includes("Lesson") === true;
      });
      if (lessons.length === 0) {
        // No legal Lesson — graceful fallback, stamp flag, return.
        if (source) {
          (source as unknown as { learnLessonRequested?: boolean }).learnLessonRequested = true;
        }
        return;
      }
      const tutorResp = yield {
        kind: "decision",
        request: {
          kind: "chooseCard",
          playerSeat: seat,
          pool: lessons,
          restriction: { lessonTutor: true },
          min: 0,
          max: 1,
        },
      };
      const r = tutorResp as DecisionResponse | undefined;
      let chosenId: EntityId | undefined;
      if (r && r.kind === "chooseCard" && r.chosen.length > 0) {
        const candidate = r.chosen[0];
        if (candidate !== undefined && lessons.includes(candidate)) {
          chosenId = candidate;
        }
      }
      if (chosenId === undefined) {
        // Controller declined — stamp the flag (matches CR 701.27b "may"
        // semantics: the player CAN choose to do nothing).
        if (source) {
          (source as unknown as { learnLessonRequested?: boolean }).learnLessonRequested = true;
        }
        return;
      }
      yield* game.action.moveTo(chosenId, ZoneType.Hand, { toSeat: seat, cause: "learn-lesson" });
      // Stamp the slot too — observers / tests can see the lesson branch
      // resolved AND that a card was actually pulled.
      if (source) {
        (source as unknown as { learnLessonRequested?: boolean }).learnLessonRequested = true;
      }
      return;
    }
    // Discard-then-draw. Discard the front of hand (matching DiscardEffect's
    // MVP convention). The "if you do" gate (CR 701.27a) — if the hand is
    // empty, no discard happens but no draw either — is upheld by the
    // canDiscard check above which routes empty-hand to the lesson branch.
    const toDiscardId = handCards[0];
    if (toDiscardId === undefined) return;
    yield* game.action.moveTo(toDiscardId, ZoneType.Graveyard);
    yield game.emitEvent(
      mkEvent("CardDiscarded", game.turn, game.phase, {
        cardId: toDiscardId,
        playerSeat: seat,
        cause: "effect",
      }),
    );
    yield* game.action.drawCards(seat, 1);
  }
}
effectRegistry.register(LearnEffect);

// 25. ReorderZone -------------------------------------------------------------
// Forge `SP$ ReorderZone` — let a player reorder cards in a zone (most
// often library top after Scry/Surveil/Mystical Tutor).
//
// Wave 61.A — yields an orderCards decision; the response permutation is
// applied by stripping the affected prefix and re-adding in the chosen
// order at the top of the zone (forge-game/.../ReorderEffect.java behaviour).
// Validation: the response MUST be a bijection over the input prefix; on
// invalid responses we fall back to the original ordering and continue
// (TODO(advanced) for hardened error reporting upstream).
export class ReorderZoneEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ReorderZone";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const zoneRaw = hasParam(sa, "Zone") ? evaluateParamRaw(sa, "Zone").trim() : "Library";
    const num = hasParam(sa, "Number") ? evaluateParamNumber(sa, "Number", game) : 0;
    const seat = sa.controllerSeat;
    const player = game.getPlayer(seat);
    const zoneType =
      zoneRaw === "Hand" ? ZoneType.Hand : zoneRaw === "Graveyard" ? ZoneType.Graveyard : ZoneType.Library;
    const zone = player.zones.get(zoneType);
    if (!zone) return;
    const ids = zone.toArray();
    if (ids.length === 0) return;
    // Reveal the prefix to the controller so observers see the peek.
    const prefix = num > 0 ? ids.slice(0, Math.min(num, ids.length)) : ids.slice();
    yield game.emitEvent(
      mkEvent("CardsRevealed", game.turn, game.phase, {
        revealedBy: seat,
        revealedTo: [seat],
        cardIds: prefix,
        fromZone: zoneType,
      }),
    );
    if (prefix.length === 0) return;

    // Yield the orderCards decision so the controller picks the new order.
    const rawResponse = yield {
      kind: "decision",
      request: {
        kind: "orderCards",
        playerSeat: seat,
        sourceId: sa.sourceCardId,
        cards: prefix,
      },
    };
    const response = rawResponse as DecisionResponse | undefined;
    let ordered: readonly EntityId[] = prefix;
    if (response && response.kind === "orderCards") {
      const candidate = response.ordered;
      // Validate permutation: same length and same multiset of ids.
      if (candidate.length === prefix.length) {
        const expected = new Set(prefix);
        const seen = new Set<EntityId>();
        let ok = true;
        for (const id of candidate) {
          if (!expected.has(id) || seen.has(id)) {
            ok = false;
            break;
          }
          seen.add(id);
        }
        if (ok) ordered = candidate.slice();
        // TODO(advanced): surface a structured warning when the controller
        // returns an invalid permutation — current path silently falls back.
      }
    }

    // Apply: remove each card in the prefix from the zone, then re-add at
    // the top in REVERSE order so ordered[0] ends up at index 0 (top).
    for (const id of prefix) zone.remove(id);
    for (let i = ordered.length - 1; i >= 0; i--) {
      const id = ordered[i];
      if (id !== undefined) zone.addToTop(id);
    }
  }
}
effectRegistry.register(ReorderZoneEffect);

// 26. OpenAttraction ----------------------------------------------------------
// Unfinity `SP$ OpenAttraction` — put an Attraction from the controller's
// attraction deck onto the battlefield (CR 716, Unfinity supplement).
//
// Wave 54 — bumps the per-seat attractions counter on game.flags + on the
// source card so observers can detect the open. Emits a
// ContraptionAssembled pulse (the closest existing event family —
// Attractions and Contraptions share the deck-pop machinery) so triggers
// observing "when you open an Attraction" can latch.
// TODO(advanced): pull from a real Attraction sub-deck once the
// cards-package surfaces it; for now we share AssembleContraption's flag
// shape so both Unfinity mechanics evolve in lock-step.
export class OpenAttractionEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "OpenAttraction";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const seat = sa.controllerSeat;
    const num = hasParam(sa, "Amount") ? evaluateParamNumber(sa, "Amount", game) : 1;
    const prior = game.flags.attractions.get(seat) as
      | { openedAttractions?: number; assembledContraptions?: number }
      | undefined;
    const opened = (prior?.openedAttractions ?? 0) + num;
    game.flags.attractions.set(seat, { ...(prior ?? {}), openedAttractions: opened });
    const source = game.cards.get(sa.sourceCardId);
    if (source) {
      source.attractions = (source.attractions ?? 0) + num;
    }
    yield game.emitEvent({
      kind: "ContraptionAssembled",
      version: 1,
      turn: game.turn,
      phase: game.phase,
      payload: {
        playerSeat: seat,
        sourceCardId: sa.sourceCardId,
      },
    });
  }
}
effectRegistry.register(OpenAttractionEffect);

// 27. MultiplePiles -----------------------------------------------------------
// Forge `SP$ MultiplePiles` — Fact-or-Fiction-style: a defined player
// divides N cards into M piles; an opponent picks one pile, claiming it
// (the rest go to graveyard). Generalization of TwoPiles.
//
// Wave 61.A — yields a dividePileChoice request to the SPLITTING player
// (the source controller's opponent — Forge's "an opponent of you divides"
// canonical), then a follow-up choice request to the CHOOSING player
// (the source controller). For the chooser we use chooseCardsPile when
// numPiles == 2 (the FoF-2-pile classical case) and chooseOption with
// pile-index ids for numPiles > 2 (TODO(advanced): a richer
// `chooseFromList` request kind). Validation: the divider's piles must
// be a partition (each card exactly once, piles.length === numPiles).
// On invalid responses we fall back to the engine-side even split.
export class MultiplePilesEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "MultiplePiles";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "Num") ? evaluateParamNumber(sa, "Num", game) : 5;
    const numPiles = hasParam(sa, "Piles") ? evaluateParamNumber(sa, "Piles", game) : 2;
    const controllerSeat = sa.controllerSeat;
    const controllerPlayer = game.getPlayer(controllerSeat);
    const library = controllerPlayer.zones.get(ZoneType.Library);
    if (!library) return;
    const top = library.toArray().slice(0, Math.min(num, library.size));
    if (top.length === 0) {
      // Stamp a remembered marker so observers see the effect ran on an
      // empty pool (canonical FoF behaviour: nothing happens).
      const source = game.cards.get(sa.sourceCardId);
      if (source) source.remembered.push(sa.sourceCardId);
      return;
    }
    // Forge canonical: the source-controller's opponent splits, the
    // source-controller chooses. With only one opponent in 1v1 the
    // splitter resolves deterministically.
    const splitterSeat = otherSeat(controllerSeat, game);
    const chooserSeat = controllerSeat;
    const effectiveNumPiles = Math.max(1, Math.min(numPiles, top.length));

    // Default even-split partition (engine fallback).
    const defaultPiles: EntityId[][] = [];
    for (let i = 0; i < effectiveNumPiles; i++) defaultPiles.push([]);
    for (let i = 0; i < top.length; i++) {
      const id = top[i];
      if (id === undefined) continue;
      const pile = defaultPiles[i % effectiveNumPiles];
      if (pile) pile.push(id);
    }

    // Yield dividePileChoice to the splitting player.
    const splitRaw = yield {
      kind: "decision",
      request: {
        kind: "dividePileChoice",
        playerSeat: splitterSeat,
        sourceId: sa.sourceCardId,
        cards: top,
        numPiles: effectiveNumPiles,
      },
    };
    const splitResp = splitRaw as DecisionResponse | undefined;
    let piles: readonly (readonly EntityId[])[] = defaultPiles;
    if (splitResp && splitResp.kind === "dividePileChoice") {
      const candidate = splitResp.piles;
      // Validate: piles.length === effectiveNumPiles AND every input id
      // appears exactly once across the union of all piles.
      let ok = candidate.length === effectiveNumPiles;
      if (ok) {
        const seen = new Set<EntityId>();
        const expected = new Set(top);
        for (const pile of candidate) {
          for (const id of pile) {
            if (!expected.has(id) || seen.has(id)) {
              ok = false;
              break;
            }
            seen.add(id);
          }
          if (!ok) break;
        }
        if (ok && seen.size !== top.length) ok = false;
      }
      if (ok) piles = candidate;
      // TODO(advanced): surface a structured warning for invalid partitions
      // upstream — current path silently falls back to engine even-split.
    }

    // Yield the chooser's pick. 2-pile case maps to the canonical
    // chooseCardsPile request (sourceId-only schema) so existing controllers
    // and tests on that path continue to work. For N>2 we fall back to
    // chooseOption with pile-index ids; TODO(advanced) once a richer
    // chooseFromList request kind exists.
    let chosenIndex = 0;
    if (effectiveNumPiles === 2) {
      const pileA = piles[0] ?? [];
      const pileB = piles[1] ?? [];
      const pickRaw = yield {
        kind: "decision",
        request: {
          kind: "chooseCardsPile",
          sourceId: sa.sourceCardId,
          pileA,
          pileB,
        },
      };
      const pickResp = pickRaw as DecisionResponse | undefined;
      if (pickResp && pickResp.kind === "chooseCardsPile") {
        chosenIndex = pickResp.chosen === "b" ? 1 : 0;
      }
    } else {
      const options = piles.map((_p, i) => ({
        id: String(i),
        description: `Pile ${i + 1}`,
      }));
      const pickRaw = yield {
        kind: "decision",
        request: {
          kind: "chooseOption",
          sourceId: sa.sourceCardId,
          options,
        },
      };
      const pickResp = pickRaw as DecisionResponse | undefined;
      if (pickResp && pickResp.kind === "chooseOption") {
        const idx = Number.parseInt(pickResp.optionId, 10);
        if (Number.isFinite(idx) && idx >= 0 && idx < piles.length) chosenIndex = idx;
      }
      // Suppress unused-binding warning for chooserSeat in the N>2 branch —
      // the chooseOption request kind doesn't carry a playerSeat field.
      void chooserSeat;
    }

    const claimed = piles[chosenIndex] ?? [];
    // All non-chosen piles' cards go to graveyard (FoF discarded pile).
    for (let i = 0; i < piles.length; i++) {
      if (i === chosenIndex) continue;
      const pile = piles[i];
      if (!pile) continue;
      for (const id of pile) {
        yield* game.action.moveTo(id, ZoneType.Graveyard);
      }
    }
    for (const id of claimed) {
      yield* game.action.moveTo(id, ZoneType.Hand);
    }
    // Stamp the chosen pile on remembered for downstream observers.
    const source = game.cards.get(sa.sourceCardId);
    if (source) {
      for (const id of claimed) source.remembered.push(id);
    }
  }
}
effectRegistry.register(MultiplePilesEffect);
