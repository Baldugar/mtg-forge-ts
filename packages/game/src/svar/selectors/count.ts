// SPDX-License-Identifier: GPL-3.0-or-later
import { selectorRegistry } from "../selector-registry.js";

selectorRegistry.register("Count", (ast, ctx) => {
  const arg = ast.args?.[0]?.raw ?? "";
  if (arg === "xPaid") return ctx.xValue ?? 0;
  const n = Number(arg);
  if (!Number.isNaN(n)) return n;
  throw new Error(`Count$ selector: unsupported arg '${arg}' — deferred to Part B2 (Valid grammar)`);
});
