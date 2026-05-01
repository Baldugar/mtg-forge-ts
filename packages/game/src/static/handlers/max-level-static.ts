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
// Scope (Wave 100 broaden): ValidCard$ Card.Self stamps the source card's
// slot directly (the typical Class shape). Non-Self filters now scan
// `game.cards` at build time and stamp every matching card's
// `classMaxLevel` slot — the registry's per-build invocation gives the
// canonical Forge "static-time scan" semantics. The slot is read at
// level-up activation time, so the cap is enforced uniformly across all
// matched cards.
//
// Note: Forge uses MaxLevel both for Level Up creatures (CR 702.83)
// and Class enchantments (CR 716). The Level Up creatures sub-case
// is // TODO(advanced) — Wave 52 only wired the Class keyword. When
// Level Up creatures land, the same slot can be reused (or a sibling
// `levelUpMaxLevel` slot added) — the gate logic is identical.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

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
  // Direct slot stamp on the static's source card (Card.Self default
  // shape). For non-Self ValidCard$ filters, see stampMaxLevelMatching.
  const card = game.cards.get(sourceCardId as never);
  if (!card) return;
  card.classMaxLevel = maxLevel;
};

/**
 * Wave 100 — stamp `classMaxLevel = maxLevel` on EVERY card matching the
 * predicate. Used for non-Self ValidCard$ shapes (e.g. a global "all
 * Class permanents you control max out at level 2" hypothetical card).
 * Iterates `game.cards` once at build time; subsequent re-evaluations
 * happen if the registry rebuilds the static (re-activate path).
 */
const stampMaxLevelMatching = (
  game: Game,
  predicate: (id: EntityId, game: Game) => boolean,
  maxLevel: number,
): EntityId[] => {
  const stamped: EntityId[] = [];
  for (const card of game.cards.values()) {
    if (!predicate(card.id, game)) continue;
    card.classMaxLevel = maxLevel;
    stamped.push(card.id);
  }
  return stamped;
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
    const validCardRaw = literalRaw(params.ValidCard);

    // Stamp the slot at build-time. The build is invoked when the static
    // becomes active (zone-activation in StaticEffectRegistry) and the
    // payload-stamping is the durable contract: the Class level-up SA
    // reads `card.classMaxLevel` at activate-time. The describe() return
    // is informational (mirrors the slot value).
    if (validCardRaw === undefined || validCardRaw.length === 0 || validCardRaw === "Card.Self") {
      // Default + Card.Self — stamp the source card directly (the
      // canonical Forge shape; avoids an O(N) scan per build).
      stampMaxLevel(ctx.game, ctx.sourceCardId as unknown as number, maxLevel);
    } else {
      // Wave 100 — non-Self ValidCard$. Build a predicate from the
      // Wave 32 grammar and stamp every matching card's slot.
      const pred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);
      stampMaxLevelMatching(ctx.game, pred, maxLevel);
    }

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
export const _stampMaxLevelMatching = stampMaxLevelMatching;

staticHandlerRegistry.register(MaxLevelStaticHandler);
