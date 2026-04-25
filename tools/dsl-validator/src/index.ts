// SPDX-License-Identifier: GPL-3.0-or-later
// Semantic validator — walks a parsed CardDefinition and verifies that
// every effect handlerKey, trigger mode, and replacement eventKind
// referenced in the card's AST nodes is registered in the live
// @mtg-forge-ts/game registries.
//
// This is intentionally decoupled from the structural validator in
// @mtg-forge-ts/cards/validator: structural checks run first (they
// throw on malformed AST); semantic checks run second (they report
// missing registry entries without throwing).

import type { AbilityAst, CardDefinition, KeywordAst, ReplacementAst, TriggerAst } from "@mtg-forge-ts/core";
import {
  effectRegistry,
  keywordHandlerRegistry,
  replacementHandlerRegistry,
  triggerHandlerRegistry,
} from "@mtg-forge-ts/game";

export interface SemanticIssue {
  readonly kind: "unknownEffect" | "unknownTrigger" | "unknownReplacement" | "unknownKeyword";
  readonly key: string;
  readonly path: string;
}

export interface SemanticValidationResult {
  readonly ok: boolean;
  readonly issues: readonly SemanticIssue[];
}

/** Registries bundle, injectable for testing. */
export interface Registries {
  readonly effect: { has(key: string): boolean };
  readonly trigger: { has(key: string): boolean };
  readonly replacement: { has(key: string): boolean };
  readonly keyword: { has(key: string): boolean };
}

/** Default registries — the live singletons from @mtg-forge-ts/game. */
export const defaultRegistries: Registries = {
  effect: effectRegistry,
  trigger: triggerHandlerRegistry,
  replacement: replacementHandlerRegistry,
  keyword: keywordHandlerRegistry,
};

/**
 * Walk a CardDefinition's AST and report any handler keys that are not
 * registered in the provided (or default) registries.
 *
 * DB-prefixed handler keys (e.g. "DBConjureGoose") are SVar references
 * resolved at runtime — the key is the SVar name, not an effect class.
 * These are intentionally skipped here; the structural resolver has already
 * confirmed the SVar exists on the card.
 */
export const validateCardSemantically = (
  card: CardDefinition,
  registries: Registries = defaultRegistries,
): SemanticValidationResult => {
  const issues: SemanticIssue[] = [];

  const visitCard = (def: CardDefinition, path: string): void => {
    // Abilities — effect handlerKey
    (def.abilities as readonly AbilityAst[]).forEach((a, i) => {
      const key = a.effect.handlerKey;
      // DB-prefixed keys are SVar refs, not registry entries — skip.
      if (!key.startsWith("DB") && !registries.effect.has(key)) {
        issues.push({ kind: "unknownEffect", key, path: `${path}.abilities[${i}]` });
      }
    });

    // Triggers — mode string
    (def.triggers as readonly TriggerAst[]).forEach((t, i) => {
      if (!registries.trigger.has(t.mode)) {
        issues.push({ kind: "unknownTrigger", key: t.mode, path: `${path}.triggers[${i}]` });
      }
    });

    // Replacements — eventKind string
    (def.replacements as readonly ReplacementAst[]).forEach((r, i) => {
      if (!registries.replacement.has(r.eventKind)) {
        issues.push({ kind: "unknownReplacement", key: r.eventKind, path: `${path}.replacements[${i}]` });
      }
    });

    // Keywords — keyword id string
    (def.keywords as readonly KeywordAst[]).forEach((k, i) => {
      // The FlagKeywordHandler is registered as "*" fallback, so
      // keywordHandlerRegistry.has() returns true for any keyword when the
      // fallback is populated.  Still record genuine misses for future-proofing.
      if (!registries.keyword.has(k.keyword)) {
        issues.push({ kind: "unknownKeyword", key: k.keyword, path: `${path}.keywords[${i}]` });
      }
    });

    // Recurse into alternate faces (MDFC / transform / split).
    def.faces?.forEach((face, i) => visitCard(face, `${path}.faces[${i}]`));
  };

  visitCard(card, card.name);
  return { ok: issues.length === 0, issues };
};
