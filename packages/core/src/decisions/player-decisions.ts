// SPDX-License-Identifier: GPL-3.0-or-later
// PlayerController decisions — engine-to-consumer request/response pairs.
//
// SP1 baseline (spec §4) enumerated 23 DecisionRequest variants. SP1 post-
// audit extends to 44 to cover the Forge PlayerController hooks SP2+ card
// scripts reach for: chooseNumber/Color/Colors/CounterType/CardsPile, vote,
// confirm{Action,Replacement,Trigger}, chooseStartingPlayer,
// chooseOptionalCosts, chooseKeywordForPump, chooseProtectionType, die-roll
// modifiers (modify/reroll/ignore/swap), Attractions (chooseSector) /
// Contraptions (chooseSprocket, chooseContraptionsToCrank), and London-
// mulligan bottoming (mulliganBottom, SP2-wired).
//
// Each DecisionRequest variant has a sibling DecisionResponse variant with
// the same `kind`, so pairing is captured by the discriminator rather than
// by a separate lookup table. Payloads are deep-readonly to prevent
// downstream consumers from mutating engine-owned snapshots.
//
// Type guards `isRequest` / `isResponse` narrow without a switch — handy when
// a controller cares about a single kind (tests, AI skeletons, debug adapters).

import type { Color, ColorSet } from "../color.js";
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
  // SP2 Task 41 — special action (CR 116.2a). "Playing a land" is a special
  // action, not casting a spell; the legal-action enumerator surfaces one
  // entry per land in hand during the active player's main phase when the
  // stack is empty and the land-per-turn limit has not been reached.
  | { readonly kind: "playLand"; readonly cardId: EntityId }
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
    }
  // === Post-audit Forge parity: generic choosers ===
  | {
      readonly kind: "chooseNumber";
      readonly sourceId: EntityId;
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly kind: "chooseColor";
      readonly sourceId: EntityId;
      readonly allowColorless: boolean;
    }
  | {
      readonly kind: "chooseColors";
      readonly sourceId: EntityId;
      readonly min: number;
      readonly max: number;
      readonly allowColorless: boolean;
    }
  | {
      readonly kind: "chooseCounterType";
      readonly sourceId: EntityId;
      // WHY: typed `unknown` now; Task 27 counter-type constraint AST will
      // replace this once available.
      readonly restriction?: unknown;
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly kind: "chooseCardsPile";
      readonly sourceId: EntityId;
      readonly pileA: readonly EntityId[];
      readonly pileB: readonly EntityId[];
    }
  | {
      // WHY: Council's Dilemma and similar vote effects. voters cast vote
      // separately via their own request; engine aggregates.
      readonly kind: "vote";
      readonly sourceId: EntityId;
      readonly voterSeat: PlayerSeat;
      readonly choices: readonly NamedOption[];
    }
  | {
      readonly kind: "confirmAction";
      readonly sourceId: EntityId;
      readonly prompt: string;
    }
  | {
      readonly kind: "confirmReplacement";
      readonly effectId: EntityId;
      readonly description: string;
    }
  | {
      readonly kind: "confirmTrigger";
      readonly triggerId: EntityId;
      readonly description: string;
    }
  | {
      readonly kind: "chooseStartingPlayer";
      readonly playerSeat: PlayerSeat;
    }
  | {
      readonly kind: "chooseOptionalCosts";
      readonly sourceId: EntityId;
      readonly options: readonly NamedOption[];
    }
  | {
      readonly kind: "chooseKeywordForPump";
      readonly sourceId: EntityId;
      readonly keywords: readonly string[];
    }
  | {
      readonly kind: "chooseProtectionType";
      readonly sourceId: EntityId;
    }
  // === Post-audit Forge parity: die / roll modifiers ===
  | {
      readonly kind: "chooseRollToModify";
      readonly rollId: string;
      readonly resultBefore: number;
      readonly modifierId: string;
    }
  | {
      readonly kind: "chooseRollToReroll";
      readonly rollId: string;
      readonly resultBefore: number;
    }
  | {
      readonly kind: "chooseRollToIgnore";
      readonly rolls: readonly { readonly id: string; readonly result: number }[];
    }
  | {
      readonly kind: "chooseRollToSwap";
      readonly rollIds: readonly string[];
    }
  // === Post-audit Forge parity: Attractions / Contraptions ===
  | {
      readonly kind: "chooseSector";
      readonly sourceId: EntityId;
      readonly sectorIds: readonly string[];
    }
  | {
      readonly kind: "chooseSprocket";
      readonly sourceId: EntityId;
      readonly sprockets: readonly number[];
    }
  | {
      readonly kind: "chooseContraptionsToCrank";
      readonly sourceId: EntityId;
      readonly available: readonly EntityId[];
    }
  // === Post-audit Forge parity: London-mulligan bottoming ===
  | {
      // WHY: SP2 wires this after the mulligan keep/reject step — after N
      // mulligans taken, the keeping player bottoms N cards from their hand.
      readonly kind: "mulliganBottom";
      readonly playerSeat: PlayerSeat;
      readonly hand: readonly EntityId[];
      readonly countToBottom: number;
    }
  | {
      // CR 704.5j — when two or more legendary permanents with the same
      // name share a controller, that controller chooses which one stays;
      // the rest go to their owners' graveyards.
      readonly kind: "chooseLegendKeeper";
      readonly playerSeat: PlayerSeat;
      readonly candidateIds: readonly EntityId[];
    }
  | {
      // SP2 Task 36 — CastPipeline step 2 (ChooseFace). Modal DFC, Transform
      // DFC (first-cast decides face), and Adventure cards yield this so the
      // casting player picks which face they're casting. Distinct from
      // `declareSplit`, which handles Split/Fuse spells (both faces can be
      // cast at once). `options` carries the short face ids the card uses
      // ("front"/"back"/"L"/"R"/"adventure"); the engine validates the
      // chosen face is in the option set.
      readonly kind: "chooseFace";
      readonly playerSeat: PlayerSeat;
      readonly cardId: EntityId;
      readonly options: readonly string[];
    }
  | {
      // SP2 Task 37 — CastPipeline step 7 (ChooseTargets). Distinct from
      // the generic `chooseTargets` (which predates the TargetRef union and
      // carries EntityId[]-only targets) because SP2 targeting admits
      // players AND cards under one ref shape. `legalTargets` is typed
      // `readonly unknown[]` to avoid a core→game circular import —
      // consumers narrow via ../../packages/game/src/target/restriction.ts
      // TargetRef. `divideX` is set iff the ability divides X among its
      // targets; the response's `divisions` map (target-index → amount)
      // then has to sum to divideX.amount (TargetSystem validates).
      readonly kind: "chooseCastTargets";
      readonly playerSeat: PlayerSeat;
      readonly sourceId: EntityId;
      readonly legalTargets: readonly unknown[];
      readonly min: number;
      readonly max: number;
      readonly divideX?: { readonly amount: number };
    }
  | {
      // SP2 Task 38 — CastPipeline step 9 (ActivateManaAbilities). Between
      // cost determination (step 8) and payment (step 10), CR 601.2g lets
      // the caster activate any legal mana ability. SP2 collapses this to a
      // single binary decision — "done activating mana abilities, proceed
      // to pay"; SP3's priority orchestrator (Milestone J) swaps this for
      // the full per-activation mini-priority window.
      readonly kind: "activateManaAbilities";
      readonly playerSeat: PlayerSeat;
      readonly forStackItem: EntityId;
    }
  | {
      // SP2 Milestone W Task 70 — CR 701.25 proliferate. The engine
      // enumerates every permanent with at least one counter plus every
      // player with at least one player-counter; the controller picks
      // which targets to bump. `counterChoices` is keyed by `c:<id>` for
      // cards and `p:<seat>` for players. When a target carries multiple
      // counter kinds, the controller chooses which kind to add; for
      // single-kind targets the engine falls back to the sole kind if
      // the entry is omitted.
      readonly kind: "chooseProliferateTargets";
      readonly playerSeat: PlayerSeat;
      readonly eligibleCards: readonly EntityId[];
      readonly eligiblePlayers: readonly PlayerSeat[];
    }
  | {
      // SP2 Milestone W Task 72 — CR 702.139 companion declaration at
      // game start. The player may name a companion PaperCard from their
      // sideboard; SP2 scope records the choice but defers companion-
      // condition validation (that's SP6 format enforcement).
      readonly kind: "companionDeclaration";
      readonly playerSeat: PlayerSeat;
      readonly sideboardCardIds: readonly EntityId[];
    }
  | {
      // SP2 Task 62 (CR 701.52 / The Ring tempts you) — each temptation the
      // tempted player chooses a creature they control to become (or remain)
      // their Ring-bearer. `candidateIds` enumerates every creature on the
      // battlefield the player controls; `currentBearer` is the prior
      // bearer (or null if none). A response with `bearerId: null` means
      // "keep the current bearer if still valid"; a concrete id MUST be in
      // `candidateIds`. The engine validates at response time and throws
      // IllegalDecisionError on a bad pick.
      readonly kind: "chooseRingBearer";
      readonly playerSeat: PlayerSeat;
      readonly candidateIds: readonly EntityId[];
      readonly currentBearer: EntityId | null;
    }
  | {
      // Wave 4 — ChooseTypeEffect (CR 205.3) asks the controller to name a
      // card type or subtype. `typeKind` is a hint for UI rendering ("Creature"
      // means pick a creature subtype; "Artifact" means any permanent type).
      // The response carries the chosen type name as a free-form string; the
      // engine stores it on card.chosenTypes without validating against an
      // exhaustive list (that belongs in format enforcement, not the engine).
      readonly kind: "chooseType";
      readonly sourceId: EntityId;
      readonly typeKind: string;
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
  | { readonly kind: "chooseAltCost"; readonly altCostId: string }
  // === Post-audit Forge parity responses ===
  | { readonly kind: "chooseNumber"; readonly chosen: number }
  | { readonly kind: "chooseColor"; readonly color: Color | null }
  | { readonly kind: "chooseColors"; readonly colors: ColorSet }
  | { readonly kind: "chooseCounterType"; readonly counterTypes: readonly string[] }
  | { readonly kind: "chooseCardsPile"; readonly chosen: "a" | "b" }
  | { readonly kind: "vote"; readonly voteId: string }
  | { readonly kind: "confirmAction"; readonly confirmed: boolean }
  | { readonly kind: "confirmReplacement"; readonly applied: boolean }
  | { readonly kind: "confirmTrigger"; readonly use: boolean }
  | { readonly kind: "chooseStartingPlayer"; readonly goFirst: boolean }
  | { readonly kind: "chooseOptionalCosts"; readonly chosenIds: readonly string[] }
  | { readonly kind: "chooseKeywordForPump"; readonly keyword: string }
  | {
      readonly kind: "chooseProtectionType";
      readonly protection: "color" | "type" | "player";
      readonly value: string;
    }
  | { readonly kind: "chooseRollToModify"; readonly apply: boolean }
  | { readonly kind: "chooseRollToReroll"; readonly reroll: boolean }
  | { readonly kind: "chooseRollToIgnore"; readonly ignoredRollIds: readonly string[] }
  | {
      readonly kind: "chooseRollToSwap";
      readonly swap: readonly [string, string] | null;
    }
  | { readonly kind: "chooseSector"; readonly sectorId: string }
  | { readonly kind: "chooseSprocket"; readonly sprocket: number }
  | {
      readonly kind: "chooseContraptionsToCrank";
      readonly chosen: readonly EntityId[];
    }
  | {
      readonly kind: "mulliganBottom";
      readonly bottomed: readonly EntityId[];
    }
  | { readonly kind: "chooseLegendKeeper"; readonly keeperId: EntityId }
  | { readonly kind: "chooseFace"; readonly face: string }
  | {
      readonly kind: "chooseCastTargets";
      readonly targets: readonly unknown[];
      readonly divisions?: Readonly<Record<number, number>>;
    }
  | { readonly kind: "activateManaAbilities"; readonly done: true }
  | { readonly kind: "chooseRingBearer"; readonly bearerId: EntityId | null }
  | {
      // Wave 4 — response for chooseType request.
      readonly kind: "chooseType";
      readonly type: string;
    }
  | {
      readonly kind: "chooseProliferateTargets";
      readonly chosenCards: readonly EntityId[];
      readonly chosenPlayers: readonly PlayerSeat[];
      // WHY: Record keyed by `c:<entityId>` / `p:<seat>` — a plain Record
      // avoids a nested union and keeps the response JSON-friendly.
      readonly counterChoices: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: "companionDeclaration";
      // null = decline; a concrete id must be in request.sideboardCardIds.
      readonly companionId: EntityId | null;
    };

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
