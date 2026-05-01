// SPDX-License-Identifier: GPL-3.0-or-later
// GameEvent — engine-emitted, append-only, discriminated union observed by
// replay pipelines, GameLog adapters, AI feature extractors, and future SP2
// subscription hooks. Shape is fixed by SP1 spec §8:
//
//   { kind: string, version: number, turn: number, phase: PhaseStep, payload: {...} }
//
// Every payload is deep-readonly so consumers cannot mutate shared snapshots.
// `version` is a literal on each variant so breaking payload changes become
// distinct union members (v2 variant coexists with v1 until readers migrate),
// following the master-spec §11 compatibility rule.
//
// Construction uses `mkEvent` for type-safe payload narrowing; `isEvent`
// narrows a GameEvent to a specific kind for simple, non-switch consumers.

import type { Color } from "../color.js";
import type { EntityId, PlayerSeat } from "../ids.js";
import type { PhaseStep } from "../phase.js";
import type { ZoneType } from "../zone.js";

/**
 * Full enumeration of engine events — 90 kinds across 9 families. The SP1
 * spec §8 baseline was 63 kinds; the post-audit expansion adds 16 Forge-
 * required kinds (Scry/Surveil/Shuffle zone-family, Mana family, day/night
 * + door/speed updates to Monarch-family, ModeChosen on Stack, Poison/
 * Radiation on Player, FlipCoin/RollDie/Subgame on Meta, CardPlotted +
 * TokenCreated on Zone). SP2 §B locks the taxonomy at version:1 and adds
 * 11 Engine-internal kinds (registry bookkeeping, replacement/trigger
 * pipeline telemetry, SBA applications, cost-paid transitions, step-end
 * completion) consumed by the upcoming registries (Tasks 16-34). Variants
 * stay grouped by inline family comments so additions land in the right
 * section.
 *
 * Schema contract: every variant carries `readonly version: 1`. Breaking
 * payload changes land as new variants (v2) that coexist with v1 until
 * readers migrate; SP2 does not introduce any v2 kinds.
 */
