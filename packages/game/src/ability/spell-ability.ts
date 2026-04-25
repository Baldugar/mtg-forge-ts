// SPDX-License-Identifier: GPL-3.0-or-later
// SpellAbility — runtime binding of a parsed AbilityAst to a specific source
// card, controller, targets, and optional X value. This is the abstraction the
// CastPipeline creates and the effect registry resolves against.
import type { AbilityAst, EntityId, PlayerSeat, SVarAst, ZoneType } from "@mtg-forge-ts/core";
import { ZoneType as ZoneTypeEnum } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { StackItemResolver } from "../stack/stack-item.js";
import { effectRegistry } from "./effect-registry.js";

/** Default zones in which a regular AB$ (battlefield) ability is active. */
const DEFAULT_ACTIVE_IN_ZONES: ReadonlySet<ZoneType> = new Set([ZoneTypeEnum.Battlefield]);

export class SpellAbility {
  /**
   * Zones from which this ability may be activated. Battlefield-activated
   * abilities (mana abilities, equip, etc.) use the default `{Battlefield}`.
   * Abilities synthesized by keyword handlers (e.g. Cycling) set this to
   * `{Hand}` so activateAbility knows they fire from a different zone.
   */
  public readonly activeInZones: ReadonlySet<ZoneType>;

  /**
   * Semantic tags applied by keyword handlers or synthesizing code to carry
   * provenance metadata through the activation pipeline. Used by
   * activateAbility to emit ability-specific events (e.g. "cycling" → emits
   * CardCycled after costs are paid).
   */
  public readonly tags: ReadonlySet<string>;

  constructor(
    public readonly ast: AbilityAst,
    public readonly sourceCardId: EntityId,
    public readonly controllerSeat: PlayerSeat,
    public readonly svars: ReadonlyMap<string, SVarAst>,
    public targets: readonly EntityId[] = [],
    public xValue?: number,
    activeInZones?: ReadonlySet<ZoneType>,
    tags?: ReadonlySet<string>,
  ) {
    this.activeInZones = activeInZones ?? DEFAULT_ACTIVE_IN_ZONES;
    this.tags = tags ?? new Set();
  }

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
