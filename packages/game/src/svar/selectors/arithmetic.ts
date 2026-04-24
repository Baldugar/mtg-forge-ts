// SPDX-License-Identifier: GPL-3.0-or-later
import type { SVarExpressionAst } from "@mtg-forge-ts/core";
import type { SvarContext } from "../context.js";
import { selectorRegistry } from "../selector-registry.js";

const evalArg = (arg: SVarExpressionAst | undefined, ctx: SvarContext): number => {
  if (!arg) throw new Error("arithmetic: missing arg");
  if (arg.kind === "literal") {
    const n = Number(arg.raw ?? "");
    if (Number.isNaN(n)) throw new Error(`arithmetic: literal '${arg.raw}' is not a number`);
    return n;
  }
  const fn = selectorRegistry.lookup(arg.kind);
  if (!fn) throw new Error(`arithmetic: unknown nested selector '${arg.kind}'`);
  return fn(arg, ctx);
};

selectorRegistry.register("Add", (ast, ctx) => {
  let sum = 0;
  for (const a of ast.args ?? []) sum += evalArg(a, ctx);
  return sum;
});

selectorRegistry.register("Sub", (ast, ctx) => {
  const [a, b] = ast.args ?? [];
  return evalArg(a, ctx) - evalArg(b, ctx);
});

selectorRegistry.register("Mul", (ast, ctx) => {
  let prod = 1;
  for (const a of ast.args ?? []) prod *= evalArg(a, ctx);
  return prod;
});

selectorRegistry.register("Div", (ast, ctx) => {
  const [a, b] = ast.args ?? [];
  return Math.trunc(evalArg(a, ctx) / evalArg(b, ctx));
});

selectorRegistry.register("Mod", (ast, ctx) => {
  const [a, b] = ast.args ?? [];
  return evalArg(a, ctx) % evalArg(b, ctx);
});

selectorRegistry.register("Min", (ast, ctx) => {
  const vs = (ast.args ?? []).map((a) => evalArg(a, ctx));
  if (vs.length === 0) throw new Error("Min$ selector: no args");
  return Math.min(...vs);
});

selectorRegistry.register("Max", (ast, ctx) => {
  const vs = (ast.args ?? []).map((a) => evalArg(a, ctx));
  if (vs.length === 0) throw new Error("Max$ selector: no args");
  return Math.max(...vs);
});

selectorRegistry.register("Negate", (ast, ctx) => {
  const [a] = ast.args ?? [];
  return -evalArg(a, ctx);
});

selectorRegistry.register("Abs", (ast, ctx) => {
  const [a] = ast.args ?? [];
  return Math.abs(evalArg(a, ctx));
});
