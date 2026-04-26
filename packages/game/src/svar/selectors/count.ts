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
//
// Compound-arg dispatch (Wave 42):
// Forge writes many `Count$<head><sep><tail>` forms where `<head>` selects
// the family (Devotion, Valid, CastTotalManaSpent…) and `<tail>` is a
// per-family qualifier (color, filter, mana subtype). The args[0].raw the
// parser hands us is the WHOLE post-`$` string, e.g. "Devotion.Black" or
// "Valid Creature.YouCtrl". We dispatch by:
//   1. Exact match on the full arg (lets simple args like "Domain" or
//      "Mountains" register without splitting).
//   2. Split on the first ' ' or '.' and look up the head.
// The selector's handler can re-read the raw arg (and the tail it cares
// about) from `ast.args[0].raw`. This keeps the registry flat (no
// per-color sub-registries) while still routing every Forge form.
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

/**
 * Split off the family head from a compound `Count$` arg. The head is the
 * substring up to (but not including) the FIRST `.` or space. For args
 * with no separator the whole arg is returned. The dispatcher tries the
 * full arg first so flat names (Domain, Mountains, YourLifeTotal) keep
 * working without any change.
 */
const splitArgHead = (arg: string): string => {
  let i = 0;
  for (; i < arg.length; i++) {
    const ch = arg.charCodeAt(i);
    // 0x2E = '.', 0x20 = ' '
    if (ch === 0x2e || ch === 0x20) break;
  }
  return arg.slice(0, i);
};

selectorRegistry.register("Count", (ast, ctx) => {
  const arg = ast.args?.[0]?.raw ?? "";
  if (arg === "xPaid") return ctx.xValue ?? 0;
  const n = Number(arg);
  if (!Number.isNaN(n)) return n;
  const fn = countArgRegistry.lookup(arg);
  if (fn) return fn(ast, ctx);
  // Wave 42 — compound-arg fallback. Dispatch by family head so handlers
  // registered as "Devotion" / "Valid" / "ValidGraveyard" / etc. catch
  // qualifier-bearing forms without each color/zone needing its own entry.
  const head = splitArgHead(arg);
  if (head !== "" && head !== arg) {
    const headFn = countArgRegistry.lookup(head);
    if (headFn) return headFn(ast, ctx);
  }
  throw new Error(`Count$ selector: unsupported arg '${arg}'`);
});
