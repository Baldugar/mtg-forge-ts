// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 6 — StaticHandler framework. Mirrors trigger/replacement/keyword
// handler frameworks: each concrete handler owns one StaticAbilityMode and
// converts a parsed StaticAst node into a live StaticAbility ready for
// registration with staticEffectRegistry.
//
// Note: packages/game/src/statics/ (plural) holds the SP2 runtime registry
// (StaticEffectRegistry, zone-activation, layer-contributors). This new
// directory (singular static/) hosts the AST → StaticAbility construction
// layer, paralleling the trigger/ ↔ triggers/ split.
import type { EntityId, PlayerSeat, StaticAbility, StaticAbilityMode, StaticAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";

// Map lowercase Forge zone tokens (parseStaticLine emits them) to the
// PascalCase ZoneType enum members the runtime registry uses. Returns
// undefined for unknown tokens; callers should drop those silently.
const ZONE_BY_LOWER: ReadonlyMap<string, ZoneType> = new Map(
  Object.values(ZoneType).map((z) => [z.toLowerCase(), z]),
);

// All "real" Forge zones a card can occupy; used when EffectZone$ All
// expands. Excludes ZoneType.None (the synthetic origin used for
// pre-creation transitions).
const ALL_ZONES: readonly ZoneType[] = Object.values(ZoneType).filter((z) => z !== ZoneType.None);

/**
 * Normalize the activeInZones list emitted by parseStaticLine (lowercase
 * Forge tokens, e.g. "battlefield" / "graveyard") into the PascalCase
 * ZoneType set the runtime registry expects (e.g. ZoneType.Battlefield).
 * Falls back to {Battlefield} when the input is empty.
 *
 * Wave 12 — the special token "all" (from `EffectZone$ All`) expands to
 * every real zone, so static abilities like Yavimaya Sojourner's Domain
 * cost-reducer apply when the source is in any zone.
 */
export const normalizeActiveInZones = (raw: readonly ZoneType[]): ReadonlySet<ZoneType> => {
  if (raw.length === 0) return new Set<ZoneType>([ZoneType.Battlefield]);
  const out = new Set<ZoneType>();
  for (const z of raw) {
    const candidate = (z as string).toLowerCase();
    if (candidate === "all") {
      for (const real of ALL_ZONES) out.add(real);
      continue;
    }
    const normalized = ZONE_BY_LOWER.get(candidate);
    if (normalized !== undefined) out.add(normalized);
  }
  return out.size > 0 ? out : new Set<ZoneType>([ZoneType.Battlefield]);
};

export interface StaticHandlerCtx {
  readonly game: Game;
  readonly sourceCardId: EntityId;
  readonly controllerSeat: PlayerSeat;
  readonly staticId: EntityId;
}

/**
 * Abstract base for all static-mode handlers.
 *
 * Subclass pattern:
 * ```ts
 * export class ReduceCostHandler extends StaticHandler {
 *   static override readonly mode = "ReduceCost" as const;
 *   override build(ast, ctx): StaticAbility { ... }
 * }
 * staticHandlerRegistry.register(ReduceCostHandler);
 * ```
 */
export abstract class StaticHandler {
  /** Forge static-ability mode enum value — must be set on every concrete subclass. */
  static readonly mode: StaticAbilityMode;
  abstract build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility;
}

/** Constructor interface for StaticHandler subclasses. */
export type StaticHandlerCtor = (new () => StaticHandler) & { readonly mode: StaticAbilityMode };

class StaticHandlerRegistry {
  private readonly byMode = new Map<StaticAbilityMode, StaticHandlerCtor>();

  /** Register a concrete StaticHandler subclass. */
  register(cls: StaticHandlerCtor): void {
    if (!cls.mode) throw new Error("StaticHandlerRegistry.register: mode must be non-empty");
    this.byMode.set(cls.mode, cls);
  }

  /** Look up a handler constructor by mode. Returns undefined if not registered. */
  lookup(mode: StaticAbilityMode): StaticHandlerCtor | undefined {
    return this.byMode.get(mode);
  }

  /** Returns true if the given mode has a registered handler. */
  has(mode: StaticAbilityMode): boolean {
    return this.byMode.has(mode);
  }

  /** Number of registered handlers (test helper). */
  size(): number {
    return this.byMode.size;
  }

  /** Test-only: clear all registrations so tests can start fresh. */
  clear(): void {
    this.byMode.clear();
  }
}

export const staticHandlerRegistry = new StaticHandlerRegistry();
