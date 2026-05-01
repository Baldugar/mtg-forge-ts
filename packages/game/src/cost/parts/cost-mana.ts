// SPDX-License-Identifier: GPL-3.0-or-later
// CostMana — payment of a mana cost (e.g. "R", "2 G", "X"). M5 implements
// the real color-aware solver. If the cost has variable (X) pips, the payer
// is prompted with a "chooseX" decision before payment proceeds.
//
// canPay: delegates to solveManaPayment with xValue=0 (conservative check —
//         X costs can always be paid for X=0).
// pay:    if cost has X pips, yields chooseX decision to get the bound value;
//         then solves and applies the plan.
// undo:   restores pool snapshot + refunds phyrexian life.
import { CardType, ManaCost, mkEvent } from "@mtg-forge-ts/core";
import type { Color, ManaProduced } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { ManaPool } from "../../mana/mana-pool.js";
import { applyCostMods } from "../../mana/solver/apply-cost-mods.js";
import { applyPaymentPlan } from "../../mana/solver/apply-plan.js";
import { chooseX, computeMaxX } from "../../mana/solver/choose-x.js";
import { solveManaPayment } from "../../mana/solver/solver.js";
import { gatherCostModsFor } from "../../statics/cost-mod-contributor.js";
import { costPartRegistry } from "./cost-part-registry.js";
import type { CostPart, CostPartReceipt, CostPaymentContext } from "./cost-part.js";

function getPool(ctx: CostPaymentContext): ManaPool {
  const player = ctx.game.getPlayer(ctx.payerSeat);
  // Player.manaPool is typed `unknown` in SP1 for forward compat; SP3
  // starts populating it with real ManaPool instances. Cast here is safe
  // for tests that seed the pool before calling CostMana.
  return player.manaPool as ManaPool;
}

import type { SpellCostModItem } from "../../static/cost-mod-filter.js";
// Wave 6 baseline + Wave 11 completeness — fold cost-modification statics
// (Jet Medallion, Sphere of Resistance, Trinisphere, Alabaster Leech, etc.)
// into the raw mana cost before solving. The "item" we hand the filter is
// the cost-determination context: source card + controller + kind +
// sourceZone. Wave 11 threads `kind` (spell vs ability) and `sourceZone`
// through from CostPaymentContext so AffectedZone$ and Type$ filters work.
//
// Returns both the adjusted cost AND the matching mods, so the caller can
// invoke markUsed callbacks after a successful payment (OnlyFirstSpell$).
import type { CostModEffect } from "../../statics/cost-mod-contributor.js";

const buildCostModItem = (ctx: CostPaymentContext): SpellCostModItem => {
  const card = ctx.game.cards.get(ctx.sourceCardId);
  const kind = ctx.kind ?? "spell";
  const sourceZone = ctx.sourceZone ?? card?.zone;
  return {
    sourceCardId: ctx.sourceCardId,
    controllerSeat: ctx.payerSeat,
    card,
    kind,
    ...(sourceZone !== undefined ? { sourceZone } : {}),
  };
};

const adjustedCost = (
  rawCost: import("@mtg-forge-ts/core").ManaCost,
  ctx: CostPaymentContext,
): {
  cost: import("@mtg-forge-ts/core").ManaCost;
  mods: readonly CostModEffect[];
  item: SpellCostModItem;
} => {
  const item = buildCostModItem(ctx);
  const mods = gatherCostModsFor(ctx.game, item);
  const cost = applyCostMods(rawCost, mods, { item, game: ctx.game });
  return { cost, mods, item };
};

/**
 * Wave 30 — solver-side filter for `nonCreatureNonActivated` mana
 * (Powerstone). The atom is unspendable when:
 *   • ctx.kind === "spell" AND the source card is a Creature spell, OR
 *   • ctx.kind === "ability" AND the activating source is a creature.
 * Returns a closure suitable for `solveManaPayment`'s `entryFilter`.
 */
const buildEntryFilter = (ctx: CostPaymentContext): ((entry: ManaProduced) => boolean) | undefined => {
  const card = ctx.game.cards.get(ctx.sourceCardId);
  if (!card) return undefined;
  const def = card.paperCard.definition;
  const types = def?.types;
  // For spell-casts the printed type matters (the card isn't on the
  // battlefield yet so layered animation hasn't applied). For activated
  // abilities the live characteristics are read because animate-creature
  // effects are in play.
  let isCreature = false;
  if (ctx.kind === "ability") {
    const chars = ctx.game.layerEngine.computeCharacteristics(card.id);
    isCreature = chars.types.has(CardType.Creature);
  } else {
    isCreature = types?.has(CardType.Creature) === true;
  }
  if (!isCreature) return undefined;
  return (entry: ManaProduced) => entry.restriction !== "nonCreatureNonActivated";
};

interface ManaCostReceipt {
  /** Pre-payment pool snapshot (for undo). */
  prePaymentSnapshot: ManaProduced[];
  /** Life paid via phyrexian pips (for undo refund). */
  lifePaid: number;
  /** Bound X value (0 if cost had no X pips). */
  xValue: number;
}

