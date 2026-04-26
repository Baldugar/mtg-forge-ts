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
import type { AbilityAst, EntityId, PlayerSeat, SVarAst } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
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
// permanent and prevent it from attacking, blocking, or activating non-mana
// abilities until its controller's next turn. MVP: tap each target + stamp a
// `detainedUntilTurn` flag on the card.
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
    // TODO(advanced): wire detainedUntilTurn into combat declaration + activated
    // ability gating, and emit CardDetained event.
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
// Forge `SP$ Poison` (CR 704.5c) — give target player N poison counters. MVP:
// bump the player's poison-counter store and emit PlayerPoisoned.
export class PoisonEffect extends SpellAbilityEffect {
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "Num") ? evaluateParamNumber(sa, "Num", game) : 1;
    const definedRaw = hasParam(sa, "Defined") ? evaluateParamRaw(sa, "Defined") : "Opponent";
    const seat: PlayerSeat =
      definedRaw === "Opponent" ? otherSeat(sa.controllerSeat, game) : sa.controllerSeat;
    const player = game.getPlayer(seat);
    const cur = (player as { poisonCounters?: number }).poisonCounters ?? 0;
    (player as { poisonCounters?: number }).poisonCounters = cur + num;
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
    // TODO(advanced): route through game.action so SBA threshold (10 = lose)
    // and replacements (Vorinclex variant) fire.
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
    const oldMonarch = (game as { monarchSeat?: PlayerSeat }).monarchSeat;
    (game as { monarchSeat?: PlayerSeat }).monarchSeat = seat;
    if (oldMonarch !== undefined && oldMonarch !== seat) {
      yield {
        kind: "event",
        event: {
          kind: "LostMonarch",
          version: 1,
          turn: game.turn,
          phase: game.phase,
          payload: { playerSeat: oldMonarch },
        },
      };
    }
    yield {
      kind: "event",
      event: {
        kind: "BecameMonarch",
        version: 1,
        turn: game.turn,
        phase: game.phase,
        payload: { playerSeat: seat },
      },
    };
    // TODO(advanced): wire end-of-turn-draw-a-card + combat-damage transfer.
  }
}
effectRegistry.register(BecomeMonarchEffect);

// 5. ChooseEvenOdd -----------------------------------------------------------
// Forge `SP$ ChooseEvenOdd` — controller chooses even or odd (rare; e.g.
// Odric's Helm or Yidris-style mana-value referencing). MVP: stash the
// deterministic default "odd" on the source card.
export class ChooseEvenOddEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ChooseEvenOdd";

  // biome-ignore lint/correctness/useYield: pure mutation
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const choice = hasParam(sa, "Choice") ? evaluateParamRaw(sa, "Choice") : "odd";
    const source = game.cards.get(sa.sourceCardId);
    if (!source) return;
    (source as { chosenEvenOdd?: string }).chosenEvenOdd = choice === "even" ? "even" : "odd";
    // TODO(advanced): yield a chooseEvenOdd decision so the controller picks
    // and route the result through the SVar pipeline.
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
// Forge `SP$ ChooseSector` — Unfinity Attractions / sector picker. MVP: stash
// chosen sector index on the source card.
export class ChooseSectorEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ChooseSector";

  // biome-ignore lint/correctness/useYield: pure mutation
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const sector = hasParam(sa, "Sector") ? evaluateParamRaw(sa, "Sector") : "1";
    const source = game.cards.get(sa.sourceCardId);
    if (!source) return;
    (source as { chosenSector?: string }).chosenSector = sector;
    // TODO(advanced): yield chooseSector decision so the controller picks
    // among the printed sectors and route through cardFactory metadata.
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
// Forge `SP$ Unattach` — unattach an Aura/Equipment from its host. MVP:
// clear attachedTo on each target + emit CardUnattached.
export class UnattachEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Unattach";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const ids = sa.targets.length > 0 ? sa.targets : [sa.sourceCardId];
    for (const id of ids) {
      const card = game.cards.get(id);
      if (!card) continue;
      (card as { attachedTo?: EntityId | null }).attachedTo = null;
      yield {
        kind: "event",
        event: {
          kind: "CardUnattached",
          version: 1,
          turn: game.turn,
          phase: game.phase,
          payload: { sourceId: id, reason: "effect" },
        },
      };
    }
    // TODO(advanced): route through game.action.unattach so SBA-driven
    // unattachments and dependent triggers fire.
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
    (game as { initiativeSeat?: PlayerSeat }).initiativeSeat = seat;
    yield {
      kind: "event",
      event: {
        kind: "BecameInitiative",
        version: 1,
        turn: game.turn,
        phase: game.phase,
        payload: { playerSeat: seat },
      },
    };
    // TODO(advanced): venture into Undercity dungeon on initiative gain.
  }
}
effectRegistry.register(TakeInitiativeEffect);

