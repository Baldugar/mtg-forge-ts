// SPDX-License-Identifier: GPL-3.0-or-later
// SumPower / SumToughness / SumCMC selectors — aggregate a numeric field
// over all battlefield permanents matching an optional ValidCards$ filter.
//
// Filter syntax (arg[0].raw): "Creature", "Creature.YouCtrl",
// "Creature.OpponentCtrl", "Permanent", "Artifact", etc.
// Absent arg → sum over ALL battlefield permanents.
//
// CR 208.2 — '*' / 'X' / '1+*' P/T values have no fixed number at base-
// characteristics level and are treated as 0 for SumPower / SumToughness.
import { CardType, ZoneType } from "@mtg-forge-ts/core";
import type { SVarExpressionAst } from "@mtg-forge-ts/core";
import type { SvarContext } from "../context.js";
import { selectorRegistry } from "../selector-registry.js";

interface Filter {
  /** Lowercase card type token, or "permanent" for any permanent. */
  readonly cardType: string;
  /** Controller constraint: "youctrl" | "opponentctrl" | "" (any). */
  readonly ctrl: string;
}

const parseFilter = (raw: string): Filter => {
  if (!raw) return { cardType: "", ctrl: "" };
  const parts = raw.toLowerCase().split(".");
  const cardType = parts[0] ?? "";
  const ctrl = parts[1] ?? "";
  return { cardType, ctrl };
};

/** Map lowercase type token → CardType enum, or null for "permanent" / unknown. */
const TYPE_MAP: ReadonlyMap<string, CardType> = new Map<string, CardType>([
  ["creature", CardType.Creature],
  ["artifact", CardType.Artifact],
  ["enchantment", CardType.Enchantment],
  ["land", CardType.Land],
  ["planeswalker", CardType.Planeswalker],
  ["battle", CardType.Battle],
  ["instant", CardType.Instant],
  ["sorcery", CardType.Sorcery],
]);

const sumOver = (ast: SVarExpressionAst, ctx: SvarContext, field: "power" | "toughness" | "cmc"): number => {
  const rawArg = ast.args?.[0]?.raw ?? "";
  const filter = parseFilter(rawArg);

  let sum = 0;
  for (const [id, card] of ctx.game.cards) {
    // Sum* selectors operate on the battlefield only (CR 700.3).
    if (card.zone !== ZoneType.Battlefield) continue;

    // Controller filter.
    if (filter.ctrl === "youctrl" && card.controllerSeat !== ctx.controller) continue;
    if (filter.ctrl === "opponentctrl" && card.controllerSeat === ctx.controller) continue;

    // Type filter.
    if (filter.cardType && filter.cardType !== "permanent") {
      const needed = TYPE_MAP.get(filter.cardType);
      if (needed !== undefined) {
        const chars = ctx.game.layerEngine.computeCharacteristics(id);
        if (!chars.types.has(needed)) continue;
      }
      // Unknown type token → skip card (conservative: no match).
    }

    // Compute the requested field.
    const chars = ctx.game.layerEngine.computeCharacteristics(id);
    let v: number;
    if (field === "cmc") {
      v = chars.manaCost.cmc();
    } else {
      const raw = field === "power" ? chars.power : chars.toughness;
      // CR 208.2 — null (from '*' / 'X' / '1+*') treated as 0.
      v = typeof raw === "number" ? raw : 0;
    }
    sum += v;
  }
  return sum;
};

selectorRegistry.register("SumPower", (ast: SVarExpressionAst, ctx: SvarContext) =>
  sumOver(ast, ctx, "power"),
);

selectorRegistry.register("SumToughness", (ast: SVarExpressionAst, ctx: SvarContext) =>
  sumOver(ast, ctx, "toughness"),
);

selectorRegistry.register("SumCMC", (ast: SVarExpressionAst, ctx: SvarContext) => sumOver(ast, ctx, "cmc"));