export type GameEvent =
  // === Zone change (10) ===
  | {
      readonly kind: "CardDrawn";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat; readonly cardId: EntityId };
    }
  | {
      readonly kind: "CardDiscarded";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly cardId: EntityId;
        readonly cause: "discard" | "effect" | "handSize";
      };
    }
  | {
      readonly kind: "CardMilled";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat; readonly cardId: EntityId };
    }
  | {
      readonly kind: "CardDestroyed";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly cardId: EntityId;
        readonly sourceId?: EntityId;
        readonly cause: "damage" | "sba" | "effect";
      };
    }
  | {
      readonly kind: "CardExiled";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly cardId: EntityId;
        readonly fromZone: ZoneType;
        readonly sourceId?: EntityId;
      };
    }
  | {
      readonly kind: "CardSacrificed";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly cardId: EntityId;
        readonly playerSeat: PlayerSeat;
        readonly sourceId?: EntityId;
      };
    }
  | {
      readonly kind: "CardReturned";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly cardId: EntityId;
        readonly fromZone: ZoneType;
        readonly toZone: ZoneType;
        readonly toPlayer?: PlayerSeat;
      };
    }
  | {
      readonly kind: "CardCycled";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId; readonly playerSeat: PlayerSeat };
    }
  | {
      readonly kind: "CardForetold";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId; readonly playerSeat: PlayerSeat };
    }
  | {
      readonly kind: "CardChangedZone";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly cardId: EntityId;
        readonly fromZone: ZoneType;
        readonly toZone: ZoneType;
        readonly fromSeat?: PlayerSeat;
        readonly toSeat?: PlayerSeat;
        readonly cause?: string;
      };
    }
  // === State change (12) ===
  | {
      readonly kind: "LifeChanged";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly oldLife: number;
        readonly newLife: number;
        readonly delta: number;
        readonly cause: string;
      };
    }
  | {
      readonly kind: "CounterAdded";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly cardId: EntityId;
        readonly counterType: string;
        readonly amount: number;
        readonly sourceId?: EntityId;
      };
    }
  | {
      readonly kind: "CounterRemoved";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly cardId: EntityId;
        readonly counterType: string;
        readonly amount: number;
        readonly sourceId?: EntityId;
      };
    }
  | {
      readonly kind: "CardTapped";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId; readonly sourceId?: EntityId };
    }
  | {
      readonly kind: "CardUntapped";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId; readonly sourceId?: EntityId };
    }
  | {
      readonly kind: "ControlChanged";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly cardId: EntityId;
        readonly oldController: PlayerSeat;
        readonly newController: PlayerSeat;
        readonly sourceId?: EntityId;
      };
    }
  | {
      readonly kind: "AttachmentChanged";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly cardId: EntityId;
        readonly oldAttachedTo?: EntityId;
        readonly newAttachedTo?: EntityId;
      };
    }
  | {
      readonly kind: "CardAttached";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      // SP2 Milestone K Task 42 — GameAction.attach emits this on a
      // successful attachment. `cause` tracks the provenance path so
      // triggers ("whenever an Aura you control becomes attached")
      // can distinguish cast-time attachments from static/SBA-driven
      // ones. `AttachmentChanged` remains the generic "attachment
      // relationship changed" event; CardAttached/CardUnattached are
      // the directional pair mirroring the attach/unattach mutators.
      readonly payload: {
        readonly sourceId: EntityId;
        readonly targetId: EntityId;
        readonly cause: "cast" | "static" | "sba" | "activated";
      };
    }
  | {
      readonly kind: "CardUnattached";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly sourceId: EntityId;
        readonly reason: "sba" | "targetLeft" | "effect";
      };
    }
  | {
      readonly kind: "PhasedOut";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId; readonly direct: boolean };
    }
  | {
      readonly kind: "PhasedIn";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId; readonly direct: boolean };
    }
  | {
      readonly kind: "Flipped";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId };
    }
  | {
      readonly kind: "Transformed";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId; readonly toFace: "front" | "back" };
    }
  | {
      readonly kind: "FaceDownStateChanged";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId; readonly faceDown: boolean };
    }
  | {
      // SP2 Task 54 (CR 701.34 / 702.37 / 702.146 / 702.168 / 702.170) —
      // turn-face-up primitive emits this alongside toggling the FaceDownState
      // to { kind: "none" }. `previousKind` is the face-down kind right before
      // the flip, so triggers like "when CARDNAME is turned face-up" can
      // branch on morph/manifest/foretell/disguise/cloak if needed.
      readonly kind: "CardTurnedFaceUp";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly cardId: EntityId;
        readonly previousKind: "morph" | "manifest" | "foretell" | "disguise" | "cloak";
      };
    }
  | {
      // SP2 Task 60 (CR 701.37) — meld primitive emits this when two named
      // cards combine into one "melded" permanent. `meldedId` is the minted
      // id of the new permanent; `sourceIds` carries the two originals so
      // re-materialization / LKI lookups can reach them.
      readonly kind: "Melded";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly meldedId: EntityId;
        readonly sourceIds: readonly EntityId[];
      };
    }
  // === Monarch/Initiative/Ring (5) ===
  | {
      readonly kind: "BecameMonarch";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat };
    }
  | {
      readonly kind: "LostMonarch";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat };
    }
  | {
      readonly kind: "BecameInitiative";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat };
    }
  | {
      readonly kind: "RingTempted";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat; readonly cardId: EntityId };
    }
  | {
      readonly kind: "RingLevelChanged";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly oldLevel: number;
        readonly newLevel: number;
      };
    }
  // === Stack (8) ===
  | {
      readonly kind: "SpellCast";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly stackItemId: EntityId;
        readonly cardId: EntityId;
        readonly controllerSeat: PlayerSeat;
        readonly xValue?: number;
      };
    }
  | {
      readonly kind: "SpellPutOnStack";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly stackItemId: EntityId;
        readonly cardId: EntityId;
        readonly controllerSeat: PlayerSeat;
      };
    }
  | {
      readonly kind: "AbilityActivated";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly stackItemId: EntityId;
        readonly sourceCardId: EntityId;
        readonly controllerSeat: PlayerSeat;
        readonly abilityKind: "activated" | "manaAbility";
      };
    }
  | {
      readonly kind: "AbilityTriggered";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly stackItemId: EntityId;
        readonly sourceCardId: EntityId;
        readonly controllerSeat: PlayerSeat;
        readonly triggerMode: string;
      };
    }
  | {
      readonly kind: "StackItemResolving";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly stackItemId: EntityId };
    }
  | {
      readonly kind: "StackItemResolved";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly stackItemId: EntityId; readonly fizzled: boolean };
    }
  | {
      readonly kind: "StackItemCountered";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly stackItemId: EntityId;
        readonly byStackItemId?: EntityId;
        readonly byEffectId?: EntityId;
      };
    }
  | {
      readonly kind: "StackItemCopied";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly originalId: EntityId;
        readonly copyId: EntityId;
        readonly controllerSeat: PlayerSeat;
      };
    }
  // === Combat (10) ===
  | {
      readonly kind: "CombatStarted";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly attackingSeat: PlayerSeat };
    }
  | {
      readonly kind: "AttackersDeclared";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly attackingSeat: PlayerSeat;
        readonly attackers: readonly {
          readonly attackerId: EntityId;
          readonly defender:
            | { readonly kind: "player"; readonly seat: PlayerSeat }
            | { readonly kind: "planeswalker"; readonly id: EntityId }
            | { readonly kind: "battle"; readonly id: EntityId };
        }[];
      };
    }
  | {
      readonly kind: "BlockersDeclared";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly defendingSeat: PlayerSeat;
        readonly blocks: readonly {
          readonly attackerId: EntityId;
          readonly blockerIds: readonly EntityId[];
        }[];
      };
    }
  | {
      readonly kind: "BlockerOrderSet";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly attackerId: EntityId; readonly blockerOrder: readonly EntityId[] };
    }
  | {
      readonly kind: "DamageAssigned";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly sourceId: EntityId;
        // WHY: damage can target creature/planeswalker/battle (EntityId) or
        // player (PlayerSeat); the discriminator routes consumers to the
        // correct branded shape without a nested union.
        readonly targetKind: "creature" | "player" | "planeswalker" | "battle";
        readonly targetId: EntityId | PlayerSeat;
        readonly amount: number;
      };
    }
  | {
      readonly kind: "DamageDealt";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly sourceId: EntityId;
        readonly targetKind: "creature" | "player" | "planeswalker" | "battle";
        readonly targetId: EntityId | PlayerSeat;
        readonly amount: number;
        readonly isCombat: boolean;
      };
    }
  | {
      readonly kind: "DamagePrevented";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly sourceId: EntityId;
        // WHY: matches DamageAssigned/DamageDealt discriminator so subscribers
        // can route uniformly on target type across all three damage events.
        readonly targetKind: "creature" | "player" | "planeswalker" | "battle";
        readonly targetId: EntityId | PlayerSeat;
        readonly amount: number;
        readonly preventorId?: EntityId;
      };
    }
  | {
      readonly kind: "AttackerBecomesBlocked";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly attackerId: EntityId };
    }
  | {
      readonly kind: "CombatEnded";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly attackingSeat: PlayerSeat };
    }
  | {
      readonly kind: "CombatCreatureDied";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId; readonly cause: "damage" | "sba" | "effect" };
    }
  // === Phase (5) ===
  | {
      readonly kind: "TurnStarted";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly activeSeat: PlayerSeat };
    }
  | {
      readonly kind: "TurnEnded";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly activeSeat: PlayerSeat };
    }
  | {
      readonly kind: "PhaseStarted";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      // WHY: spec §8 lists PhaseStarted payload as carrying the phase even
      // though the outer envelope already has it; SP2 subscription tooling
      // treats payload as self-contained, so keep the redundancy.
      readonly payload: { readonly activeSeat: PlayerSeat; readonly phase: PhaseStep };
    }
  | {
      readonly kind: "StepStarted";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly activeSeat: PlayerSeat; readonly step: PhaseStep };
    }
  | {
      readonly kind: "StepEnded";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly activeSeat: PlayerSeat; readonly step: PhaseStep };
    }
  // === Player (8) ===
  | {
      readonly kind: "PlayerLifeChanged";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      // WHY: alias-like counterpart to LifeChanged kept per spec §8 — some
      // consumers subscribe only to player-scoped summaries and ignore the
      // richer LifeChanged feed.
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly oldLife: number;
        readonly newLife: number;
        readonly delta: number;
      };
    }
  | {
      readonly kind: "PlayerDrew";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat; readonly count: number };
    }
  | {
      readonly kind: "PlayerDiscarded";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly cardIds: readonly EntityId[];
        readonly cause: "discard" | "effect" | "handSize";
      };
    }
  | {
      readonly kind: "PlayerMilled";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat; readonly count: number };
    }
  | {
      readonly kind: "PlayerLost";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly reason: "life" | "decked" | "poison" | "concede" | "effect";
      };
    }
  | {
      readonly kind: "PlayerWon";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat };
    }
  | {
      readonly kind: "PlayerConceded";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat };
    }
  | {
      readonly kind: "CityBlessingGained";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat };
    }
  // === Meta (5) ===
  | {
      readonly kind: "GameStarted";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      // WHY: seed stored as hex string (optional) so JSON round-trip never
      // loses the RNG-state fingerprint regardless of bigint support.
      readonly payload: {
        readonly seats: readonly PlayerSeat[];
        readonly firstPlayer: PlayerSeat;
        readonly seed?: string;
      };
    }
  | {
      readonly kind: "MulliganTaken";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly handBefore: number;
        readonly handAfter: number;
        readonly rule: "london" | "vancouver" | "paris" | "free";
      };
    }
  | {
      readonly kind: "GameEnded";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly winners: readonly PlayerSeat[];
        readonly reason: "victory" | "draw" | "concede" | "timeout";
      };
    }
  | {
      readonly kind: "CastAborted";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly cardId: EntityId;
        readonly reason: string;
      };
    }
  | {
      readonly kind: "ShortcutApplied";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly description: string; readonly affected: readonly EntityId[] };
    }
  // === Zone change extensions (5) ===
  | {
      readonly kind: "Scry";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat; readonly count: number };
    }
  | {
      readonly kind: "Surveil";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat; readonly count: number };
    }
  | {
      readonly kind: "Shuffle";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat; readonly zoneShuffled: ZoneType };
    }
  | {
      readonly kind: "CardPlotted";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat; readonly cardId: EntityId };
    }
  // Wave 71 — Suspect (CR 701.58, Murders at Karlov Manor). The
  // suspect/cease-being-suspected pair is emitted by the Wave 21
  // AlterAttributeEffect when `Attributes$ Suspected` flips card.suspected
  // — cardId points at the affected card; sourceId is the spell or
  // ability that suspected it (or `null` for innate K:Suspect / ETB
  // self-suspect cases).
  | {
      readonly kind: "CardSuspected";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId; readonly sourceId: EntityId | null };
    }
  | {
      readonly kind: "CardUnsuspected";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId; readonly sourceId: EntityId | null };
    }
  | {
      readonly kind: "TokenCreated";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly controllerSeat: PlayerSeat;
        readonly tokenCardId: EntityId;
        readonly definitionId?: string;
      };
    }
  // === Mana (1) ===
  // WHY: Forge emits both a pre-pool "produced" and post-pool "entered
  // pool" hook; SP1 collapses to one event ManaEnteredPool so triggers
  // that care about "whenever mana is added to your pool" get a single
  // attachment point. SP2 may split if a trigger needs the pre/post
  // distinction.
  | {
      readonly kind: "ManaEnteredPool";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly color: Color | null;
        readonly sourceId: EntityId | null;
        readonly amount: number;
      };
    }
  // === Monarch/Initiative/Ring extensions (3) ===
  | {
      readonly kind: "DayTimeChanged";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly oldValue: "day" | "night" | "neither";
        readonly newValue: "day" | "night" | "neither";
      };
    }
  | {
      readonly kind: "DoorOpened";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId; readonly doorId?: string };
    }
  | {
      readonly kind: "SpeedLevelChanged";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly oldLevel: number;
        readonly newLevel: number;
      };
    }
  // === Stack extensions (1) ===
  | {
      readonly kind: "ModeChosen";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly sourceId: EntityId; readonly modeIds: readonly string[] };
    }
  // === Player extensions (2) ===
  | {
      readonly kind: "PlayerPoisoned";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat; readonly amount: number };
    }
  | {
      readonly kind: "PlayerRadiated";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat; readonly amount: number };
    }
  // === Meta extensions (4) ===
  | {
      readonly kind: "FlipCoin";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat; readonly resultHeads: boolean };
    }
  | {
      readonly kind: "RollDie";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly sides: number;
        readonly result: number;
      };
    }
  | {
      readonly kind: "SubgameStarted";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly parentTurn: number };
    }
  | {
      readonly kind: "SubgameEnded";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly parentTurn: number; readonly outcome: string };
    }
  | {
      // Wave 44 — Shahrazad. Fired by SubgameEffect once the deterministic
      // subgame resolver picks a winner/loser. `lifeLost` is the parent-game
      // life delta the loser absorbs (half their life, rounded up). The full
      // nested-game loop with autonomous AI play remains out of scope; this
      // event is the single observable pulse the parent game gets.
      readonly kind: "SubgameResolved";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly winnerSeat: PlayerSeat;
        readonly loserSeat: PlayerSeat;
        readonly lifeLost: number;
      };
    }
  // === Planechase / Archenemy (2) — Batch D2 ===
  // WHY: niche-but-required format events. ChaosEnsues triggers (T:Mode$
  // ChaosEnsues) match PlanarDieRolled with face === "chaos"; SetInMotion
  // triggers (T:Mode$ SetInMotion) match SchemeSetInMotion. Both events are
  // stub-emitted by tests today; SP4's Planechase/Archenemy machinery will
  // emit them through a dedicated game.action.rollPlanarDice / setInMotion
  // mutator pair when those formats land.
  | {
      readonly kind: "PlanarDieRolled";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly rollingSeat: PlayerSeat;
        readonly result: "chaos" | "planeswalk" | "blank";
      };
    }
  | {
      readonly kind: "SchemeSetInMotion";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly schemeCardId: EntityId;
        readonly archenemySeat: PlayerSeat;
      };
    }
  // === Reveal (1) — Wave 4 PeekAndReveal / RevealHand ===
  | {
      readonly kind: "CardsRevealed";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly revealedBy: PlayerSeat;
        readonly revealedTo: PlayerSeat[] | "all";
        readonly cardIds: readonly EntityId[];
        readonly fromZone: ZoneType;
      };
    }
  // === Wave 16 — corpus unknown triggers (10 new kinds) ===
  // WHY: each kind feeds one of the 20 Wave 16 trigger handlers. Tests
  // synth-emit them today; engine-side emission is wired card-by-card by
  // the corresponding mechanic landing parts (Mutate, Contraptions,
  // Planechase entry, Monstrous, Crime, Land-played watcher, etc.).
  | {
      // Unstable Crank! — fires when a contraption is "cranked" (assembled).
      readonly kind: "CardCranked";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId; readonly controllerSeat: PlayerSeat };
    }
  | {
      // Planechase — fires when a player enters / planeswalks to a plane.
      readonly kind: "PlaneswalkedTo";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly planeCardId: EntityId; readonly playerSeat: PlayerSeat };
    }
  | {
      // Ikoria Mutate — fires when a card mutates onto another.
      readonly kind: "CardMutated";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly mutatorId: EntityId;
        readonly hostId: EntityId;
        readonly controllerSeat: PlayerSeat;
      };
    }
  | {
      // Fires when a card taps to add mana (Mana Reflection, Vorinclex, etc.).
      // Distinct from ManaEnteredPool: the cause must be a tap-for-mana.
      readonly kind: "ManaTapped";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly cardId: EntityId;
        readonly playerSeat: PlayerSeat;
        readonly produced: string;
      };
    }
  | {
      // Fires when mana of a specific kind is spent (e.g. ManaExpend triggers).
      readonly kind: "ManaSpent";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly color: Color | null;
        readonly amount: number;
      };
    }
  | {
      // Fires when a player plays a land for turn (Lotus Cobra, etc.).
      readonly kind: "LandPlayed";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId; readonly playerSeat: PlayerSeat };
    }
  | {
      // Fires when an attacker remains unblocked after blockers are declared.
      readonly kind: "AttackerUnblocked";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly attackerId: EntityId; readonly attackingSeat: PlayerSeat };
    }
  | {
      // Fires when counters are added to a player (poison, energy, experience…).
      readonly kind: "PlayerCounterAdded";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly counterType: string;
        readonly amount: number;
      };
    }
  | {
      // Murders at Karlov Manor — fires when a player commits a crime.
      readonly kind: "CrimeCommitted";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly sourceCardId: EntityId;
        readonly victimSeat?: PlayerSeat;
        readonly victimCardId?: EntityId;
      };
    }
  | {
      // Theros — fires when a card becomes monstrous.
      readonly kind: "CardBecameMonstrous";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId; readonly controllerSeat: PlayerSeat };
    }
  // === Targeting (1) — Wave 5 BecomesTarget trigger ===
  | {
      // Emitted for each card-typed target after stepChooseTargets resolves.
      // `targetingSeat` is the casting/activating player. `sourceCardId` is
      // the spell/ability doing the targeting. Only card targets emit this
      // event; player targets are not cards and don't trigger BecomesTarget.
      readonly kind: "CardTargeted";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly targetId: EntityId;
        readonly sourceCardId: EntityId;
        readonly targetingSeat: PlayerSeat;
      };
    }
  // === Engine-internal (11) — SP2 §B registry/pipeline telemetry ===
  // WHY: these kinds feed the Replacement / Trigger / Static / SBA
  // pipelines (Tasks 16-34). They are not "game events" in the rules
  // sense, but the registries publish them through the same channel so
  // the log/replay/subscription stack is the single observation surface.
  | {
      readonly kind: "EventPrevented";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      // `original` is the prevented intent. Shape is the MutationIntent
      // struct owned by Tasks 16-19; kept `unknown` here so event.ts stays
      // independent of the replacement registry.
      readonly payload: { readonly original: unknown };
    }
  | {
      readonly kind: "TriggerQueued";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly triggerId: EntityId; readonly sourceCardId: EntityId };
    }
  | {
      readonly kind: "TriggerResolved";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly triggerId: EntityId };
    }
  | {
      readonly kind: "ReplacementApplied";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      // `original`/`replaced` are MutationIntents (pre/post replacement).
      // Kept `unknown` to keep the event module decoupled from the
      // replacement-registry struct shapes.
      readonly payload: {
        readonly replacementId: EntityId;
        readonly original: unknown;
        readonly replaced: unknown;
      };
    }
  | {
      readonly kind: "StateBasedActionApplied";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      // actionCount = number of SBAs applied in this sweep (may be >1
      // when multiple SBAs fire simultaneously per CR 704.3).
      readonly payload: { readonly actionCount: number };
    }
  | {
      readonly kind: "StaticAbilityRegistered";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly staticId: EntityId; readonly sourceCardId: EntityId };
    }
  | {
      readonly kind: "StaticAbilityUnregistered";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly staticId: EntityId };
    }
  | {
      readonly kind: "ContinuousEffectRegistered";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly effectId: EntityId };
    }
  | {
      readonly kind: "ContinuousEffectExpired";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly effectId: EntityId };
    }
  | {
      readonly kind: "CostPaid";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly stackItemId: EntityId; readonly payerSeat: PlayerSeat };
    }
  | {
      readonly kind: "PhaseStepEnded";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      // WHY: complements PhaseStarted / StepStarted / StepEnded with a
      // coarser "this phase's step sequence is complete" pulse. Orchestrator
      // uses it to coalesce end-of-step trigger sweeps without duplicating
      // work across every StepEnded.
      readonly payload: { readonly step: PhaseStep };
    }
  // === Wave 18 — corpus-unknown trigger events ===
  | {
      // Mentor mechanic (Ravnica Allegiance). A creature with Mentor places
      // a +1/+1 counter on a smaller-power attacker.
      readonly kind: "Mentored";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly mentorCardId: EntityId;
        readonly mentoredCardId: EntityId;
        readonly playerSeat: PlayerSeat;
      };
    }
  | {
      // Fires when a player searches their library for cards (CR 701.19).
      readonly kind: "SearchedLibrary";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat; readonly searchedSeat: PlayerSeat };
    }
  | {
      // Lorwyn-block "elemental synergy" trigger (rare, paired with
      // Earthbend/Airbend mechanics).
      readonly kind: "ElementalBend";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId; readonly playerSeat: PlayerSeat };
    }
  | {
      // Fires when a player pays cumulative upkeep (CR 702.24).
      readonly kind: "PayCumulativeUpkeep";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId; readonly playerSeat: PlayerSeat };
    }
  | {
      // Amonkhet "Exert" — fires when a creature is exerted (declared as
      // attacker without untapping next turn).
      readonly kind: "Exerted";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId; readonly playerSeat: PlayerSeat };
    }
  | {
      // "Enlist" — Streets of New Capenna mechanic. Fires when a creature is
      // enlisted to attack alongside another.
      readonly kind: "Enlisted";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId; readonly enlisterCardId: EntityId };
    }
  // === Wave 19 — final corpus-unknown trigger events ===
  | {
      // Fires once per discard set (group of cards discarded simultaneously).
      readonly kind: "DiscardedAll";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly cardIds: readonly EntityId[];
      };
    }
  | {
      // Fires when mana is added to a player's pool (post-pool variant of
      // ManaTapped — companion to ManaEnteredPool but for trigger semantics).
      readonly kind: "ManaAdded";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly amount: number;
        readonly color: Color | null;
      };
    }
  | {
      // Fires when excess damage is dealt (CR 120.4) — damage beyond the target's
      // remaining toughness or life total.
      readonly kind: "ExcessDamage";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly sourceId: EntityId;
        readonly targetKind: "creature" | "player" | "planeswalker" | "battle";
        readonly targetId: EntityId | PlayerSeat;
        readonly amount: number;
      };
    }
  | {
      // Fires when a player loses life (LifeChanged variant for delta < 0).
      readonly kind: "LifeLost";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat; readonly amount: number };
    }
  | {
      // Fires when an Archenemy scheme is abandoned (ongoing scheme rotated out).
      readonly kind: "Abandoned";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly schemeCardId: EntityId; readonly archenemySeat: PlayerSeat };
    }
  | {
      // Fires when a single source deals damage to multiple targets simultaneously.
      readonly kind: "DamageDealtAll";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly sourceId: EntityId;
        readonly targetIds: readonly EntityId[];
        readonly amount: number;
      };
    }
  | {
      // Outlaws of Thunder Junction — fires when a Mount is saddled.
      readonly kind: "Saddled";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly mountId: EntityId; readonly riderIds: readonly EntityId[] };
    }
  | {
      // Kaladesh Vehicles — fires when a Vehicle is crewed.
      readonly kind: "Crewed";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly vehicleId: EntityId; readonly crewIds: readonly EntityId[] };
    }
  | {
      // Murders at Karlov Manor — fires when a Case is solved.
      readonly kind: "CaseSolved";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId; readonly playerSeat: PlayerSeat };
    }
  | {
      // CR 702.140 — fires when a card changes controller (Mind Control,
      // Threaten, Aether Vial onto an opponent's battlefield, etc.).
      readonly kind: "CardControllerChanged";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly cardId: EntityId;
        readonly fromSeat: PlayerSeat;
        readonly toSeat: PlayerSeat;
      };
    }
  | {
      // Khans-of-Tarkir Mardu Exploit — fires when an exploit creature's
      // controller sacrifices another creature in response to its ETB.
      readonly kind: "CardExploited";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly exploiterCardId: EntityId;
        readonly sacrificedCardId: EntityId;
        readonly playerSeat: PlayerSeat;
      };
    }
  // === Wave 20 — corpus-unknown trigger events (long-tail) ===
  // WHY: each kind backs one of the 20 Wave 20 trigger handlers. As with
  // Waves 16/18/19, tests synth-emit them today; engine-side emission is
  // wired on a per-mechanic basis as the corresponding action lands.
  | {
      // March of the Machine — fires when a creature specializes (transforms
      // into one of five colored variants).
      readonly kind: "CardSpecialized";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly cardId: EntityId;
        readonly color: "W" | "U" | "B" | "R" | "G";
      };
    }
  | {
      // Fires after a proliferate sweep resolves. Distinct from CounterAdded
      // events emitted per-counter; this is the once-per-proliferation pulse.
      readonly kind: "Proliferated";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat };
    }
  | {
      // Fires when a spell on the stack is copied (Pyromancer's Goggles,
      // Twincast, etc.). Distinct from StackItemCopied: SpellCopied is the
      // canonical Forge T:Mode$ SpellCopy event matching Forge's emit.
      readonly kind: "SpellCopied";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly originalStackItemId: EntityId;
        readonly copyStackItemId: EntityId;
        readonly controllerSeat: PlayerSeat;
      };
    }
  | {
      // Mirage / Lorwyn / Modern Horizons — fires when two players clash.
      readonly kind: "CardClashed";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly winner: PlayerSeat | null;
      };
    }
  | {
      // Ixalan Explore — fires when a creature explores.
      readonly kind: "CardExplored";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly cardId: EntityId;
        readonly playerSeat: PlayerSeat;
        readonly resultPutIntoHand: boolean;
      };
    }
  | {
      // Fires once at the start of a brand-new game (after seating, before
      // first turn). Subgame variant uses a separate SubgameStarted kind.
      readonly kind: "NewGameStarted";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly seats: readonly PlayerSeat[] };
    }
  | {
      // Kaladesh Vehicle — fires when a Vehicle becomes crewed (state change
      // event distinct from the Crewed action event).
      readonly kind: "CardBecameCrewed";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly vehicleId: EntityId; readonly crewIds: readonly EntityId[] };
    }
  | {
      // Planechase — fires when a player planeswalks AWAY FROM a plane
      // (companion to PlaneswalkedTo).
      readonly kind: "PlaneswalkedFrom";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly planeCardId: EntityId; readonly playerSeat: PlayerSeat };
    }
  | {
      // Fires when a player's library is shuffled (CR 701.20).
      readonly kind: "LibraryShuffled";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat };
    }
  | {
      // Adventures into the Forgotten Realms — fires when a dungeon is
      // completed (the player passes the last room).
      readonly kind: "DungeonCompleted";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly dungeonCardId: EntityId; readonly playerSeat: PlayerSeat };
    }
  | {
      // Strixhaven Magecraft / Ravnica Conspire — fires when a player casts
      // their first non-creature spell of the turn or otherwise meets a
      // copy-spell trigger condition. Used by SpellCopy-style triggers that
      // need an explicit emit (Wave 20 — Specializes/SpellCopy share the
      // SpellCopied path).
      readonly kind: "VotePerformed";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly choice: string;
      };
    }
  | {
      // Plus / Theros — fires when a card seeks (random search) one or more
      // cards. Matches Forge T:Mode$ SeekAll.
      readonly kind: "CardSeekedAll";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat; readonly cardIds: readonly EntityId[] };
    }
  | {
      // Forge T:Mode$ MilledAll — fires once per mill batch (group of cards
      // milled simultaneously). Distinct from per-card CardMilled.
      readonly kind: "CardMilledAll";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat; readonly cardIds: readonly EntityId[] };
    }
  | {
      // Forge T:Mode$ TokenCreated alias — distinct from the existing
      // TokenCreated kind in that this is a card-source-tracking trigger
      // event (the source card that created the token, not just the
      // controller of the token). Used by Wave 20 TokenCreated handler.
      readonly kind: "CardCreatedToken";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly creatorCardId: EntityId;
        readonly tokenCardId: EntityId;
        readonly controllerSeat: PlayerSeat;
      };
    }
  | {
      // Ixalan Discover (Lost Caverns of Ixalan) — fires when a card is
      // discovered (cascade-like reveal-and-cast).
      readonly kind: "CardDiscovered";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly discoveredCardId: EntityId;
        readonly value: number;
      };
    }
  | {
      // Forge T:Mode$ LifeLostAll — fires once per life-loss batch (a single
      // event causes life loss across multiple players simultaneously).
      readonly kind: "PlayerLifeLostAll";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeats: readonly PlayerSeat[];
        readonly amounts: readonly number[];
      };
    }
  // === Wave 21 — corpus long-tail trigger events ===
  // WHY: each kind backs one of the 20 Wave 21 trigger handlers. As with
  // Waves 16/18/19/20, tests synth-emit them today; engine-side emission is
  // wired on a per-mechanic basis as the corresponding action lands.
  | {
      // Investigate (CR 701.30) — fires when a Clue token is created via the
      // Investigate keyword/effect.
      readonly kind: "CardInvestigated";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat; readonly clueTokenId: EntityId };
    }
  | {
      // Phasing (CR 702.26) — fires when a permanent phases out.
      readonly kind: "CardPhasedOut";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId };
    }
  | {
      // Murders at Karlov Manor — fires when a player collects evidence (exiles
      // cards from their graveyard with total mana value at least N).
      readonly kind: "EvidenceCollected";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly amount: number;
        readonly cardIds: readonly EntityId[];
      };
    }
  | {
      // Once-per-turn variant of CardMilled — fires once per turn for the
      // first mill batch.
      readonly kind: "CardMilledOnce";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat; readonly cardIds: readonly EntityId[] };
    }
  | {
      // Fires when an ability finishes resolving (CR 116.5 — last point at
      // which "when X resolves" triggers fire).
      readonly kind: "AbilityResolved";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly stackItemId: EntityId; readonly controllerSeat: PlayerSeat };
    }
  | {
      // Fires when a counter of a specific kind is added to any object on the
      // battlefield (Forge T:Mode$ CounterTypeAddedAll watches a single kind).
      readonly kind: "CounterTypeAddedAll";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly cardId: EntityId;
        readonly counterType: string;
        readonly amount: number;
      };
    }
  | {
      // Lorwyn Renown — fires when a creature becomes Renowned.
      readonly kind: "CardBecameRenowned";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId };
    }
  | {
      // Magic Origins / Innistrad transform — fires when a creature evolves
      // (CR 702.100). Distinct from CardSpecialized.
      readonly kind: "CardEvolved";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId };
    }
  | {
      // Strixhaven / Wilds of Eldraine — fires when one or more cards are
      // conjured (created out of nowhere, not tokens).
      readonly kind: "CardConjuredAll";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat; readonly cardIds: readonly EntityId[] };
    }
  | {
      // Bloomburrow Forage — fires when a player forages (exiles 3 cards from
      // their graveyard or sacrifices a Food).
      readonly kind: "CardForage";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat };
    }
  | {
      // Once-per-turn variant of AttackerUnblocked.
      readonly kind: "AttackerUnblockedOnce";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly attackerId: EntityId };
    }
  | {
      // Forge T:Mode$ TapAll — fires once per "tap all" batch (e.g. Wrath
      // variants that tap rather than destroy).
      readonly kind: "CardsTappedAll";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardIds: readonly EntityId[] };
    }
  | {
      // Foretell (CR 702.146) — fires when a card is foretold (exiled face-down
      // for the foretell cost). Distinct from the existing CardForetold which
      // fires on the cast-from-foretell-zone path; this one fires on the
      // exile-on-foretell path.
      readonly kind: "CardForetoldExiled";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId; readonly playerSeat: PlayerSeat };
    }
  | {
      // Fight (CR 701.13) — fires when two creatures fight.
      readonly kind: "FightFought";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly aId: EntityId; readonly bId: EntityId };
    }
  | {
      // Fires when a player pays life as part of a cost or effect.
      readonly kind: "LifePaid";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat; readonly amount: number };
    }
  | {
      // Fires when a spell or ability copy is created (Forge T:Mode$
      // SpellAbilityCopy — superset of SpellCopied that also fires on
      // ability-on-stack copies).
      readonly kind: "SpellAbilityCopied";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly originalStackItemId: EntityId;
        readonly copyStackItemId: EntityId;
      };
    }
  | {
      // Wilds of Eldraine — fires when a "gift" is promised (player chooses to
      // gift an opponent something on cast).
      readonly kind: "GiftPromised";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly fromSeat: PlayerSeat; readonly toSeat: PlayerSeat };
    }
  | {
      // Devour (CR 702.81) — fires when a creature with Devour eats other
      // creatures as it enters.
      readonly kind: "CreatureDevoured";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly devourerId: EntityId; readonly devouredIds: readonly EntityId[] };
    }
  // === Wave 22 — final corpus long-tail trigger events ===
  // WHY: each kind backs one of the 14 Wave 22 trigger handlers. As with
  // Waves 16/18/19/20/21, tests synth-emit them today; engine-side emission is
  // wired on a per-mechanic basis as the corresponding action lands.
  | {
      // Lorwyn-block "Champion" — fires when a creature is championed (exiled
      // by the Champion ability of another creature).
      readonly kind: "CardChampioned";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly championerId: EntityId; readonly championedId: EntityId };
    }
  | {
      // Aetherdrift — fires when a creature is stationed onto a Vehicle/Spacecraft.
      readonly kind: "CardStationed";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly vehicleId: EntityId; readonly stationerIds: readonly EntityId[] };
    }
  | {
      // Unfinity — fires when a player visits an Attraction (it untaps in their
      // mainphase and is "open").
      readonly kind: "AttractionVisited";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly attractionId: EntityId; readonly playerSeat: PlayerSeat };
    }
  | {
      // Bloomburrow — fires when a creature trains (powers up by attacking
      // alongside another creature with greater power).
      readonly kind: "CardTrained";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardId: EntityId };
    }
  | {
      // Forge T:Mode$ UntapAll — fires once per "untap all" batch (Forge's
      // group untap event, e.g. some untap-step custom replacements).
      readonly kind: "CardsUntappedAll";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly cardIds: readonly EntityId[] };
    }
  | {
      // Unfinity — fires when a player claims a prize (from an Attraction
      // visit or carnival mechanic).
      readonly kind: "PrizeClaimed";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly playerSeat: PlayerSeat };
    }
  // === Wave 34 — Battle card type ===
  | {
      // CR 704.5s / 310.x — fires when a Battle is defeated (its Defense
      // counters reach 0 and SBA exiles it). Distinct from CardExiled in
      // that this is the canonical "Battle defeated" pulse triggers
      // observe (Forge T:Mode$ ChangesZone | Origin$ Battlefield |
      // Destination$ Exile | ValidCard$ Card.Battle plus the cast-
      // transformed back-face hookup).
      readonly kind: "BattleDefeated";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly cardId: EntityId;
        readonly defeatedBySeat?: PlayerSeat;
      };
    }
  // === Wave 45 — Final long-tail (Initiative dungeon + Contraption deck) ===
  | {
      // Initiative dungeon (Undercity) advance pulse — fires on each upkeep
      // dungeon advance + on every fresh take-initiative. `room` is the
      // 1..9 room index after the advance (1 = Secret Entrance, 9 = Throne
      // of the Dead Three). Per-room printed effects fire after this
      // pulse via `applyUndercityRoomEffect` (Wave 70.B); this remains
      // the canonical observation point for triggers + UI.
      readonly kind: "UndercityRoomEntered";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly room: number;
        readonly roomName: string;
      };
    }
  | {
      // AssembleContraption resolution pulse. Fires once per contraption
      // assembled by the SP$ AssembleContraption effect. `cardId` is the
      // contraption-deck card placed onto the battlefield when a real
      // contraption deck is wired (TODO(advanced)) or undefined when the
      // MVP placeholder path is taken.
      readonly kind: "ContraptionAssembled";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly playerSeat: PlayerSeat;
        readonly sourceCardId: EntityId;
        readonly cardId?: EntityId;
      };
    }
  // === Wave 70.A — Trigger-mode coverage additions ===
  | {
      // CR 716 — Class enchantment level transition. Fires when a Class
      // card's level increases (either via the level-up activated ability
      // or via the SBA "Class without a Level counter gains level 1"
      // bump). Trigger handlers gate on `newLevel` to match Forge's
      // NewLevel$ N filter.
      readonly kind: "ClassLevelGained";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly cardId: EntityId;
        readonly oldLevel: number;
        readonly newLevel: number;
        readonly controllerSeat: PlayerSeat;
      };
    }
  | {
      // Duskmourn: House of Horror — Room enters fully unlocked (both
      // halves' costs paid). MVP: stub — no engine emission yet (Rooms
      // aren't fully wired). The trigger-mode handler exists so card
      // text parses cleanly. TODO(advanced) — emit when the Room
      // unlock pipeline lands.
      readonly kind: "RoomEntered";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly cardId: EntityId;
        readonly playerSeat: PlayerSeat;
        readonly fullyUnlocked: boolean;
      };
    }
  | {
      // CR 702.130 — Adapt resolution pulse. Fires when an Adapt
      // activated ability resolves AND adds +1/+1 counters (i.e. the
      // CR 702.139a precondition "this creature has no +1/+1 counters
      // on it" was satisfied at resolution time). Distinct from the
      // generic CounterAdded event so triggers can fire ONLY on the
      // Adapt mechanic, not on every counter addition.
      readonly kind: "CardAdapted";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly cardId: EntityId;
        readonly amount: number;
      };
    }
  // === Wave 114 — final effect TODO closures (3) ===
  // GameRestartRequested — fired when SP$ RestartGame resolves. Distinct
  // from the SubgameStarted pulse the MVP rode pre-Wave-114; observers
  // (game-session bootstrap, replay log) consume this kind to actually
  // tear down + re-seed the game state.
  | {
      readonly kind: "GameRestartRequested";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly requestingSeat: PlayerSeat };
    }
  // PlayerControlled — fired when SP$ ControlPlayer (Mindslaver-style)
  // claims control of the target player's next turn. The flag was
  // already stamped pre-Wave-114; the event closes the observable
  // surface.
  | {
      readonly kind: "PlayerControlled";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: {
        readonly controlledSeat: PlayerSeat;
        readonly controllerSeat: PlayerSeat;
      };
    }
  // PlayerControlReleased — fired when the controlled player's turn
  // ends and the flag clears (or when the source leaves play, etc.).
  | {
      readonly kind: "PlayerControlReleased";
      readonly version: 1;
      readonly turn: number;
      readonly phase: PhaseStep;
      readonly payload: { readonly controlledSeat: PlayerSeat };
    };

/** The set of all event kinds. Derived from the union discriminator. */
export type GameEventKind = GameEvent["kind"];

/**
 * Construct a GameEvent with the current schema `version: 1` and a payload
 * narrowed to the variant selected by `kind`. Wrong-shape payloads fail at
 * compile time.
 */
export const mkEvent = <K extends GameEventKind>(
  kind: K,
  turn: number,
  phase: PhaseStep,
  payload: Extract<GameEvent, { kind: K }>["payload"],
): Extract<GameEvent, { kind: K }> =>
  ({ kind, version: 1, turn, phase, payload }) as Extract<GameEvent, { kind: K }>;

/**
 * Type guard that narrows a GameEvent to a specific variant. Useful when a
 * consumer only cares about one kind and doesn't want to write a switch.
 */
export const isEvent = <K extends GameEventKind>(
  event: GameEvent,
  kind: K,
): event is Extract<GameEvent, { kind: K }> => event.kind === kind;
