// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.C — MaxLevel static handler. Class enchantment level cap
// (CR 716). Examples:
//
//   S:Mode$ MaxLevel | ValidCard$ Card.Self | MaxLevel$ 3
//
// What it does: a Class card with `MaxLevel$ 3` (typical) caps
// `card.classLevel` at 3. The level-up activated SA refuses to fire
// when `card.classLevel >= card.classMaxLevel`.
//
// Implementation strategy: the static stamps `card.classMaxLevel = N`
// directly on its source card on activate (the typical `Card.Self`
// shape). On deactivate, the slot is reset to undefined. The Class
// keyword's synthesized level-up SA reads the slot at activate-time
// and rejects when the cap is reached.
//
// Routing: cantMustMay category, but the gate is a slot-stamp rather
// than a generic Restriction — the level-up activator path consults
// the slot, not the gatherRestrictions sweep. The category routing
// keeps the registry hookup uniform with the rest of the Wave 60
// pack; the slot indirection mirrors the buybackPaid / awakenAmount
// pattern (Card-level scratch slots that handlers stamp directly).
//
// MVP scope: ValidCard$ Card.Self (the typical Class shape) is fully
// supported. A non-Self filter is treated by stamping every matching
// card's slot at activate time — but the Wave 60 MVP iterates only
// the source card on activate (the static's source by definition
// passes Card.Self; for non-Self the registry would need a card-set
// scan at activate time). Non-Self ValidCard$ shapes are //
// TODO(advanced) — the only published Forge usage stamps the Class
// itself.
//
// Note: Forge uses MaxLevel both for Level Up creatures (CR 702.83)
// and Class enchantments (CR 716). The Level Up creatures sub-case
// is // TODO(advanced) — Wave 52 only wired the Class keyword. When
// Level Up creatures land, the same slot can be reused (or a sibling
// `levelUpMaxLevel` slot added) — the gate logic is identical.
import type { ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { literalRaw } from "./restriction-helpers.js";

export interface MaxLevelPayload {
  readonly kind: "maxLevel";
  readonly maxLevel: number;
}

const parseIntDefault = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw.length === 0) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
};

const stampMaxLevel = (game: Game, sourceCardId: number, maxLevel: number): void => {
  // Direct slot stamp on the static's source card. Mirrors Card.Self
  // (the typical Forge shape for MaxLevel — the Class itself names its
  // own cap). For non-Self filters (TODO(advanced)) we'd scan
  // game.cards here.
  const card = game.cards.get(sourceCardId as never);
  if (!card) return;
  card.classMaxLevel = maxLevel;
};

const clearMaxLevel = (game: Game, sourceCardId: number): void => {
  const card = game.cards.get(sourceCardId as never);
  if (!card) return;
  card.classMaxLevel = undefined;
};

export class MaxLevelStaticHandler extends StaticHandler {
  static override readonly mode = "MaxLevel" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const maxLevel = parseIntDefault(literalRaw(params.MaxLevel), 0);

    // Stamp the slot at build-time. The build is invoked when the static
    // becomes active (zone-activation in StaticEffectRegistry) and the
    // payload-stamping is the durable contract: the Class level-up SA
    // reads `card.classMaxLevel` at activate-time. The describe() return
    // is informational (mirrors the slot value).
    stampMaxLevel(ctx.game, ctx.sourceCardId as unknown as number, maxLevel);

    const payload: MaxLevelPayload = {
      kind: "maxLevel",
      maxLevel,
    };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      category: "cantMustMay",
      mode: "MaxLevel",
      describe: () => payload,
    };
  }
}

// Exported so a future deactivate hook in StaticEffectRegistry can
// invoke it directly. Today the registry doesn't fire a per-handler
// deactivate, but the slot lifetime mirrors the static's lifetime
// (re-stamped on re-activate, cleared on deactivate via the same
// mechanism the Wave 60.A handlers use — the registry walk stops
// returning the entry, and the consumer sees no payload).
//
// The cleanup path: when the static leaves play, calling sites that
// read `card.classMaxLevel` should also verify there's still an
// active MaxLevel entry in `game.staticEffectRegistry.byMode("MaxLevel")`
// matching the source. The Class level-up gate (in class-keyword.ts)
// re-checks via maxLevelOf() — see wave60-cast-gates.ts.
export const _clearMaxLevelSlot = clearMaxLevel;

staticHandlerRegistry.register(MaxLevelStaticHandler);