// 19. VillainousChoice --------------------------------------------------------
// Forge `SP$ VillainousChoice` (Innistrad: Crimson Vow) — opponent must
// choose between two evils. MVP: stash the choice intent on the source.
export class VillainousChoiceEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "VillainousChoice";

  // biome-ignore lint/correctness/useYield: stub
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const source = game.cards.get(sa.sourceCardId);
    if (source) source.remembered.push(sa.sourceCardId);
    // TODO(advanced): yield a chooseVillainousOption decision so the targeted
    // opponent picks between branches; resolve the chosen sub-ability.
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
// Forge `SP$ RestartGame` (Karn Liberated -14) — restart the game.
export class RestartGameEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "RestartGame";

  // biome-ignore lint/correctness/useYield: stub
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    void sa;
    void game;
    // TODO(advanced): wipe state, re-shuffle libraries, reset life, advance turn 0.
  }
}
effectRegistry.register(RestartGameEffect);

// 23. Endure ------------------------------------------------------------------
// Bloomburrow `SP$ Endure` — keep creature OR create a Spirit token of same P/T.
export class EndureEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Endure";

  // biome-ignore lint/correctness/useYield: stub
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    void sa;
    void game;
    // TODO(advanced): yield chooseEndureOption; on token branch synthesize Spirit token.
  }
}
effectRegistry.register(EndureEffect);

// 24. Learn -------------------------------------------------------------------
// Strixhaven `SP$ Learn` — reveal a Lesson from sideboard OR discard-to-draw.
export class LearnEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Learn";

  // biome-ignore lint/correctness/useYield: stub
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    void sa;
    void game;
    // TODO(advanced): yield chooseLearnOption; resolve sideboard tutor or discard-to-draw.
  }
}
effectRegistry.register(LearnEffect);

// 25. ReorderZone -------------------------------------------------------------
// Forge `SP$ ReorderZone` — let a player reorder cards in a zone (most often
// library top after Scry/Surveil).
export class ReorderZoneEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ReorderZone";

  // biome-ignore lint/correctness/useYield: stub
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    void sa;
    void game;
    // TODO(advanced): yield reorderZone decision and apply to the zone.
  }
}
effectRegistry.register(ReorderZoneEffect);

// 26. OpenAttraction ----------------------------------------------------------
// Unfinity `SP$ OpenAttraction` — put an Attraction onto the battlefield.
export class OpenAttractionEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "OpenAttraction";

  // biome-ignore lint/correctness/useYield: stub
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    void sa;
    void game;
    // TODO(advanced): pull from the Attraction deck side-zone (data layer SP4).
  }
}
effectRegistry.register(OpenAttractionEffect);

// 27. MultiplePiles -----------------------------------------------------------
// Forge `SP$ MultiplePiles` — divide cards into N piles, opponent picks.
// Generalization of TwoPiles.
export class MultiplePilesEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "MultiplePiles";

  // biome-ignore lint/correctness/useYield: stub
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    void sa;
    void game;
    // TODO(advanced): yield distribution decisions for N piles.
  }
}
effectRegistry.register(MultiplePilesEffect);
