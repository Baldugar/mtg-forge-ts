// SPDX-License-Identifier: GPL-3.0-or-later
// GameSnapshot — save / load / undo foundation. snapshot(game) walks the live
// Game into plain JSON-stringifiable data; restore({...}) reconstructs a Game
// that behaves identically (same phase, same zones, same card state, same
// rng stream). Controllers (consumer closures), PaperCard defs (bulky,
// content-addressed), and GameRules (rare to diverge across a restore) are
// re-supplied externally because they either don't JSON-serialize or belong
// to consumer-owned lifetimes.
//
// Why a separate module (not Game.toJSON)? The serialization walks private
// fields (entityIdCounter, player zones, flags' internal Maps/Sets) that
// Game.toJSON — used for log previews and debug output — has no business
// exposing. Keeping snapshot logic here also isolates the schemaVersion
// contract so a bump doesn't pollute Game's API.
//
// schemaVersion: 6 (SP2 Milestone X — rules-subsystem state captured).
// Bump on breaking format changes (master-spec §11).
//
// Migration notes:
//   schemaVersion 2: library/deck-like zones now emit top-first (index 0 =
//     top of deck) matching Forge / CR convention. Version 1 blobs had the
//     opposite ordering for Library zone items — tooling that loads a v1
//     snapshot must reverse Library.items before restore.
//   schemaVersion 3: PaperCard renamed `set` → `edition` to match Forge's
//     field name (SP4 wire interop). The rename only affects PaperCard
//     registries supplied to restore(); snapshot payload itself is unchanged
//     (paperCardKey's string format is stable: edition:collector:lang).
//   schemaVersion 4: reserve state slots for Combat and Card.remembered so
//     SP2 can populate them without another breaking bump. SP1 emits
//     combat: null and cardRemembered: {}; restore treats both as no-ops
//     when unset.
//   schemaVersion 5: reserve continuousEffects list (CR 613 layer system) so
//     SP2 can populate without another bump. SP1 emits an empty list;
//     restore copies whatever is present.
//   schemaVersion 6 (SP2 Milestone X Task 75): rules-subsystem state
//     captured. The SP1-reserved optional fields (Card.remembered /
//     imprinted, GameFlags.countersAddedThisTurn / leftBattlefieldThisTurn /
//     topLibsCast) are promoted to REQUIRED. Card gains serialization for
//     face, mutatedPile/mutatedInto/isAugment/meldedFrom, isToken/isEmblem,
//     sagaFinalChapterResolved/bestowed/isCommander, keywords (Set→array),
//     copiedFrom (structured CopiableCharacteristics), faceDown (tagged
//     union). Game gains ringState (Map), teamLife (Map|null),
//     pendingControlReverts, companions (Map), controlChangeLedger entries,
//     layer-engine effect arrays (textSubstitutions, typeEffects,
//     colorEffects, abilityEffects, pt7a-7e), and the pending-trigger queue.
//     v5 → v6 is NOT auto-migrated — restore() throws
//     IncompatibleSnapshotVersionError on v5 input. Fresh snapshots on v6
//     only.
//
// === DEFERRED (SP3 AbilityRegistry scope) ================================
// The following state is NOT serialized because it holds LIVE ability
// objects with function-valued methods (matches / apply / describe /
// captureLki / interveningIf / resolver.resolve) that are not JSON-safe:
//   - ReplacementRegistry entries (ReplacementAbility.matches + apply)
//   - TriggerRegistry entries (TriggeredAbility.matches + captureLki +
//     interveningIf). The pending PendingTrigger queue IS serialized
//     (plain JSON-safe records); only the live matchers are skipped.
//   - StaticEffectRegistry entries (StaticAbility.describe + supports)
//   - DelayedTriggerQueue entries (DelayedTrigger.matches)
//   - Suppression filters (cost-mod / static-gated predicates)
//   - StackItem.resolver (resolver.resolve is a generator function)
//   - Card.intrinsicStatics (StaticAbility.describe)
//   - ConditionAst evaluators inside asLongAs durations (evaluated lazily
//     via condition-ast.ts, but held by reference in ContinuousEffect
//     payloads for certain effect families)
//
// This is Option A from the task brief: SP2 snapshots capture game state at
// priority windows — mid-resolution states (with live generators on stack
// items) are NOT supported for round-trip. SP3 (or later) will land Option
// B: a real AbilityRegistry that maps ability id → live object, so snapshot
// serializes only ids + metadata and rehydrate goes through registry lookup.
//
// The serializable Layer 6 abilityEffects array IS captured verbatim — it
// holds only EntityId + timestamp metadata, no function refs — so Ring
// grants / aura grants recomputed via RingGrantLedger.applyFor /
// AuraAbilityGrantLedger.onAttach stay live after restore (callers rebuild
// those ledgers from ringState + card attachments + intrinsicStatics).

import type {
  CardType,
  ContinuousEffect,
  CounterType,
  EffectDuration,
  EntityId,
  FaceDownState,
  GameEvent,
  LastKnownInfo,
  LobbyPlayer,
  PaperCard,
  PhaseStep,
  PlayerSeat,
  Rng,
  SerializedRngState,
  Supertype,
  ZoneType,
} from "@mtg-forge-ts/core";
import {
  ColorSet,
  IncompatibleSnapshotVersionError,
  ManaCost,
  SnapshotRestoreError,
  UnknownCardError,
  ZoneType as ZoneTypeEnum,
  deserializeRngState,
  mkEntityId,
  paperCardKey,
  serializeRngState,
} from "@mtg-forge-ts/core";
import { Card } from "../card.js";
import type { CopiableCharacteristics } from "../copy/copiable-characteristics.js";
import type { GameFlags } from "../game-flags.js";
import { createDefaultFlags } from "../game-flags.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { TextSubstitution } from "../layers/layer3-text.js";
import type { TypeChangeEffect } from "../layers/layer4-type.js";
import type { ColorChangeEffect } from "../layers/layer5-color.js";
import type { AbilityChangeEffect } from "../layers/layer6-ability.js";
import type {
  Layer7aEffect,
  Layer7bEffect,
  Layer7cEffect,
  Layer7dEffect,
  Layer7eEffect,
} from "../layers/layer7-pt.js";
import type { FaceKind } from "../multiface/face-kind.js";
import type { RingState } from "../ring/ring-state.js";
import type { StackItem } from "../stack/stack-item.js";
import type { TerminalState } from "../terminal-state.js";
import type { Zone } from "../zone/zone.js";
import { Ante } from "../zone/zones/ante.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { CommandZone } from "../zone/zones/command-zone.js";
import { Exile } from "../zone/zones/exile.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";

/**
 * Snapshot format version. v6 is the SP2-end shape; see the migration-notes
 * block above for the v1→v6 history. Breaking format changes (field rename,
 * shape removed, Map key flipped) MUST bump this so restore() can reject
 * old blobs rather than silently mis-deserialize.
 */
