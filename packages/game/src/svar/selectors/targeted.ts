// SPDX-License-Identifier: GPL-3.0-or-later
import { selectorRegistry } from "../selector-registry.js";

selectorRegistry.register("Targeted", (ast, ctx) => {
  const idx = Number(ast.args?.[0]?.raw ?? "0");
  if (Number.isNaN(idx) || idx < 0) {
    throw new Error(`Targeted$ selector: invalid index '${ast.args?.[0]?.raw}'`);
  }
  if (!ctx.targets || idx >= ctx.targets.length) {
    throw new Error(`Targeted$ selector: no target at index ${idx}`);
  }
  return ctx.targets[idx] as unknown as number;
});
