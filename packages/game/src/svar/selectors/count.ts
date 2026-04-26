// SPDX-License-Identifier: GPL-3.0-or-later
// Count$ selector — top-level dispatcher for the many Forge `Count$<arg>`
// forms. Arg-specific behaviors register themselves into a sub-registry
// (countArgRegistry) so this file stays a thin dispatcher and per-arg
// logic lives next to the selector that conceptually owns it.
//
// Built-in args:
//   - xPaid   → ctx.xValue (the X value paid for an X-cost spell)
//   - <int>   → the literal number (Count$3 = 3)
// Plus anything registered via countArgRegistry.register(...).
import type { SVarExpressionAst } from "@mtg-forge-ts/core";
import type { SvarContext } from "../context.js";
import { selectorRegistry } from "../selector-registry.js";

export type CountArgFn = (ast: SVarExpressionAst, ctx: SvarContext) => number;

class CountArgRegistry {
  private readonly byArg = new Map<string, CountArgFn>();
  register(arg: string, fn: CountArgFn): void {
    this.byArg.set(arg, fn);
  }
  lookup(arg: string): CountArgFn | undefined {
    return this.byArg.get(arg);
  }
}

export const countArgRegistry = new CountArgRegistry();

selectorRegistry.register("Count", (ast, ctx) => {
  const arg = ast.args?.[0]?.raw ?? "";
  if (arg === "xPaid") return ctx.xValue ?? 0;
  const n = Number(arg);
  if (!Number.isNaN(n)) return n;
  const fn = countArgRegistry.lookup(arg);
  if (fn) return fn(ast, ctx);
  throw new Error(`Count$ selector: unsupported arg '${arg}' — deferred to Part B2 (Valid grammar)`);
});