export const CostMana: CostPart = {
  handlerKey: "Mana",

  canPay(ctx: CostPaymentContext): boolean {
    const { cost } = adjustedCost(ManaCost.parse(ctx.raw), ctx);
    const pool = getPool(ctx);
    const entryFilter = buildEntryFilter(ctx);
    // Conservative check: X=0 means we only verify non-X pips are payable.
    // A player can always choose X=0, so if non-X pips are satisfiable the
    // cost can be paid (even if X=0 is a degenerate choice for some cards).
    return (
      solveManaPayment(cost, pool, {
        xValue: 0,
        ...(entryFilter !== undefined ? { entryFilter } : {}),
      }) !== null
    );
  },

  *pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown> {
    const { cost, mods, item } = adjustedCost(ManaCost.parse(ctx.raw), ctx);
    const pool = getPool(ctx);
    const entryFilter = buildEntryFilter(ctx);

    // --- X binding ---------------------------------------------------
    let xValue = 0;
    if (cost.countX() > 0) {
      const maxBound = computeMaxX(cost, pool);
      xValue = yield* chooseX(ctx.sourceCardId, maxBound);
    }

    // Capture snapshot BEFORE applying so undo can restore the exact pre-pay state.
    const prePaymentSnapshot: ManaProduced[] = pool.snapshot();

    const plan = solveManaPayment(cost, pool, {
      xValue,
      ...(entryFilter !== undefined ? { entryFilter } : {}),
    });
    if (plan === null) {
      throw new Error(
        `CostMana.pay: insufficient mana — cannot pay "${ctx.raw}" (xValue=${xValue}) from current pool`,
      );
    }

    // Apply the plan: drain pool entries and pay life for phyrexian pips.
    yield* applyPaymentPlan(plan, pool, ctx.game, ctx.payerSeat);

    // Wave 16/17b — emit ManaSpent (one event per distinct color) so
    // ManaExpendTrigger ("whenever you spend <color> mana, …") fires.
    // The plan's `consumed` list records every drained pool entry; we
    // bucket them by color (null for colorless) and emit one event per
    // bucket carrying the bucket's count. Phyrexian-paid pips are NOT
    // mana spend (they're life payment) so they don't contribute here.
    const byColor = new Map<Color | null, number>();
    for (const c of plan.consumed) {
      const col = c.symbol.color;
      byColor.set(col, (byColor.get(col) ?? 0) + 1);
    }
    // Wave 37 — Sunburst (CR 702.43): stamp the set of chromatic colors
    // spent on the source card so SunburstKeywordHandler's ETB trigger
    // can read them. Colorless (null) is intentionally NOT added because
    // Sunburst counts colors of mana, not generic mana spend.
    const sourceCard = ctx.game.cards.get(ctx.sourceCardId);
    if (sourceCard) {
      const colorSet = sourceCard.manaSpentColors ?? new Set<Color>();
      for (const col of byColor.keys()) {
        if (col !== null) colorSet.add(col);
      }
      sourceCard.manaSpentColors = colorSet;
      // Wave 42 — Count$CastTotalManaSpent. Tally every consumed pool
      // entry (both colored and colorless atoms) onto the source card so
      // amount resolvers can read total mana spent on the cast. Phyrexian
      // pips are NOT counted as spend (CR 107.1f) — they pay life.
      const priorTotal = sourceCard.manaSpentTotal ?? 0;
      sourceCard.manaSpentTotal = priorTotal + plan.consumed.length;
      // Wave 105 — Adamant (CR 702.137a): "If at least three mana of the
      // same color was spent to cast this spell, …". The per-color bucket
      // built above already tells us how many pips of each chromatic color
      // were spent. If any chromatic bucket reached ≥3, stamp the matching
      // color into `adamantColor` so the conditions.ts evaluator
      // (`Count$Adamant`) flips to true. Multiple qualifying colors keep
      // the FIRST encountered (Forge's behavior — the printed Adamant
      // clause names a specific color so only one slot needs to be live;
      // the corpus has no card with two simultaneous Adamant clauses on
      // different colors). Colorless pips do NOT satisfy Adamant.
      for (const [col, count] of byColor) {
        if (col !== null && count >= 3) {
          sourceCard.adamantColor = col;
          break;
        }
      }
    }
    for (const [col, amount] of byColor) {
      yield ctx.game.emitEvent(
        mkEvent("ManaSpent", ctx.game.turn, ctx.game.phase, {
          playerSeat: ctx.payerSeat,
          color: col,
          amount,
        }),
      );
    }

    // Wave 11 — fire markUsed on every consumed mod (OnlyFirstSpell$ guard).
    // Marking ALL matched mods is sound: non-OnlyFirstSpell mods have no
    // markUsed callback, so this is a no-op for them.
    for (const m of mods) {
      if (m.markUsed !== undefined) m.markUsed(ctx.game, item);
    }

    const receipt: ManaCostReceipt = {
      prePaymentSnapshot,
      lifePaid: plan.lifePaid,
      xValue: plan.xValue ?? xValue,
    };

    return {
      handlerKey: "Mana",
      raw: ctx.raw,
      payload: receipt,
    };
  },

  undo(receipt: CostPartReceipt, ctx: CostPaymentContext): void {
    const { prePaymentSnapshot, lifePaid } = receipt.payload as ManaCostReceipt;
    const pool = getPool(ctx);
    pool.restore(prePaymentSnapshot);

    // Refund life paid for phyrexian pips by driving changeLife synchronously.
    if (lifePaid > 0) {
      const gen = ctx.game.action.changeLife(ctx.payerSeat, lifePaid, { cause: "phyrexianRefund" });
      let step = gen.next();
      while (!step.done) {
        step = gen.next();
      }
    }
  },
};

costPartRegistry.register(CostMana);
