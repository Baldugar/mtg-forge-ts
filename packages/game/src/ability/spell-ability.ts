// SPDX-License-Identifier: GPL-3.0-or-later
// SpellAbility — runtime binding of a parsed AbilityAst to a specific source
// card, controller, targets, and optional X value. This is the abstraction the
// CastPipeline creates and the effect registry resolves against.
import type { AbilityAst, EntityId, PlayerSeat, SVarAst } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { StackItemResolver } from "../stack/stack-item.js";
import { effectRegistry } from "./effect-registry.js";

export class SpellAbility {
  constructor(
    public readonly ast: AbilityAst,
    public readonly sourceCardId: EntityId,
    public readonly controllerSeat: PlayerSeat,
    public readonly svars: ReadonlyMap<string, SVarAst>,
    public targets: readonly EntityId[] = [],
    public xValue?: number,
  ) {}

  get handlerKey(): string {
    return this.ast.effect.handlerKey;
  }

  makeResolver(): StackItemResolver {
    const sa = this;
    return {
      *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
        const game = gameUnknown as Game;
        const cls = effectRegistry.lookup(sa.handlerKey);
        if (!cls) {
          throw new Error(`SpellAbility.resolve: no registered effect for '${sa.handlerKey}'`);
        }
        const effect = new cls();
        yield* effect.resolve(sa, game);
      },
    };
  }
}
