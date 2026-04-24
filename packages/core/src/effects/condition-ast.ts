// SPDX-License-Identifier: GPL-3.0-or-later
// Minimal condition AST used by "as long as" continuous-effect durations
// (CR 611.2). SP2 Milestone H Task 33 ships the placeholder ("always"); Task 34
// expands this union with richer state-query predicates (cardHasType,
// cardInZone, cardTapped, playerHasLife, and boolean composition via
// and/or/not). The evaluator lives in @mtg-forge-ts/game because it needs
// Game-level access (characteristics, card state, players).
//
// Why in core and not game: the AST itself is data-shaped, used as a field
// inside EffectDuration.asLongAs which ships on ContinuousEffect — keeping
// it in core avoids a circular dependency when that duration is snapshotted
// or referenced across packages.
export type ConditionAst = { readonly kind: "always" };
