// SPDX-License-Identifier: GPL-3.0-or-later
// PlayerController decisions — engine-to-consumer request/response pairs.
//
// Spec §4 (lines 165-188) enumerates 23 DecisionRequest variants while the
// header text says "22 decision kinds"; the explicit list is canonical here
// because downstream casting paths (alt-cost: Flash, Foretell, Evoke, Dash,
// Madness, etc.) are undeliverable without `chooseAltCost`. The delta is
// called out in the Task 23 commit body.
//
// Each DecisionRequest variant has a sibling DecisionResponse variant with
// the same `kind`, so pairing is captured by the discriminator rather than
// by a separate lookup table. Payloads are deep-readonly to prevent
// downstream consumers from mutating engine-owned snapshots.
//
// Type guards `isRequest` / `isResponse` narrow without a switch — handy when
// a controller cares about a single kind (tests, AI skeletons, debug adapters).

import type { Cost } from "../cost/cost.js";
import type { EntityId, PlayerSeat } from "../ids.js";
import type { ZoneType } from "../zone.js";

/**
 * How a declared attacker is assigned against the defending side. The nested
 * union keeps declareAttackers/declareBlockers response shapes uniform with
 * the `AttackersDeclared` GameEvent payload — one defender model end-to-end.
 */
export type DefenderOption =
  | { readonly kind: "player"; readonly seat: PlayerSeat }
  | { readonly kind: "planeswalker"; readonly id: EntityId }
  | { readonly kind: "battle"; readonly id: EntityId };

/**
 * Choices available when a player has priority. `concede` is mandatory —
 * Task 49's integration smoke test issues a concede through this path, and
 * the engine contract requires a terminal action the controller can always
 * take. `requestShortcut` is the hook for Forge-style UI shortcuts whose
 * result payload is consumer-defined (typed `unknown` deliberately).
 */
export type PriorityAction =
  | {
      readonly kind: "castSpell";
      readonly cardId: EntityId;
      readonly zone: ZoneType;
      readonly altCost?: string;
      readonly additionalCosts?: readonly string[];
    }
  | { readonly kind: "activateAbility"; readonly abilityInstanceId: EntityId }
  | { readonly kind: "activateManaAbility"; readonly abilityInstanceId: EntityId }
  | { readonly kind: "pass" }
  | { readonly kind: "concede" }
  | { readonly kind: "requestShortcut"; readonly description: string; readonly result: unknown };

/**
 * Shared shape for "pick one of these labeled choices" payloads. Using an
 * object with description keeps presentation-layer strings out of the engine
 * core (controllers render them; the engine only uses `id` for resolution).
 */
export interface NamedOption {
  readonly id: string;
  readonly description: string;
}

/** Alt-cost offer (Flashback, Foretell, Evoke, Dash, Madness, etc.). */
export interface AltCostOption {
  readonly id: string;
  readonly description: string;
  readonly cost: Cost;
}

/**
 * Modal-spell choice — same shape as a NamedOption but kept distinct so future
 * mode-specific fields (e.g. mode-count scaling for Kicker modals) don't
 * pollute the generic NamedOption.
 */
export interface ModeOption {
  readonly id: string;
  readonly description: string;
}

/**
 * DecisionRequest — engine-yielded request for a player decision. 23 kinds
 * per spec §4. See file header for the 22-vs-23 note.
 */
