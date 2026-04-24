// SPDX-License-Identifier: GPL-3.0-or-later
import type { SVarExpressionAst } from "@mtg-forge-ts/core";
import type { SvarContext } from "./context.js";

export type SelectorFn = (ast: SVarExpressionAst, ctx: SvarContext) => number;

class SelectorRegistry {
  private readonly byKind = new Map<string, SelectorFn>();

  register(kind: string, fn: SelectorFn): void {
    this.byKind.set(kind, fn);
  }

  lookup(kind: string): SelectorFn | undefined {
    return this.byKind.get(kind);
  }
}

export const selectorRegistry = new SelectorRegistry();
