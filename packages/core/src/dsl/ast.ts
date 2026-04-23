// SPDX-License-Identifier: GPL-3.0-or-later
// Parser-time AST for Forge's card DSL. These types are the contract between
// the DSL parser (SP3) and the effect/trigger/replacement registries — every
// node is pure data so the AST JSON-round-trips without class-rehydration.
//
// Ported from Forge's forge.card.CardRules parser family + the ability
// scripting conventions in forge-game's AbilityFactory. Shape is intentionally
// minimal here (shape-only); SP3 populates the parser that emits these nodes.

import type { ManaSymbol } from "../mana/symbol.js";
import type { ZoneType } from "../zone.js";

/**
 * A parameter value in an EffectInvocation. Three kinds:
 *   - literal: a raw string token (number, identifier, literal enum name).
 *   - svarRef: reference to a named SVar on the same card (e.g. "DBDamage").
 *   - expression: inline SVar expression (Count$Foo, Number$X, etc.).
 */
export type ParamValue =
  | { readonly kind: "literal"; readonly raw: string }
  | { readonly kind: "svarRef"; readonly name: string }
  | { readonly kind: "expression"; readonly ast: SVarExpressionAst };

/**
 * Recursive SVar expression tree. `kind` identifies the expression operator
 * (Count, Number, SVar, etc.); `args` holds nested sub-expressions; `raw`
 * preserves the exact source text for pass-through cases the parser hasn't
 * fully structured yet.
 */
export interface SVarExpressionAst {
  readonly kind: string;
  readonly args?: readonly SVarExpressionAst[];
  readonly raw?: string;
}

/**
 * A single effect-handler invocation. `handlerKey` routes to the effect
 * registry (e.g. "DealDamage", "Draw"); `params` are the parsed ability
 * parameters; `subAbility` chains an effect that runs after the parent.
 */
export interface EffectInvocation {
  readonly handlerKey: string;
  readonly params: Readonly<Record<string, ParamValue>>;
  readonly subAbility?: EffectInvocation;
}

export interface AbilityAst {
  readonly kind: "spell" | "activated";
  readonly effect: EffectInvocation;
  readonly cost: CostAst;
  readonly rulesText?: string;
  readonly timing?: "sorcery" | "instant" | "any";
}

export interface TriggerAst {
  readonly mode: string;
  readonly params: Readonly<Record<string, ParamValue>>;
  readonly effect: EffectInvocation;
}

export interface ReplacementAst {
  readonly eventKind: string;
  readonly params: Readonly<Record<string, ParamValue>>;
  readonly effect: EffectInvocation;
  readonly isSelf?: boolean;
}

export interface StaticAst {
  readonly mode: string;
  readonly params: Readonly<Record<string, ParamValue>>;
  readonly activeInZones: readonly ZoneType[];
}

export interface KeywordAst {
  readonly keyword: string;
  readonly params?: Readonly<Record<string, ParamValue>>;
}

export interface SVarAst {
  readonly kind: "value" | "ability";
  readonly raw: string;
  readonly expression?: SVarExpressionAst;
  readonly ability?: EffectInvocation;
}

/** SP3 populates the detailed parsed form; SP1 keeps the raw text only. */
export interface CostAst {
  readonly raw: string;
}

export interface TypeLineAst {
  readonly supertypes: readonly string[];
  readonly types: readonly string[];
  readonly subtypes: readonly string[];
}

export interface PtAst {
  readonly power: string;
  readonly toughness: string;
}

export interface LoyaltyAst {
  readonly starting: string;
}

export interface DefenseAst {
  readonly starting: string;
}

/**
 * Parser-time mana-cost representation. Distinct from `ManaCost` (the
 * runtime class with pay/combine logic) — this is a shape-only snapshot of
 * what the parser emitted so downstream AST consumers can introspect symbols
 * without constructing the full runtime object.
 */
export interface ManaCostAst {
  readonly raw: string;
  readonly symbols: readonly ManaSymbol[];
}
