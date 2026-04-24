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
