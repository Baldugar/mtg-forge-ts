// SPDX-License-Identifier: GPL-3.0-or-later
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