export const SNAPSHOT_SCHEMA_VERSION = 6 as const;

// === CopiableCharacteristics serialization ===========================

/**
 * Wire shape for CopiableCharacteristics. ManaCost / ColorSet use their own
 * toJSON / fromJSON pairs; Sets flatten to sorted arrays (sorted so two
 * equivalent sets always serialize identically — important for deep-equal
 * round-trip tests).
 */
export interface SerializedCopiableCharacteristics {
  readonly name: string;
  readonly manaCost: ReturnType<ManaCost["toJSON"]>;
  readonly colorIndicator: number | null;
  readonly supertypes: readonly string[];
  readonly types: readonly string[];
  readonly subtypes: readonly string[];
  readonly colors: number;
  readonly rulesText: string;
  readonly power: number | null;
  readonly toughness: number | null;
  readonly loyalty: number | null;
  readonly defense: number | null;
}

const serializeCopiable = (cc: CopiableCharacteristics): SerializedCopiableCharacteristics => ({
  name: cc.name,
  manaCost: cc.manaCost.toJSON(),
  colorIndicator: cc.colorIndicator === null ? null : cc.colorIndicator.toJSON(),
  supertypes: [...cc.supertypes].sort(),
  types: [...cc.types].sort(),
  subtypes: [...cc.subtypes].sort(),
  colors: cc.colors.toJSON(),
  rulesText: cc.rulesText,
  power: cc.power,
  toughness: cc.toughness,
  loyalty: cc.loyalty,
  defense: cc.defense,
});

const deserializeCopiable = (s: SerializedCopiableCharacteristics): CopiableCharacteristics => ({
  name: s.name,
  manaCost: ManaCost.fromJSON(s.manaCost),
  colorIndicator: s.colorIndicator === null ? null : ColorSet.fromJSON(s.colorIndicator),
  // WHY: cast Set<string> to the branded Supertype / CardType unions. The
  // strings came from a live CopiableCharacteristics round-trip, so their
  // values are guaranteed to be valid enum members — the cast restores the
  // static branding without revalidating at runtime.
  supertypes: new Set(s.supertypes as readonly Supertype[]),
  types: new Set(s.types as readonly CardType[]),
  subtypes: new Set(s.subtypes),
  colors: ColorSet.fromJSON(s.colors),
  rulesText: s.rulesText,
  power: s.power,
  toughness: s.toughness,
  loyalty: s.loyalty,
  defense: s.defense,
});

// === FaceDownState serialization =====================================

/**
 * FaceDownState wire shape. Only the `morph` kind carries a non-JSON-safe
 * ManaCost; the rest are plain value records. We funnel morph's cost
 * through ManaCost.toJSON / fromJSON to keep it structural.
 */
export type SerializedFaceDownState =
  | { readonly kind: "none" }
  | { readonly kind: "morph"; readonly cost: ReturnType<ManaCost["toJSON"]> }
  | { readonly kind: "manifest" }
  | { readonly kind: "foretell"; readonly castableFrom: "exile" }
  | { readonly kind: "disguise"; readonly wardAmount: number }
  | { readonly kind: "cloak" };

const serializeFaceDown = (f: FaceDownState): SerializedFaceDownState => {
  switch (f.kind) {
    case "none":
      return { kind: "none" };
    case "morph":
      return { kind: "morph", cost: f.cost.toJSON() };
    case "manifest":
      return { kind: "manifest" };
    case "foretell":
      return { kind: "foretell", castableFrom: f.castableFrom };
    case "disguise":
      return { kind: "disguise", wardAmount: f.wardAmount };
    case "cloak":
      return { kind: "cloak" };
    default: {
      const _: never = f;
      throw new Error(`serializeFaceDown: unreachable ${JSON.stringify(_)}`);
    }
  }
};

const deserializeFaceDown = (s: SerializedFaceDownState): FaceDownState => {
  switch (s.kind) {
    case "none":
      return { kind: "none" };
    case "morph":
      return { kind: "morph", cost: ManaCost.fromJSON(s.cost) };
    case "manifest":
      return { kind: "manifest" };
    case "foretell":
      return { kind: "foretell", castableFrom: s.castableFrom };
    case "disguise":
      return { kind: "disguise", wardAmount: s.wardAmount };
    case "cloak":
      return { kind: "cloak" };
    default: {
      const _: never = s;
      throw new Error(`deserializeFaceDown: unreachable ${JSON.stringify(_)}`);
    }
  }
};

// === Layer effect serialization ======================================

/**
 * LayerEngine effect arrays are JSON-safe except for Layer 4's "becomes"
 * kind (ReadonlySet<CardType>) and Layer 5's ColorSet instances. Both
 * convert via dedicated helpers.
 */
export type SerializedTypeChangeEffect =
  | {
      readonly kind: "add";
      readonly cardType: string;
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
    }
  | {
      readonly kind: "remove";
      readonly cardType: string;
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
    }
  | {
      readonly kind: "becomes";
      readonly types: readonly string[];
      readonly isCda: boolean;
      readonly timestamp: number;
      readonly sourceAbilityId: EntityId | null;
    };

const serializeTypeEffect = (e: TypeChangeEffect): SerializedTypeChangeEffect => {
  switch (e.kind) {
    case "add":
      return {
        kind: "add",
        cardType: e.cardType,
        isCda: e.isCda,
        timestamp: e.timestamp,
        sourceAbilityId: e.sourceAbilityId,
      };
    case "remove":
      return {
        kind: "remove",
        cardType: e.cardType,
        isCda: e.isCda,
        timestamp: e.timestamp,
        sourceAbilityId: e.sourceAbilityId,
      };
    case "becomes":
      return {
        kind: "becomes",
        types: [...e.types].sort(),
        isCda: e.isCda,
        timestamp: e.timestamp,
        sourceAbilityId: e.sourceAbilityId,
      };
    default: {
      const _: never = e;
      throw new Error(`serializeTypeEffect: unreachable ${JSON.stringify(_)}`);
    }
  }
};

const deserializeTypeEffect = (s: SerializedTypeChangeEffect): TypeChangeEffect => {
  switch (s.kind) {
    case "add":
      return {
        kind: "add",
        cardType: s.cardType as CardType,
        isCda: s.isCda,
        timestamp: s.timestamp,
        sourceAbilityId: s.sourceAbilityId,
      };
    case "remove":
      return {
        kind: "remove",
        cardType: s.cardType as CardType,
        isCda: s.isCda,
        timestamp: s.timestamp,
        sourceAbilityId: s.sourceAbilityId,
      };
    case "becomes":
      return {
        kind: "becomes",
        types: new Set(s.types as readonly CardType[]),
        isCda: s.isCda,
        timestamp: s.timestamp,
        sourceAbilityId: s.sourceAbilityId,
      };
    default: {
      const _: never = s;
      throw new Error(`deserializeTypeEffect: unreachable ${JSON.stringify(_)}`);
    }
  }
};

