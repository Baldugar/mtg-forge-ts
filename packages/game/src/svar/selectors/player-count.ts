// SPDX-License-Identifier: GPL-3.0-or-later
import type { EntityId, PlayerSeat, SVarExpressionAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Card } from "../../card.js";
import { cardMatchesFilter } from "../../trigger/card-filter.js";
import type { SvarContext } from "../context.js";
import { selectorRegistry } from "../selector-registry.js";

selectorRegistry.register("PlayerCount", (ast, ctx) => {
  const scope = (ast.args?.[0]?.raw ?? "All").toLowerCase();
  const total = ctx.game.players.length;
  switch (scope) {
    case "all":
      return total;
    case "youctrl":
    case "you":
      return 1;
    case "opponents":
    case "opponent":
      return total - 1;
    default:
      return total;
  }
});

// PlayerCountOpponents$<property> — for each opponent of ctx.controller,
// compute a per-player numeric property and aggregate. Mirrors Forge's
// `playerXCount(opponents, s, ...)` family. Currently supports:
//   - HighestValid <restrictions> — max over opponents of "Valid <r>"
//     evaluated with that opponent as the player perspective.
//   - LowestValid  <restrictions> — min over opponents.
//   - Valid        <restrictions> — sum over opponents.
// All "Valid" forms count cards on the battlefield matching `<restrictions>`
// with the per-iteration player as the YouCtrl perspective.
//
// Used by Knight of the White Orchid for `CheckSVar$ Y SVarCompare$ GTX`
// where Y = `PlayerCountOpponents$HighestValid Land.YouCtrl`.
const computePlayerCountOpponents = (ast: SVarExpressionAst, ctx: SvarContext): number => {
  const raw = (ast.args?.[0]?.raw ?? "").trim();
  if (raw === "") return 0;
  const controller = ctx.controller;
  if (controller === undefined) return 0;

  // Parse the head: "Highest" | "Lowest" | "" (sum), then "Valid <restrictions>".
  let head = "";
  let rest = raw;
  if (rest.startsWith("Highest")) {
    head = "Highest";
    rest = rest.slice("Highest".length);
  } else if (rest.startsWith("Lowest")) {
    head = "Lowest";
    rest = rest.slice("Lowest".length);
  }

  if (!rest.startsWith("Valid")) return 0;
  rest = rest.slice("Valid".length);
  // Strip leading space/dot separator.
  if (rest.length > 0 && (rest.charCodeAt(0) === 0x20 || rest.charCodeAt(0) === 0x2e)) {
    rest = rest.slice(1);
  }
  if (rest.length === 0) return 0;
  const restrictions = rest;

  const sourceCardId = ctx.sourceCardId;
  // Iterate opponents (every seat except `controller`) and compute the
  // per-opponent count via cardMatchesFilter using that opponent as the
  // controllerSeat in the filter context (so YouCtrl/OppCtrl resolve from
  // the opponent's perspective).
  const opponentCounts: number[] = [];
  for (const p of ctx.game.players) {
    if (p.seat === controller) continue;
    let n = 0;
    const filterCtx = {
      controllerSeat: p.seat as PlayerSeat,
      sourceCardId: (sourceCardId ?? (-1 as unknown as EntityId)) as EntityId,
    };
    for (const card of ctx.game.cards.values()) {
      if (card.zone !== ZoneType.Battlefield) continue;
      if (cardMatchesFilter(card as Card, restrictions, filterCtx)) n += 1;
    }
    opponentCounts.push(n);
  }

  if (opponentCounts.length === 0) return 0;
  switch (head) {
    case "Highest":
      return Math.max(...opponentCounts);
    case "Lowest":
      return Math.min(...opponentCounts);
    default: {
      let sum = 0;
      for (const v of opponentCounts) sum += v;
      return sum;
    }
  }
};

selectorRegistry.register("PlayerCountOpponents", computePlayerCountOpponents);
