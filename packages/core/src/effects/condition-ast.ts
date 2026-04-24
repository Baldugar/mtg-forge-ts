// SPDX-License-Identifier: GPL-3.0-or-later
// Condition AST used by "as long as" continuous-effect durations
// (CR 611.2). The evaluator lives in @mtg-forge-ts/game
// (condition-evaluator.ts) because it needs Game-level access
// (characteristics, card state, players).
//
// Why in core and not game: the AST itself is data-shaped, used as a field
// inside EffectDuration.asLongAs which ships on ContinuousEffect — keeping
// it in core avoids a circular dependency when that duration is snapshotted
// or referenced across packages.
//
// The union covers:
//   - always / never    — trivial constants for tests + degenerate effects.
//   - and / or / not    — compositional booleans. SP3 will extend with a
//                         bag-semantics "any of X" once the DSL-driven
//                         predicate library lands.
//   - card* predicates  — state queries against a specific card: has a
//                         given type (evaluated via LayerEngine so Layer 4
//                         type-changes are respected), is in a given zone,
//                         is tapped.
//   - playerHasLife     — seat's life is at least the threshold.
//
// SP2 Milestone H Task 34 ships these minimal predicates; they cover the
// "as long as you control a Creature" / "while you have 5 or more life"
// patterns that the SP2 smoke-tests and Milestone I's cast pipeline rely on.
import type { CardType } from "../card/types.js";
import type { EntityId, PlayerSeat } from "../ids.js";
import type { ZoneType } from "../zone.js";

export type ConditionAst =
  | { readonly kind: "always" }
  | { readonly kind: "never" }
  | { readonly kind: "and"; readonly left: ConditionAst; readonly right: ConditionAst }
  | { readonly kind: "or"; readonly left: ConditionAst; readonly right: ConditionAst }
  | { readonly kind: "not"; readonly inner: ConditionAst }
  | { readonly kind: "cardHasType"; readonly cardId: EntityId; readonly cardType: CardType }
  | { readonly kind: "cardInZone"; readonly cardId: EntityId; readonly zone: ZoneType }
  | { readonly kind: "cardTapped"; readonly cardId: EntityId }
  | { readonly kind: "playerHasLife"; readonly seat: PlayerSeat; readonly atLeast: number };