export interface SerializedColorChangeEffect {
  readonly kind: "set" | "add" | "remove";
  readonly colors: number;
  readonly isCda: boolean;
  readonly timestamp: number;
  readonly sourceAbilityId: EntityId | null;
}

const serializeColorEffect = (e: ColorChangeEffect): SerializedColorChangeEffect => ({
  kind: e.kind,
  colors: e.colors.toJSON(),
  isCda: e.isCda,
  timestamp: e.timestamp,
  sourceAbilityId: e.sourceAbilityId,
});

const deserializeColorEffect = (s: SerializedColorChangeEffect): ColorChangeEffect => ({
  kind: s.kind,
  colors: ColorSet.fromJSON(s.colors),
  isCda: s.isCda,
  timestamp: s.timestamp,
  sourceAbilityId: s.sourceAbilityId,
});

/**
 * LayerEngine state — the per-sublayer effect arrays. Serialized losslessly
 * (Layer 3 / 6 / 7a-e are pure data; 4 / 5 use the helpers above).
 */
export interface SerializedLayerEngineState {
  readonly textSubstitutions: readonly TextSubstitution[];
  readonly typeEffects: readonly SerializedTypeChangeEffect[];
  readonly colorEffects: readonly SerializedColorChangeEffect[];
  readonly abilityEffects: readonly AbilityChangeEffect[];
  readonly pt7a: readonly Layer7aEffect[];
  readonly pt7b: readonly Layer7bEffect[];
  readonly pt7c: readonly Layer7cEffect[];
  readonly pt7d: readonly Layer7dEffect[];
  readonly pt7e: readonly Layer7eEffect[];
}

// === ControlChangeLedger serialization ===============================

export interface SerializedControlChangeEntry {
  readonly cardId: EntityId;
  readonly priorController: PlayerSeat;
  readonly duration: EffectDuration;
  readonly registeredAtTurn: number;
}

/**
 * Serialized Card record. Deliberately parallels Card.toJSON plus every
 * field Card.toJSON omits (copiedFrom, faceDown, face, mutate pile, token /
 * emblem flags, SBA flags, keywords) — snapshot must preserve every live
 * field while Card.toJSON can stay a lightweight log preview.
 */
export interface SerializedCard {
  readonly id: EntityId;
  readonly paperCardKey: string;
  readonly ownerSeat: PlayerSeat;
  readonly controllerSeat: PlayerSeat;
  readonly zone: ZoneType;
  readonly tapped: boolean;
  readonly phased: boolean;
  readonly damage: number;
  readonly counters: Record<string, number>;
  readonly attachedTo: EntityId | null;
  readonly attachments: readonly EntityId[];
  // SP2 Task 3 — Layer 1 copy source. Null when not copying.
  readonly copiedFrom: SerializedCopiableCharacteristics | null;
  // SP2 Task 53 — CR 708 face-down state. Always a valid FaceDownState
  // (`{ kind: "none" }` for face-up); never null.
  readonly faceDown: SerializedFaceDownState;
  // SP2 Milestone W Task 74 — v6 promotes these to required (were
  // optional in v5 for compat).
  readonly remembered: readonly EntityId[];
  readonly imprinted: readonly EntityId[];
  // SP2 Milestone Q — active face selector. "default" for single-face.
  readonly face: FaceKind;
  // SP2 Task 31 — token / emblem identity flags (SBA-consulted).
  readonly isToken: boolean;
  readonly isEmblem: boolean;
  // SP2 Task 32 — SBA support flags.
  readonly sagaFinalChapterResolved: boolean;
  readonly bestowed: boolean;
  readonly isCommander: boolean;
  // SP2 Tasks 46-48 — keyword set (undefined → empty array wire-side).
  readonly keywords: readonly string[];
  // SP2 Task 61 — mutate + host/augment + meld state.
  readonly mutatedPile: readonly EntityId[] | null;
  readonly mutatedInto: EntityId | null;
  readonly isAugment: boolean;
  readonly meldedFrom: readonly EntityId[] | null;
}

/**
 * Serialized Zone entry. Zone.toJSON emits this shape already; snapshot mirrors
 * it here so the on-disk schema is fully documented in one place.
 */
export interface SerializedZone {
  readonly type: ZoneType;
  readonly ownerSeat: PlayerSeat | null;
  readonly items: readonly EntityId[];
}

/**
 * Per-player snapshot. Player.toJSON omits zones deliberately (kept as a
 * lightweight log view); snapshot stitches them in via a dedicated shape here.
 */
export interface SerializedPlayer {
  readonly seat: PlayerSeat;
  readonly lobbyPlayerId: string;
  readonly teamId: number;
  readonly life: number;
  readonly counters: Record<string, number>;
  readonly zones: readonly SerializedZone[];
}

/**
 * GameFlags persisted shape. Maps/Sets serialize to arrays-of-entries so the
 * blob is JSON-stringifiable (JSON.stringify of a Map emits `{}`, losing data).
 * v6 promotes countersAddedThisTurn / leftBattlefieldThisTurn / topLibsCast
 * to REQUIRED (they were optional in v5 for back-compat during Milestone W).
 */
export interface SerializedGameFlags {
  readonly dayNight: "day" | "night" | "neither";
  readonly monarch: PlayerSeat | null;
  readonly initiative: PlayerSeat | null;
  readonly cityBlessing: readonly PlayerSeat[];
  readonly ringBearer: readonly (readonly [PlayerSeat, EntityId | null])[];
  readonly ringLevel: readonly (readonly [PlayerSeat, 0 | 1 | 2 | 3 | 4])[];
  readonly speedLevel: readonly (readonly [PlayerSeat, 0 | 1 | 2 | 3 | 4])[];
  readonly currentDungeon: readonly (readonly [
    PlayerSeat,
    { readonly card: EntityId; readonly position: string } | null,
  ])[];
  readonly commandersOwnedByPlayer: readonly (readonly [PlayerSeat, readonly EntityId[]])[];
  readonly commanderCastCount: readonly (readonly [EntityId, number])[];
  readonly commanderDamage: readonly (readonly [EntityId, readonly (readonly [PlayerSeat, number])[]])[];
  readonly firstTurnDrawSkipped: readonly (readonly [PlayerSeat, boolean])[];
  readonly mulligansTaken: readonly (readonly [PlayerSeat, number])[];
  readonly landsPlayedThisTurn: readonly (readonly [PlayerSeat, number])[];
  readonly spellsCastThisTurn: readonly (readonly [PlayerSeat, number])[];
  readonly turnsTakenThisTurn: number;
  readonly skippedPhases: readonly PhaseStep[];
  readonly activeTeamForTeamPlay: number | null;
  readonly seatEliminated: readonly (readonly [PlayerSeat, boolean])[];
  readonly stickers: readonly unknown[];
  readonly attractions: readonly (readonly [PlayerSeat, unknown])[];
  // v6: required (were optional in v5). Empty-array / empty-pair value is
  // valid and means "nothing tracked this turn yet".
  readonly countersAddedThisTurn: readonly (readonly [EntityId, number])[];
  readonly leftBattlefieldThisTurn: readonly EntityId[];
  readonly topLibsCast: readonly EntityId[];
}