export type DecisionRequest =
  | {
      readonly kind: "mulligan";
      readonly playerSeat: PlayerSeat;
      readonly currentHand: readonly EntityId[];
      readonly mulligansSoFar: number;
      readonly rule: "london" | "vancouver" | "paris" | "free";
    }
  | {
      readonly kind: "openingHandAction";
      readonly playerSeat: PlayerSeat;
      // WHY: opening-hand actions (leylines, companions, "on your first turn"
      // reveals) are set-dependent; SP3 fills in concrete ability IDs. Keep as
      // opaque string identifiers until then to avoid locking the shape early.
      readonly availableActions: readonly string[];
    }
  | {
      readonly kind: "priority";
      readonly playerSeat: PlayerSeat;
      readonly legalActions: readonly PriorityAction[];
    }
  | {
      readonly kind: "chooseTargets";
      readonly sourceId: EntityId;
      // WHY: TargetRestriction predicate tree lands in Task 27; typed
      // `unknown` here so controllers don't depend on unreleased AST shape.
      readonly restriction: unknown;
      readonly min: number;
      readonly max: number;
      readonly choicesAllowed: readonly EntityId[];
    }
  | {
      readonly kind: "chooseModes";
      readonly sourceId: EntityId;
      readonly modes: readonly ModeOption[];
      readonly min: number;
      readonly max: number;
    }
  | { readonly kind: "chooseX"; readonly sourceId: EntityId; readonly maxX: number }
  | {
      readonly kind: "distribute";
      readonly sourceId: EntityId;
      readonly amount: number;
      readonly recipients: readonly EntityId[];
      readonly minPerRecipient: number;
    }
  | {
      readonly kind: "choosePayment";
      readonly cost: Cost;
      readonly payableSources: readonly EntityId[];
    }
  | {
      readonly kind: "orderTriggers";
      readonly playerSeat: PlayerSeat;
      readonly triggerIds: readonly EntityId[];
    }
  | {
      readonly kind: "orderReplacements";
      readonly playerSeat: PlayerSeat;
      readonly replacementIds: readonly EntityId[];
    }
  | {
      readonly kind: "declareAttackers";
      readonly playerSeat: PlayerSeat;
      readonly legalAttackers: readonly EntityId[];
      readonly legalDefenders: readonly DefenderOption[];
    }
  | {
      readonly kind: "declareBlockers";
      readonly playerSeat: PlayerSeat;
      readonly legalBlockers: readonly EntityId[];
      readonly attackers: readonly EntityId[];
    }
  | {
      readonly kind: "orderBlockers";
      readonly playerSeat: PlayerSeat;
      readonly attackerId: EntityId;
      readonly blockers: readonly EntityId[];
    }
  | {
      readonly kind: "assignDamage";
      readonly attackerId: EntityId;
      readonly blockerOrder: readonly EntityId[];
      readonly amountToAssign: number;
    }
  | {
      readonly kind: "chooseCard";
      readonly playerSeat: PlayerSeat;
      readonly pool: readonly EntityId[];
      readonly restriction: unknown;
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly kind: "chooseCardOrder";
      readonly playerSeat: PlayerSeat;
      readonly cards: readonly EntityId[];
    }
  | {
      readonly kind: "scry";
      readonly playerSeat: PlayerSeat;
      readonly cards: readonly EntityId[];
    }
  | {
      readonly kind: "surveil";
      readonly playerSeat: PlayerSeat;
      readonly cards: readonly EntityId[];
    }
  | {
      readonly kind: "chooseOption";
      readonly sourceId: EntityId;
      readonly options: readonly NamedOption[];
    }
  | {
      readonly kind: "declareSplit";
      readonly sourceId: EntityId;
      // WHY: Fuse and Split spells (Fire // Ice, Far // Away) resolve as one
      // or both faces; each face has an id the engine uses to route the cast.
      readonly faces: readonly NamedOption[];
    }
  | {
      readonly kind: "choosePlayer";
      readonly sourceId: EntityId;
      readonly restriction: unknown;
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly kind: "chooseZone";
      readonly sourceId: EntityId;
      readonly zones: readonly ZoneType[];
    }
  | {
      readonly kind: "chooseAltCost";
      readonly sourceId: EntityId;
      readonly altCosts: readonly AltCostOption[];
    };

/**
 * DecisionResponse — consumer-supplied answer to the engine's DecisionRequest.
 * Same discriminator set as DecisionRequest; shapes carry the minimum state
 * needed to resume the engine.
 */
