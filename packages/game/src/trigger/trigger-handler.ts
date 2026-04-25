// SPDX-License-Identifier: GPL-3.0-or-later
// TriggerHandler — abstract base that transforms a parsed TriggerAst node
// into a live TriggeredAbility instance. Concrete subclasses handle specific
// trigger modes (ChangesZone, Phase, Dies, etc.); they register themselves
// with triggerHandlerRegistry at module load time.
//
// Analogous to SpellAbilityEffect for the effect pipeline: each concrete
// handler owns one `mode` string and knows how to wire the AST params into
// the runtime matches() predicate.
import type { TriggerAst, TriggeredAbility } from "@mtg-forge-ts/core";
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";

/**
 * Context supplied to TriggerHandler.build() when constructing a live
 * TriggeredAbility from an AST node. Carries the card and player identities
 * needed to wire the `matches()` closure.
 */
export interface TriggerBuildContext {
  readonly game: Game;
  readonly sourceCardId: EntityId;
  readonly controllerSeat: PlayerSeat;
  readonly triggerId: EntityId;
}

/**
 * Abstract base for all trigger mode handlers.
 *
 * Subclass pattern:
 * ```ts
 * export class ChangesZoneTrigger extends TriggerHandler {
 *   static override readonly mode = "ChangesZone";
 *   override build(ast, ctx): TriggeredAbility { ... }
 * }
 * triggerHandlerRegistry.register(ChangesZoneTrigger);
 * ```
 */
export abstract class TriggerHandler {
  /** Forge trigger mode string — must be set on every concrete subclass. */
  static readonly mode: string = "";

  /** Build a live TriggeredAbility from the parsed AST + construction context. */
  abstract build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility;
}