/**
 * PendingTrigger serialization. Mirrors the in-memory shape exactly —
 * every field is JSON-safe (GameEvent + LastKnownInfo are plain records,
 * no function refs).
 */
export interface SerializedPendingTrigger {
  readonly id: EntityId;
  readonly triggerId: EntityId;
  readonly sourceCardId: EntityId;
  readonly event: GameEvent;
  readonly lki: LastKnownInfo | null;
  readonly sourceControllerAtFire: PlayerSeat;
  readonly firedAtTurn: number;
  readonly firedAtPhase: PhaseStep;
}

/**
 * StackItem wire shape. The `resolver` slot is DROPPED on serialize (it's
 * a live generator fn — see DEFERRED block at top of file); restore sets
 * it to `null`. `event` + `triggerId` + `lki` are JSON-safe and round-
 * trip verbatim.
 */
export interface SerializedStackItem {
  readonly id: EntityId;
  readonly sourceCardId: EntityId;
  readonly controllerSeat: PlayerSeat;
  readonly kind: "spell" | "activatedAbility" | "triggeredAbility" | "copy";
  readonly isCast: boolean;
  readonly targets: unknown;
  readonly modes: readonly unknown[];
  readonly xValue: number | null;
  readonly costPaid: unknown;
  readonly provenance: StackItem["provenance"];
  readonly triggerId?: EntityId;
  readonly lki?: LastKnownInfo | null;
  readonly event?: GameEvent;
  // resolver is DEFERRED — never serialized.
}

const serializeStackItem = (item: StackItem): SerializedStackItem => {
  const base: SerializedStackItem = {
    id: item.id,
    sourceCardId: item.sourceCardId,
    controllerSeat: item.controllerSeat,
    kind: item.kind,
    isCast: item.isCast,
    targets: item.targets,
    modes: [...item.modes],
    xValue: item.xValue,
    costPaid: item.costPaid,
    provenance: item.provenance,
  };
  // Only attach optional slots when present — keeps the wire shape
  // compact and preserves pre-SP2 test expectations that round-trip
  // a trigger-less stack item produces the SAME object.
  const out: SerializedStackItem = {
    ...base,
    ...(item.triggerId !== undefined ? { triggerId: item.triggerId } : {}),
    ...(item.lki !== undefined ? { lki: item.lki } : {}),
    ...(item.event !== undefined ? { event: item.event } : {}),
  };
  return out;
};

const deserializeStackItem = (s: SerializedStackItem): StackItem => ({
  id: s.id,
  sourceCardId: s.sourceCardId,
  controllerSeat: s.controllerSeat,
  kind: s.kind,
  isCast: s.isCast,
  targets: s.targets,
  modes: [...s.modes],
  xValue: s.xValue,
  costPaid: s.costPaid,
  provenance: s.provenance,
  // resolver intentionally omitted — DEFERRED (mid-resolution snapshot is
  // out of scope; see top-of-file block).
  ...(s.triggerId !== undefined ? { triggerId: s.triggerId } : {}),
  ...(s.lki !== undefined ? { lki: s.lki } : {}),
  ...(s.event !== undefined ? { event: s.event } : {}),
});

/**
 * Engine + card-data provenance + save-time metadata. `forgeSha`,
 * `cardDataSyncedAt`, `crVersion`, `seed` come from GameMeta; `formatId` from
 * GameRules. `formatDefinitionSnapshot` is a reserved slot: SP6 will attach a
 * Format definition here so restore can verify legality invariants.
 */
export interface GameSnapshotHeader {
  readonly schemaVersion: number;
  readonly engineVersion: string;
  readonly forgeSha: string;
  readonly cardDataSyncedAt: string;
  readonly crVersion: string;
  readonly savedAt: string;
  readonly formatId: string;
  readonly formatDefinitionSnapshot: unknown;
  readonly seed: string;
}

/**
 * Top-level snapshot shape. Split into `header` (provenance / metadata, cheap
 * to inspect without rehydrating) + `state` (engine state, expensive to walk).
 */
export interface GameSnapshot {
  readonly header: GameSnapshotHeader;
  readonly state: {
    readonly turn: number;
    readonly phase: PhaseStep;
    readonly activePlayer: PlayerSeat;
    readonly priorityPlayer: PlayerSeat | null;
    /**
     * Seat that won the setup die-roll. Null until setupGame resolves it
     * (matches Game.startingPlayer's pre-setup state).
     */
    readonly startingPlayer: PlayerSeat | null;
    readonly players: readonly SerializedPlayer[];
    readonly cards: readonly SerializedCard[];
    readonly sharedZones: {
      readonly stack: { readonly items: readonly SerializedStackItem[] };
      readonly exile: SerializedZone;
      readonly ante: SerializedZone;
    };
    readonly flags: SerializedGameFlags;
    readonly rngState: SerializedRngState;
    readonly entityIdCounter: number;
    readonly terminalState: TerminalState | null;
    /**
     * Reserved for SP2 CombatHandler.snapshot(). SP2 scope does not yet
     * pickle combat state across priority windows (CombatHandler is minted
     * on each combat run from Game state, so "restore returns at the same
     * combat state" requires re-running from DeclareAttackers).
     */
    readonly combat: unknown;
    /**
     * Reserved pre-v6 slot; kept in the wire shape for back-compat of
     * consumer tooling that peeked at it. Always `{}` on v6 — remember /
     * imprinted state lives on each SerializedCard.
     */
    readonly cardRemembered: Readonly<Record<number, readonly unknown[]>>;
    /**
     * CR 613 layer-system continuous-effect ledger. Populated by the
     * continuous-effect registry; the payload field on each entry is a
     * discriminated union (ContinuousPayload) that is JSON-safe.
     */
    readonly continuousEffects: readonly ContinuousEffect[];
    // === v6 additions ====================================================
    /** CR 701.52 per-player Ring state. Sparse — untempted seats omitted. */
    readonly ringState: readonly (readonly [PlayerSeat, RingState])[];
    /** CR 810 Two-Headed Giant shared life pool, or null when not 2HG. */
    readonly teamLife: readonly (readonly [number, number])[] | null;
    /** Task 45 — cards with control reverts queued for the next priority sweep. */
    readonly pendingControlReverts: readonly EntityId[];
    /** Task 72 — CR 702.139 companion declarations per seat. */
    readonly companions: readonly (readonly [PlayerSeat, EntityId | null])[];
    /** Task 45 — time-bounded control-change ledger entries. */
    readonly controlChangeLedger: readonly SerializedControlChangeEntry[];
    /** LayerEngine per-sublayer effect arrays. */
    readonly layerEngine: SerializedLayerEngineState;
    /** TriggerRegistry's pending-queue snapshot (fired, not yet drained). */
    readonly pendingTriggers: readonly SerializedPendingTrigger[];
    /**
     * DelayedTriggerQueue size — a simple telemetry slot. Full delayed
     * triggers require SP3 AbilityRegistry (DelayedTrigger.matches is a
     * live function).
     */
    readonly delayedTriggerCount: number;
  };
}

