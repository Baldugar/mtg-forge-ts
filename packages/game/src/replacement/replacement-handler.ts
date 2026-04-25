// SPDX-License-Identifier: GPL-3.0-or-later
// ReplacementHandler — abstract base that transforms a parsed ReplacementAst
// node into a live ReplacementAbility instance. Concrete subclasses handle
// specific eventKind strings (Moved, DamageDone, Draw, etc.); they register
// themselves with replacementHandlerRegistry at module load time.
//
// Analogous to TriggerHandler in the trigger framework (SP3 Part E): each
// concrete handler owns one `eventKind` string and knows how to wire the AST
// params into the runtime matches() / apply() closures.
import type { EntityId, PlayerSeat, ReplacementAbility, ReplacementAst } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";

/**
 * Context supplied to ReplacementHandler.build() when constructing a live
 * ReplacementAbility from an AST node. Carries the card and player identities
 * needed to wire the matches()/apply() closures.
 */
export interface ReplacementBuildContext {
  readonly game: Game;
  readonly sourceCardId: EntityId;
  readonly controllerSeat: PlayerSeat;
  readonly replacementId: EntityId;
}

/**
 * Abstract base for all replacement eventKind handlers.
 *
 * Subclass pattern:
 * ```ts
 * export class MovedReplacement extends ReplacementHandler {
 *   static override readonly eventKind = "Moved";
 *   override build(ast, ctx): ReplacementAbility { ... }
 * }
 * replacementHandlerRegistry.register(MovedReplacement);
 * ```
 */
export abstract class ReplacementHandler {
  /** Forge replacement eventKind string — must be set on every concrete subclass. */
  static readonly eventKind: string = "";

  /** Build a live ReplacementAbility from the parsed AST + construction context. */
  abstract build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility;
}
