// SPDX-License-Identifier: GPL-3.0-or-later
import { selectorRegistry } from "../selector-registry.js";

selectorRegistry.register("Number", (ast) => {
  const arg = ast.args?.[0];
  const raw = arg?.raw ?? "";
  const n = Number(raw);
  if (Number.isNaN(n)) {
    throw new Error(`Number$ selector: '${raw}' is not a number (from '${ast.raw ?? ast.kind}')`);
  }
  return n;
});