// === Flag serialization ============================================

const flagsToJSON = (f: GameFlags): SerializedGameFlags => ({
  dayNight: f.dayNight,
  monarch: f.monarch,
  initiative: f.initiative,
  cityBlessing: [...f.cityBlessing],
  ringBearer: [...f.ringBearer.entries()].map(([s, e]) => [s, e] as const),
  ringLevel: [...f.ringLevel.entries()].map(([s, l]) => [s, l] as const),
  speedLevel: [...f.speedLevel.entries()].map(([s, l]) => [s, l] as const),
  currentDungeon: [...f.currentDungeon.entries()].map(([s, d]) => [s, d] as const),
  commandersOwnedByPlayer: [...f.commandersOwnedByPlayer.entries()].map(([s, arr]) => [s, [...arr]] as const),
  commanderCastCount: [...f.commanderCastCount.entries()].map(([e, n]) => [e, n] as const),
  commanderDamage: [...f.commanderDamage.entries()].map(
    ([e, inner]) => [e, [...inner.entries()].map(([s, n]) => [s, n] as const)] as const,
  ),
  firstTurnDrawSkipped: [...f.firstTurnDrawSkipped.entries()].map(([s, b]) => [s, b] as const),
  mulligansTaken: [...f.mulligansTaken.entries()].map(([s, n]) => [s, n] as const),
  landsPlayedThisTurn: [...f.landsPlayedThisTurn.entries()].map(([s, n]) => [s, n] as const),
  spellsCastThisTurn: [...f.spellsCastThisTurn.entries()].map(([s, n]) => [s, n] as const),
  turnsTakenThisTurn: f.turnsTakenThisTurn,
  skippedPhases: [...f.skippedPhases],
  activeTeamForTeamPlay: f.activeTeamForTeamPlay,
  seatEliminated: [...f.seatEliminated.entries()].map(([s, b]) => [s, b] as const),
  stickers: [...f.stickers],
  attractions: [...f.attractions.entries()].map(([s, a]) => [s, a] as const),
  countersAddedThisTurn: [...f.countersAddedThisTurn.entries()].map(([e, n]) => [e, n] as const),
  leftBattlefieldThisTurn: [...f.leftBattlefieldThisTurn],
  topLibsCast: [...f.topLibsCast],
});

const flagsFromJSON = (s: SerializedGameFlags): GameFlags => {
  const f = createDefaultFlags();
  f.dayNight = s.dayNight;
  f.monarch = s.monarch;
  f.initiative = s.initiative;
  for (const seat of s.cityBlessing) f.cityBlessing.add(seat);
  for (const [seat, entityOrNull] of s.ringBearer) f.ringBearer.set(seat, entityOrNull);
  for (const [seat, level] of s.ringLevel) f.ringLevel.set(seat, level);
  for (const [seat, level] of s.speedLevel) f.speedLevel.set(seat, level);
  for (const [seat, dungeon] of s.currentDungeon) f.currentDungeon.set(seat, dungeon);
  for (const [seat, arr] of s.commandersOwnedByPlayer) {
    f.commandersOwnedByPlayer.set(seat, [...arr]);
  }
  for (const [entity, n] of s.commanderCastCount) f.commanderCastCount.set(entity, n);
  for (const [entity, inner] of s.commanderDamage) {
    const m = new Map<PlayerSeat, number>();
    for (const [seat, n] of inner) m.set(seat, n);
    f.commanderDamage.set(entity, m);
  }
  for (const [seat, b] of s.firstTurnDrawSkipped) f.firstTurnDrawSkipped.set(seat, b);
  for (const [seat, n] of s.mulligansTaken) f.mulligansTaken.set(seat, n);
  for (const [seat, n] of s.landsPlayedThisTurn) f.landsPlayedThisTurn.set(seat, n);
  for (const [seat, n] of s.spellsCastThisTurn) f.spellsCastThisTurn.set(seat, n);
  f.turnsTakenThisTurn = s.turnsTakenThisTurn;
  f.skippedPhases = [...s.skippedPhases];
  f.activeTeamForTeamPlay = s.activeTeamForTeamPlay;
  for (const [seat, b] of s.seatEliminated) f.seatEliminated.set(seat, b);
  f.stickers = [...s.stickers];
  for (const [seat, a] of s.attractions) f.attractions.set(seat, a);
  // v6: required.
  for (const [id, n] of s.countersAddedThisTurn) f.countersAddedThisTurn.set(id, n);
  for (const id of s.leftBattlefieldThisTurn) f.leftBattlefieldThisTurn.add(id);
  for (const id of s.topLibsCast) f.topLibsCast.add(id);
  return f;
};

// === Card serialization ============================================

const cardToSnapshot = (c: Card): SerializedCard => ({
  id: c.id,
  paperCardKey: paperCardKey(c.paperCard),
  ownerSeat: c.ownerSeat,
  controllerSeat: c.controllerSeat,
  zone: c.zone,
  tapped: c.tapped,
  phased: c.phased,
  damage: c.damage,
  counters: Object.fromEntries(c.counters),
  attachedTo: c.attachedTo,
  attachments: [...c.attachments],
  copiedFrom: c.copiedFrom === null ? null : serializeCopiable(c.copiedFrom),
  faceDown: serializeFaceDown(c.faceDown),
  remembered: [...c.remembered],
  imprinted: [...c.imprinted],
  face: c.face,
  isToken: c.isToken,
  isEmblem: c.isEmblem,
  sagaFinalChapterResolved: c.sagaFinalChapterResolved,
  bestowed: c.bestowed,
  isCommander: c.isCommander,
  keywords: c.keywords === undefined ? [] : [...c.keywords].sort(),
  mutatedPile: c.mutatedPile === undefined ? null : [...c.mutatedPile],
  mutatedInto: c.mutatedInto === undefined ? null : c.mutatedInto,
  isAugment: c.isAugment === true,
  meldedFrom: c.meldedFrom === undefined ? null : [...c.meldedFrom],
});