export type DecisionResponse =
  | {
      readonly kind: "mulligan";
      // WHY: London mulligan -> keep then bottom N cards; free/Vancouver/Paris
      // -> keep with optional bottomed (Vancouver scry-1 returns 1). The
      // optional array covers all four rules with one shape.
      readonly keep: boolean;
      readonly bottomed?: readonly EntityId[];
    }
  | {
      readonly kind: "openingHandAction";
      // WHY: action ids mirror availableActions in the request; empty array
      // means "take no opening-hand action this round".
      readonly chosenActions: readonly string[];
    }
  | { readonly kind: "priority"; readonly action: PriorityAction }
  | { readonly kind: "chooseTargets"; readonly targets: readonly EntityId[] }
  | { readonly kind: "chooseModes"; readonly modeIds: readonly string[] }
  | { readonly kind: "chooseX"; readonly x: number }
  | {
      readonly kind: "distribute";
      // WHY: parallel array (same length as request.recipients) of per-recipient
      // assigned amounts. Sum must equal request.amount (engine validates).
      readonly assignments: readonly number[];
    }
  | {
      readonly kind: "choosePayment";
      // WHY: opaque payment-plan tree (mana allocations, sacrificed creatures,
      // alt-cost swaps) resolves in later phases; keep `unknown` here so the
      // payload is inert until Task 28's Cost AST lands.
      readonly plan: unknown;
    }
  | { readonly kind: "orderTriggers"; readonly order: readonly EntityId[] }
  | { readonly kind: "orderReplacements"; readonly order: readonly EntityId[] }
  | {
      readonly kind: "declareAttackers";
      // WHY: defender tag mirrors `AttackersDeclared` event payload so the
      // event the engine emits is a trivial transform of this response.
      readonly attackers: readonly {
        readonly attacker: EntityId;
        readonly defender:
          | { readonly player: PlayerSeat }
          | { readonly planeswalker: EntityId }
          | { readonly battle: EntityId };
      }[];
    }
  | {
      readonly kind: "declareBlockers";
      readonly blocks: readonly {
        readonly attackerId: EntityId;
        readonly blockerIds: readonly EntityId[];
      }[];
    }
  | { readonly kind: "orderBlockers"; readonly order: readonly EntityId[] }
  | {
      readonly kind: "assignDamage";
      // WHY: parallel array (same length/order as request.blockerOrder plus an
      // optional trailing "to defender" entry); engine validates the sum and
      // lethal-damage rule against toughness + deathtouch.
      readonly assignments: readonly number[];
    }
  | { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] }
  | { readonly kind: "chooseCardOrder"; readonly order: readonly EntityId[] }
  | {
      readonly kind: "scry";
      readonly toTop: readonly EntityId[];
      readonly toBottom: readonly EntityId[];
    }
  | {
      readonly kind: "surveil";
      readonly toTop: readonly EntityId[];
      readonly toGraveyard: readonly EntityId[];
    }
  | { readonly kind: "chooseOption"; readonly optionId: string }
  | {
      readonly kind: "declareSplit";
      // WHY: array covers fuse (both faces) and single-face casts; engine
      // verifies each id appears in request.faces.
      readonly faceIds: readonly string[];
    }
  | { readonly kind: "choosePlayer"; readonly chosen: readonly PlayerSeat[] }
  | { readonly kind: "chooseZone"; readonly chosen: ZoneType }
  | { readonly kind: "chooseAltCost"; readonly altCostId: string };

/** All request discriminator values. */
export type DecisionRequestKind = DecisionRequest["kind"];

/** All response discriminator values — set-equal to DecisionRequestKind. */
export type DecisionResponseKind = DecisionResponse["kind"];

/** Narrow a DecisionRequest to a specific variant without a switch. */
export const isRequest = <K extends DecisionRequestKind>(
  request: DecisionRequest,
  kind: K,
): request is Extract<DecisionRequest, { kind: K }> => request.kind === kind;

/** Narrow a DecisionResponse to a specific variant without a switch. */
export const isResponse = <K extends DecisionResponseKind>(
  response: DecisionResponse,
  kind: K,
): response is Extract<DecisionResponse, { kind: K }> => response.kind === kind;
