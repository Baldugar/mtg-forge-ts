// SPDX-License-Identifier: GPL-3.0-or-later
import type { PlayerSeat } from "@mtg-forge-ts/core";
import { selectorRegistry } from "../selector-registry.js";

selectorRegistry.register("LifeTotal", (ast, ctx) => {
  const scope = (ast.args?.[0]?.raw ?? "You").toLowerCase();
  let seat: PlayerSeat | undefined;
  if (scope === "you" || scope === "youctrl") {
    seat = ctx.controller;
  } else if (scope === "opponent" || scope === "opponents") {
    if (ctx.controller === undefined) {
      throw new Error(`LifeTotal$ selector: no controller in context for '${scope}'`);
    }
    seat = (1 - (ctx.controller as unknown as number)) as PlayerSeat;
  } else {
    throw new Error(`LifeTotal$ selector: unsupported scope '${scope}'`);
  }
  if (seat === undefined) throw new Error("LifeTotal$ selector: no controller in context");
  return ctx.game.getPlayer(seat).life;
});