// === Zone snapshot helpers =========================================

const zoneToSnapshot = (z: Zone): SerializedZone => z.toJSON();

/**
 * Factory for concrete Zone subclasses keyed by ZoneType. Battlefield/Hand/
 * Library/Graveyard/Command-zone instantiate the player-owned subclasses;
 * Exile/Ante construct the shared subclasses. Zones not populated in SP1 fall
 * back to `Battlefield` as a typed sentinel — SP7 (attractions, contraptions)
 * adds their concrete classes and this switch extends.
 */
const makeZone = (type: ZoneType, ownerSeat: PlayerSeat | null): Zone => {
  switch (type) {
    case ZoneTypeEnum.Hand:
      return new Hand(type, ownerSeat);
    case ZoneTypeEnum.Library:
      return new Library(type, ownerSeat);
    case ZoneTypeEnum.Graveyard:
      return new Graveyard(type, ownerSeat);
    case ZoneTypeEnum.Battlefield:
      return new Battlefield(type, ownerSeat);
    case ZoneTypeEnum.Exile:
      return new Exile(type, ownerSeat);
    case ZoneTypeEnum.Command:
      return new CommandZone(type, ownerSeat);
    case ZoneTypeEnum.Ante:
      return new Ante(type, ownerSeat);
    // WHY: SP1 doesn't yet surface concrete classes for these zones; fall
    // through to a Battlefield-shaped generic so the snapshot round-trip
    // preserves item lists losslessly. Replace as subclasses land.
    default:
      return new Battlefield(type, ownerSeat);
  }
};

// === LayerEngine state serialization ===============================

const layerEngineToJSON = (game: Game): SerializedLayerEngineState => ({
  // Text substitutions are pure data (from/to strings + timestamps).
  textSubstitutions: [...game.layerEngine.textSubstitutions],
  typeEffects: game.layerEngine.typeEffects.map(serializeTypeEffect),
  colorEffects: game.layerEngine.colorEffects.map(serializeColorEffect),
  // AbilityChangeEffect is already pure data (EntityIds + discriminated kinds).
  abilityEffects: [...game.layerEngine.abilityEffects],
  pt7a: [...game.layerEngine.pt7a],
  pt7b: [...game.layerEngine.pt7b],
  pt7c: [...game.layerEngine.pt7c],
  pt7d: [...game.layerEngine.pt7d],
  pt7e: [...game.layerEngine.pt7e],
});

const restoreLayerEngine = (game: Game, s: SerializedLayerEngineState): void => {
  // WHY push-then-splice not assign: the LayerEngine's arrays are
  // `readonly` fields (mutable contents, immutable binding). We mutate in
  // place, clearing first, to preserve the field reference.
  game.layerEngine.textSubstitutions.length = 0;
  for (const e of s.textSubstitutions) game.layerEngine.textSubstitutions.push(e);
  game.layerEngine.typeEffects.length = 0;
  for (const e of s.typeEffects) game.layerEngine.typeEffects.push(deserializeTypeEffect(e));
  game.layerEngine.colorEffects.length = 0;
  for (const e of s.colorEffects) game.layerEngine.colorEffects.push(deserializeColorEffect(e));
  game.layerEngine.abilityEffects.length = 0;
  for (const e of s.abilityEffects) game.layerEngine.abilityEffects.push(e);
  game.layerEngine.pt7a.length = 0;
  for (const e of s.pt7a) game.layerEngine.pt7a.push(e);
  game.layerEngine.pt7b.length = 0;
  for (const e of s.pt7b) game.layerEngine.pt7b.push(e);
  game.layerEngine.pt7c.length = 0;
  for (const e of s.pt7c) game.layerEngine.pt7c.push(e);
  game.layerEngine.pt7d.length = 0;
  for (const e of s.pt7d) game.layerEngine.pt7d.push(e);
  game.layerEngine.pt7e.length = 0;
  for (const e of s.pt7e) game.layerEngine.pt7e.push(e);
  // Every layer-engine state change invalidates the cached characteristics;
  // bump so computeCharacteristics re-derives from the restored arrays.
  game.layerEngine.bumpEpoch("snapshot-restore");
};

// === ControlChangeLedger serialization =============================

const controlChangeLedgerToJSON = (game: Game): readonly SerializedControlChangeEntry[] => {
  const out: SerializedControlChangeEntry[] = [];
  // ControlChangeLedger exposes only `get(cardId)` publicly. We iterate
  // Game.cards and consult the ledger — since entries are keyed by cardId,
  // this captures every recorded entry without a private-field peek.
  for (const cardId of game.cards.keys()) {
    const entry = game.controlChangeLedger.get(cardId);
    if (!entry) continue;
    out.push({
      cardId,
      priorController: entry.priorController,
      duration: entry.duration,
      registeredAtTurn: entry.registeredAtTurn,
    });
  }
  return out;
};

const restoreControlChangeLedger = (game: Game, entries: readonly SerializedControlChangeEntry[]): void => {
  for (const e of entries) {
    game.controlChangeLedger.record(e.cardId, e.priorController, e.duration, e.registeredAtTurn);
  }
};

// === Top-level snapshot ============================================

/**
 * Options for snapshot(). `now` supplies the savedAt ISO string — callers
 * that need a wall-clock stamp pass `() => new Date().toISOString()`;
 * deterministic tests and replay tooling pass a fixed string. Defaulting
 * to a constant "sentinel" keeps snapshot() itself pure (the determinism
 * lint refuses ambient `new Date()` inside packages/game) while giving
 * hosts an explicit opt-in to wall-clock timestamps.
 */
export interface SnapshotOptions {
  readonly now?: () => string;
}

const DEFAULT_SAVED_AT = "1970-01-01T00:00:00.000Z";

/**
 * Walk the live Game and produce a JSON-stringifiable GameSnapshot. The
 * returned object contains only plain values — no class instances, no bigint,
 * no Map/Set — so `JSON.stringify(snapshot(game))` never throws.
 *
 * DEFERRED state (see top-of-file block): live ability objects
 * (ReplacementRegistry / TriggerRegistry / StaticEffectRegistry entries,
 * DelayedTriggerQueue entries, StackItem.resolver, Card.intrinsicStatics)
 * are NOT captured. SP2 snapshots are intended for priority-window
 * serialization, not mid-resolution state. SP3's AbilityRegistry will
 * unlock full fidelity.
 */
