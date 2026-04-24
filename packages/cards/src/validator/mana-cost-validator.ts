// SPDX-License-Identifier: GPL-3.0-or-later
import { ManaCost } from "@mtg-forge-ts/core";
import type { CardDefinition, ManaCostAst } from "@mtg-forge-ts/core";
import { registerValidator } from "./validate-card.js";
import type { ValidationIssue } from "./validate-card.js";

const isManaCostAst = (x: unknown): x is ManaCostAst =>
  typeof x === "object" && x !== null && "raw" in x && typeof (x as { raw: unknown }).raw === "string";

const NO_COST = new Set(["no cost", "0", ""]);

const validateManaCost = (card: CardDefinition, path: string): readonly ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const mc = card.manaCost;
  if (mc === null || mc === undefined) return issues;
  if (!isManaCostAst(mc)) {
    issues.push({ severity: "error", message: "manaCost is not a ManaCostAst", path });
    return issues;
  }
  if (NO_COST.has(mc.raw.toLowerCase())) return issues;
  try {
    ManaCost.parse(mc.raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    issues.push({
      severity: "error",
      message: `invalid mana cost '${mc.raw}': ${msg}`,
      path: `${path}.manaCost`,
    });
  }
  return issues;
};

registerValidator(validateManaCost);
