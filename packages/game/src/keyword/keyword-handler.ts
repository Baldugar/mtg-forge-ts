// SPDX-License-Identifier: GPL-3.0-or-later
// KeywordHandler — abstract base that applies a parsed KeywordAst node to the
// game state. Concrete subclasses handle specific keyword shapes (flag, static-
// restriction, triggered, activated, etc.); they register themselves with
// keywordHandlerRegistry at module load time.
//
// Shape 1 (flag keywords) is the only shape implemented in Wave 1. Shapes 2-7
// are deferred to G2+ once the trigger / activated-ability / replacement
// frameworks are mature enough to back them.
import type { EntityId, KeywordAst, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";

/**
 * Context supplied to KeywordHandler.activate() / deactivate() when applying
 * a keyword to the live game state. Carries the card and player identities
 * needed to locate the target card and wire any runtime state.
 */
export interface KeywordActivationContext {
  readonly game: Game;
  readonly sourceCardId: EntityId;
  readonly controllerSeat: PlayerSeat;
}

/**
 * Abstract base for all keyword shape handlers.
 *
 * Subclass pattern:
 * ```ts
 * export class FlagKeywordHandler extends KeywordHandler {
 *   static override readonly keyword = "*" as const;
 *   override activate(ast: KeywordAst, ctx: KeywordActivationContext): void { ... }
 * }
 * keywordHandlerRegistry.register(FlagKeywordHandler);
 * ```
 *
 * The special sentinel `"*"` marks a fallback (catchall) handler that matches
 * any keyword not explicitly registered. Only one fallback may be active at a
 * time; later registrations overwrite earlier ones.
 */
export abstract class KeywordHandler {
  /**
   * The KeywordId this handler responds to, or `"*"` for catchall.
   * Every concrete subclass MUST override this with a non-empty value.
   */
  static readonly keyword: string = "";

  /** Apply the keyword's effects to the source card / game state. */
  abstract activate(ast: KeywordAst, ctx: KeywordActivationContext): void;

  /**
   * Optional: undo activation (when the card leaves the zone or the keyword
   * is removed by a layer effect). Default is a no-op; override when the
   * keyword installs runtime state that must be cleaned up.
   */
  deactivate?(ast: KeywordAst, ctx: KeywordActivationContext): void;
}