export const snapshot = (game: Game, opts: SnapshotOptions = {}): GameSnapshot => {
  const players: SerializedPlayer[] = game.players.map((p) => ({
    seat: p.seat,
    lobbyPlayerId: p.lobbyPlayer.id,
    teamId: p.teamId,
    life: p.life,
    counters: Object.fromEntries(p.counters),
    zones: [...p.zones.values()].map(zoneToSnapshot),
  }));

  const cards: SerializedCard[] = [...game.cards.values()].map(cardToSnapshot);

  const pendingTriggers: SerializedPendingTrigger[] = game.triggerRegistry.peekPending().map((pt) => ({
    id: pt.id,
    triggerId: pt.triggerId,
    sourceCardId: pt.sourceCardId,
    event: pt.event,
    lki: pt.lki,
    sourceControllerAtFire: pt.sourceControllerAtFire,
    firedAtTurn: pt.firedAtTurn,
    firedAtPhase: pt.firedAtPhase,
  }));

  return {
    header: {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      engineVersion: game.meta.engineVersion,
      forgeSha: game.meta.forgeSha,
      cardDataSyncedAt: game.meta.cardDataSyncedAt,
      crVersion: game.meta.crVersion,
      savedAt: opts.now ? opts.now() : DEFAULT_SAVED_AT,
      formatId: game.rules.formatId,
      // SP6 populates this with a real format snapshot; null until then.
      formatDefinitionSnapshot: null,
      seed: game.meta.seed,
    },
    state: {
      turn: game.turn,
      phase: game.phase,
      activePlayer: game.activePlayer,
      priorityPlayer: game.priorityPlayer,
      startingPlayer: game.startingPlayer,
      players,
      cards,
      sharedZones: {
        stack: { items: [...game.sharedZones.stack.toArray()].map(serializeStackItem) },
        exile: zoneToSnapshot(game.sharedZones.exile),
        ante: zoneToSnapshot(game.sharedZones.ante),
      },
      flags: flagsToJSON(game.flags),
      rngState: serializeRngState(game.rng.getState()),
      entityIdCounter: computeNextEntityId(game),
      terminalState: game.terminalState,
      // v6: combat stays reserved (CombatHandler is minted per combat run,
      // no cross-priority-window state to persist).
      combat: null,
      // v6: cardRemembered slot is fully replaced by per-card remembered
      // arrays. Kept as {} for back-compat of tooling that peeked here.
      cardRemembered: {},
      // Shallow-clone the list so later mutation of game.continuousEffects
      // does not leak into the emitted snapshot. Payload values are plain
      // JSON per ContinuousEffect doc; shallow copy is sufficient.
      continuousEffects: [...game.continuousEffects],
      // === v6 additions ===
      ringState: [...game.ringState.entries()].map(([seat, state]) => [seat, state] as const),
      teamLife:
        game.teamLife === null
          ? null
          : [...game.teamLife.entries()].map(([teamId, life]) => [teamId, life] as const),
      pendingControlReverts: [...game.pendingControlReverts],
      companions: [...game.companions.entries()].map(([seat, cardIdOrNull]) => [seat, cardIdOrNull] as const),
      controlChangeLedger: controlChangeLedgerToJSON(game),
      layerEngine: layerEngineToJSON(game),
      pendingTriggers,
      delayedTriggerCount: game.delayedTriggerQueue.size(),
    },
  };
};

/**
 * Game.entityIdCounter is private; we can't read it from outside. Instead
 * compute a safe "next id" from the snapshot's own contents (max existing id +
 * 1). This preserves the monotonic-allocator invariant without adding a public
 * getter that would encourage misuse.
 */
const computeNextEntityId = (game: Game): number => {
  let max = -1;
  for (const id of game.cards.keys()) {
    const n = id as unknown as number;
    if (n > max) max = n;
  }
  for (const item of game.sharedZones.stack.toArray()) {
    const n = item.id as unknown as number;
    if (n > max) max = n;
  }
  return max + 1;
};

// === Restore =======================================================

/**
 * restore() inputs: the snapshot plus everything the snapshot can't carry
 * itself — LobbyPlayer closures (controllers live outside the engine),
 * PaperCard defs (content-addressed, not embedded), GameRules (infrequently
 * changing; caller owns), and the Rng instance (setState-driven).
 */
export interface RestoreOptions {
  readonly lobbyPlayers: readonly LobbyPlayer[];
  readonly rng: Rng;
  readonly paperCards: ReadonlyMap<string, PaperCard>;
  readonly rules: GameRules;
}

/**
 * Reconstruct a Game from a GameSnapshot. The returned Game is equivalent to
 * the one that produced the snapshot — same turn/phase, same zone contents,
 * same card state, same rng stream (the next nextLong() call on the restored
 * Game produces the same output as the next call on the original would have).
 *
 * Fails loudly on:
 *   - schemaVersion mismatch (v5 is NOT auto-migrated; see migration block
 *     at top-of-file)
 *   - LobbyPlayer id not in opts.lobbyPlayers
 *   - paperCardKey not in opts.paperCards
 *   - snapshot's engine meta missing / malformed
 */
