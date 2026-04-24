// SPDX-License-Identifier: GPL-3.0-or-later
// ContinuousEffect — time-limited layered effect (CR 611). Created when a
// resolving spell or ability applies a continuous modification to game
// state ("target creature gets +2/+0 until end of turn", "creatures you
// control have flying until end of your next turn", emblems, etc.).
//
// SP2 Milestone H (Task 33) replaces SP1's opaque placeholder with the
// fine-grained shape the ContinuousEffectRegistry + duration evaluator
// consume. The payload remains an opaque `unknown` because the per-layer
// effect shapes (Layer7cEffect, TypeChangeEffect, …) live in the game
// package — keeping them out of core preserves the core→game layering.
//
// Snapshot compat: Game.continuousEffects still exposes this type as the
// array element (GameSnapshot.state.continuousEffects). The v5 schema
// reserved the slot; swapping the record shape from {sourceId, layer:number,
// sublayer, kind:string, payload} to {sourceCardId, layer:Layer enum,
// timestamp, duration, payload} is an in-SP2 change observable on restore.
// Milestone X will bump schemaVersion to 6 once the full SP2 write-path
// lands; for SP2 Milestone H round-trip tests use the new shape directly.
//
// Field-by-field rationale:
//   id — engine-assigned unique id so unregister() + dependency tracking
//     can reference it.
//   sourceCardId — permanent / emblem / spell that produced this effect.
//     Null for engine-minted effects (start-of-game emblems, test fixtures).
//   timestamp — creation ordinal used by the layer engine for same-layer
//     ordering (CR 613.7a). Lowest first.
//   layer — fine-grained Layer enum value (Layer.L7c_PTModify, Layer.L4_Type,
//     …) routed by the registry into the matching LayerEngine array.
//   duration — discriminated union consumed by duration-evaluator.ts (SP2
//     Task 33) to decide expiry on each phase/turn/step/zone-change event.
//   payload — layer-specific effect record (Layer7cEffect etc.); `unknown`
//     in core because those shapes are game-package internals. The registry
//     narrows per-kind at register time.
import type { EntityId, PlayerSeat } from "../ids.js";
import type { PhaseStep } from "../phase.js";
import type { ConditionAst } from "./condition-ast.js";
import type { Layer } from "./layer.js";

export type EffectDuration =
  // CR 514.3 — cleanup step of the current turn wipes these.
  | { readonly kind: "untilEndOfTurn" }
  // CR 611 — delayed "until end of your next turn" from planeswalker +1s
  // etc. `forSeat` identifies whose next turn triggers expiry;
  // `registeredAtTurn` lets the evaluator tell "forSeat's CURRENT turn's
  // end" (no-op) from "forSeat's NEXT turn's end" (expire).
  | {
      readonly kind: "untilEndOfYourNextTurn";
      readonly forSeat: PlayerSeat;
      readonly registeredAtTurn: number;
    }
  // CR 611.2 — "until X leaves the battlefield" (Oblivion Ring-style).
  | { readonly kind: "untilXLeavesBattlefield"; readonly xId: EntityId }
  // CR 611.2 — state-dependent effects that persist as long as a condition
  // holds. Re-checked on every epoch bump via registry.checkEpoch().
  | { readonly kind: "asLongAs"; readonly condition: ConditionAst }
  // Emblems + intrinsic statics minted as effects. Never expires.
  | { readonly kind: "permanent" }
  // CR 611 — "until end of combat". Expires on CombatEnded event.
  | { readonly kind: "untilCombatEnds" }
  // CR 611 — "until end of next [step]" (e.g., "until end of next upkeep").
  // `step` identifies which step's PhaseStepEnded triggers expiry.
  | { readonly kind: "untilEndOfNextStep"; readonly step: PhaseStep };

export interface ContinuousEffect {
  /** Engine-assigned unique id so dependencies / removal can reference it. */
  readonly id: EntityId;
  /** Source permanent / emblem / spell generating the effect; null for
   *  engine-minted effects (no card origin). */
  readonly sourceCardId: EntityId | null;
  /** Creation-time ordinal for same-layer ordering (CR 613.7a, lowest first). */
  readonly timestamp: number;
  /** CR 613 layer (fine-grained enum, including Layer 7a-e sub-ordering). */
  readonly layer: Layer;
  /** Expiry policy — evaluated by duration-evaluator.ts on boundary events
   *  and epoch bumps. */
  readonly duration: EffectDuration;
  /** Layer-specific payload (Layer7cEffect, TypeChangeEffect, …). The
   *  registry narrows per-kind at register time; held as `unknown` here so
   *  core stays independent of game-package effect shapes. */
  readonly payload: unknown;
}
