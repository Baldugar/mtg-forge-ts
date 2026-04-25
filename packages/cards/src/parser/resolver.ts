// SPDX-License-Identifier: GPL-3.0-or-later
// Intra-card reference resolver — walks the assembled CardDefinition
// and throws on any SVar reference that has no matching SVar: line.
// Runs AFTER the assembler; a reference to a non-existent SVar is a
// parse-time error, not a runtime one.

import type {
  AbilityAst,
  CardDefinition,
  EffectInvocation,
  ReplacementAst,
  SVarAst,
  StaticAst,
  TriggerAst,
} from "@mtg-forge-ts/core";

// Walk a single EffectInvocation, checking:
//  1. Any param with kind "svarRef" must resolve to a known SVar.
//  2. Only handlerKeys that start with "DB" are DSL SVar references — they
//     MUST exist in svars (DB-prefix convention from Forge's AbilityFactory).
//  3. The synthetic "Prevent" handlerKey (emitted for prevention-style
//     replacements that have no ReplaceWith$ SVar) does NOT start with "DB"
//     and is never checked against svars.
//  4. SubAbility chain is walked recursively.
const walkInvocation = (
  where: string,
  invocation: EffectInvocation,
  svars: ReadonlyMap<string, SVarAst>,
): void => {
  // Handler-key check: ONLY DB-prefixed keys are SVar references.
  // Native handler identifiers (SP$, AB$, etc.) and synthetic sentinels
  // like "Prevent" are never backed by a SVar: line.
  if (invocation.handlerKey.startsWith("DB") && !svars.has(invocation.handlerKey)) {
    throw new Error(`${where}: unresolved reference '${invocation.handlerKey}'`);
  }

  // Param-level svarRef check
  for (const [k, pv] of Object.entries(invocation.params)) {
    if (pv.kind === "svarRef" && !svars.has(pv.name)) {
      throw new Error(`${where}: param '${k}' unresolved reference '${pv.name}'`);
    }
  }

  if (invocation.subAbility) {
    walkInvocation(`${where}.subAbility`, invocation.subAbility, svars);
  }
};

export const resolveReferences = (card: CardDefinition): void => {
  const svars = card.svars as ReadonlyMap<string, SVarAst>;

  // Abilities: SP$/AB$ handlerKeys are native handlers; DB$ are SVar refs.
  (card.abilities as readonly AbilityAst[]).forEach((a, i) => {
    walkInvocation(`${card.name}.abilities[${i}]`, a.effect, svars);
  });

  // Triggers: Execute$ value is an SVar name (DB-prefixed ones are checked).
  (card.triggers as readonly TriggerAst[]).forEach((t, i) => {
    walkInvocation(`${card.name}.triggers[${i}]`, t.effect, svars);
  });

  // Replacements: ReplaceWith$ is an SVar name, or "Prevent" (synthetic sentinel).
  (card.replacements as readonly ReplacementAst[]).forEach((r, i) => {
    walkInvocation(`${card.name}.replacements[${i}]`, r.effect, svars);
  });

  // Statics: params only (no invocation handlerKey to resolve).
  (card.statics as readonly StaticAst[]).forEach((s, i) => {
    for (const [k, pv] of Object.entries(s.params)) {
      if (pv.kind === "svarRef" && !svars.has(pv.name)) {
        throw new Error(`${card.name}.statics[${i}]: param '${k}' unresolved reference '${pv.name}'`);
      }
    }
  });

  // Recurse into faces.
  card.faces?.forEach(resolveReferences);
};