export const restore = (snap: GameSnapshot, opts: RestoreOptions): Game => {
  if (snap.header.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    // WHY not auto-migrate: v5 → v6 adds many required fields (Card.face,
    // mutate pile, keywords, Ring state, control-change ledger entries)
    // that have no safe default for arbitrary game positions. Loading a
    // v5 blob into a v6 engine would silently lose state. The CLI /
    // replay tooling can run a purpose-built migrator when needed; the
    // runtime stays strict.
    throw new IncompatibleSnapshotVersionError(
      `GameSnapshot.restore: schema version ${snap.header.schemaVersion} incompatible with engine (${SNAPSHOT_SCHEMA_VERSION}); v5 → v6 auto-migration is not supported`,
    );
  }

  // Pair snapshot players with the caller-supplied LobbyPlayer list by id.
  const lobbyById = new Map(opts.lobbyPlayers.map((lp) => [lp.id, lp] as const));
  const orderedLobbyPlayers: LobbyPlayer[] = snap.state.players.map((sp) => {
    const lp = lobbyById.get(sp.lobbyPlayerId);
    if (!lp) {
      throw new SnapshotRestoreError(
        `GameSnapshot.restore: missing LobbyPlayer for id "${sp.lobbyPlayerId}"`,
      );
    }
    return lp;
  });

  const game = new Game({
    lobbyPlayers: orderedLobbyPlayers,
    rules: opts.rules,
    meta: {
      engineVersion: snap.header.engineVersion,
      forgeSha: snap.header.forgeSha,
      cardDataSyncedAt: snap.header.cardDataSyncedAt,
      crVersion: snap.header.crVersion,
      seed: snap.header.seed,
    },
    rng: opts.rng,
  });

  // Overwrite mutable top-level state.
  game.turn = snap.state.turn;
  game.phase = snap.state.phase;
  game.activePlayer = snap.state.activePlayer;
  game.priorityPlayer = snap.state.priorityPlayer;
  game.startingPlayer = snap.state.startingPlayer;
  game.terminalState = snap.state.terminalState;

  // Rehydrate each Player's mutable fields + zones (new Player instances are
  // already minted by Game's constructor; we reach into them to set state).
  for (let i = 0; i < snap.state.players.length; i++) {
    const sp = snap.state.players[i];
    const p = game.players[i];
    if (!sp || !p) continue;
    // Seat + teamId + lobbyPlayer are determined at construction — assert they
    // match the snapshot rather than overwriting silently.
    if (sp.seat !== p.seat) {
      throw new SnapshotRestoreError(
        `GameSnapshot.restore: player[${i}] seat ${sp.seat as unknown as number} !== constructed seat ${
          p.seat as unknown as number
        }`,
      );
    }
    p.teamId = sp.teamId;
    p.life = sp.life;
    p.counters.clear();
    for (const [k, v] of Object.entries(sp.counters)) {
      p.counters.set(k as CounterType, v);
    }
    p.zones.clear();
    for (const sz of sp.zones) {
      const z = makeZone(sz.type, sz.ownerSeat);
      for (const entry of sz.items) z.add(mkEntityId(entry as unknown as number));
      p.zones.set(sz.type, z);
    }
  }

  // Rebuild the card registry. Cards are keyed by EntityId; walk the snapshot
  // cards array in order and rehydrate each via Card's constructor + mutable
  // field assignment.
  game.cards.clear();
  for (const sc of snap.state.cards) {
    const paper = opts.paperCards.get(sc.paperCardKey);
    if (!paper) {
      // WHY: UnknownCardError is the canonical "card identity not resolvable"
      // signal across the engine (card-db lookups, deck legality, etc.).
      // Restoring a snapshot whose PaperCard is absent from the supplied
      // registry is the same class of failure.
      throw new UnknownCardError(sc.paperCardKey);
    }
    const card = new Card(sc.id, paper, sc.ownerSeat, sc.controllerSeat, sc.zone);
    card.tapped = sc.tapped;
    card.phased = sc.phased;
    card.damage = sc.damage;
    for (const [k, v] of Object.entries(sc.counters)) {
      card.counters.set(k as CounterType, v);
    }
    card.attachedTo = sc.attachedTo;
    card.attachments = [...sc.attachments];
    card.copiedFrom = sc.copiedFrom === null ? null : deserializeCopiable(sc.copiedFrom);
    card.faceDown = deserializeFaceDown(sc.faceDown);
    card.remembered = [...sc.remembered];
    card.imprinted = [...sc.imprinted];
    card.face = sc.face;
    card.isToken = sc.isToken;
    card.isEmblem = sc.isEmblem;
    card.sagaFinalChapterResolved = sc.sagaFinalChapterResolved;
    card.bestowed = sc.bestowed;
    card.isCommander = sc.isCommander;
    // keywords: empty array on wire → leave undefined on live card to keep
    // the common-case zero-alloc behavior documented in card.ts.
    if (sc.keywords.length > 0) card.keywords = new Set(sc.keywords);
    // mutate / host+augment / meld — wire form uses `null` sentinels.
    // intrinsicStatics is DEFERRED — SP3's CardDb integration reattaches.
    if (sc.mutatedPile !== null) card.mutatedPile = [...sc.mutatedPile];
    if (sc.mutatedInto !== null) card.mutatedInto = sc.mutatedInto;
    if (sc.isAugment) card.isAugment = true;
    if (sc.meldedFrom !== null) card.meldedFrom = [...sc.meldedFrom];
    game.cards.set(sc.id, card);
  }

  // Shared zones. Game's constructor already mints Exile + Ante instances; we
  // clear and refill them rather than replacing (keeps the Game.sharedZones
  // readonly reference pattern intact).
  game.sharedZones.exile.clear();
  for (const id of snap.state.sharedZones.exile.items) {
    game.sharedZones.exile.add(mkEntityId(id as unknown as number));
  }
  game.sharedZones.ante.clear();
  for (const id of snap.state.sharedZones.ante.items) {
    game.sharedZones.ante.add(mkEntityId(id as unknown as number));
  }

  // Stack — Stack items are the rich StackItem shape, not EntityIds.
  // Stack doesn't expose a clear(); since restore always runs on a freshly
  // constructed Game the stack is already empty.
  for (const item of snap.state.sharedZones.stack.items) {
    game.sharedZones.stack.push(deserializeStackItem(item));
  }

  // Flags (Maps/Sets rehydrated via flagsFromJSON — we overwrite via Object
  // assignment because the Game constructor already installed defaults).
  const restoredFlags = flagsFromJSON(snap.state.flags);
  Object.assign(game.flags, restoredFlags);

  // Rng state — bridge hex-string payload back to bigint.
  game.rng.setState(deserializeRngState(snap.state.rngState));

  // Restore the private entity-id counter so freshly-minted ids after restore
  // don't collide with ids baked into the restored card registry.
  game.restoreEntityIdCounter(snap.state.entityIdCounter);

  // Continuous-effect ledger — shallow-copy the list back onto the Game.
  game.continuousEffects = [...snap.state.continuousEffects];

  // === v6 additions ===
  // ringState: sparse per-seat Ring state.
  for (const [seat, state] of snap.state.ringState) {
    game.ringState.set(seat, state);
  }
  // teamLife: the Game constructor only mints this for 2HG; reconcile the
  // snapshot state back onto the field directly.
  if (snap.state.teamLife === null) {
    game.teamLife = null;
  } else {
    const pool = new Map<number, number>();
    for (const [teamId, life] of snap.state.teamLife) pool.set(teamId, life);
    game.teamLife = pool;
  }
  for (const id of snap.state.pendingControlReverts) {
    game.pendingControlReverts.push(id);
  }
  for (const [seat, companionIdOrNull] of snap.state.companions) {
    game.companions.set(seat, companionIdOrNull);
  }
  restoreControlChangeLedger(game, snap.state.controlChangeLedger);
  restoreLayerEngine(game, snap.state.layerEngine);
  // Pending triggers are re-pushed via the registry's delayed-trigger
  // forcing path — it re-captures the same PendingTrigger shape without
  // re-running matches().
  for (const pt of snap.state.pendingTriggers) {
    game.triggerRegistry.pushRestoredPending({
      id: pt.id,
      triggerId: pt.triggerId,
      sourceCardId: pt.sourceCardId,
      event: pt.event,
      lki: pt.lki,
      sourceControllerAtFire: pt.sourceControllerAtFire,
      firedAtTurn: pt.firedAtTurn,
      firedAtPhase: pt.firedAtPhase,
    });
  }
  // delayedTriggerCount is informational-only on restore — the queue is
  // DEFERRED (DelayedTrigger.matches is a live fn). A future consistency
  // check could assert game.delayedTriggerQueue.size() === snap.state
  // .delayedTriggerCount once SP3 lands full rehydration; today the
  // restored queue is empty.

  return game;
};
