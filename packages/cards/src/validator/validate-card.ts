// SPDX-License-Identifier: GPL-3.0-or-later
// Structural validator — post-parse check that walks the CardDefinition
// and collects all violations. Runs only checks that do NOT require the
// handler registry; per-handler required-params schemas land in Part H.

import type { CardDefinition } from "@mtg-forge-ts/core";

export interface ValidationIssue {
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly path: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
}

export type ValidatorFn = (card: CardDefinition, path: string) => readonly ValidationIssue[];

const ALL_VALIDATORS: ValidatorFn[] = [];

export const registerValidator = (fn: ValidatorFn): void => {
  ALL_VALIDATORS.push(fn);
};

export const validateCard = (card: CardDefinition): ValidationResult => {
  const issues: ValidationIssue[] = [];
  const walk = (def: CardDefinition, path: string): void => {
    for (const v of ALL_VALIDATORS) {
      for (const issue of v(def, path)) issues.push(issue);
    }
    def.faces?.forEach((face, i) => {
      walk(face, `${path}.faces[${i}]`);
    });
  };
  walk(card, card.name);
  return { ok: issues.every((i) => i.severity !== "error"), issues };
};
