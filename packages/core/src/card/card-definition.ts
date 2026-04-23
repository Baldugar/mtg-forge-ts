// SPDX-License-Identifier: GPL-3.0-or-later
// CardDefinition is the in-memory shape of a parsed MTG card (oracle text
// already parsed into abilities/triggers/etc.). SP1 leaves the DSL-populated
// fields typed as `unknown` because the AST lives downstream in a later task;
// callers that produce CardDefinitions today only populate name/oracle/types.

import type { ColorSet } from "../color.js";
import type { TypeLine } from "./types.js";

export interface CardPowerToughness {
  // Forge stores P/T as strings because of `*`, `X`, `1+*` etc. We keep the
  // string form verbatim and let the rules engine reason about the symbols.
  readonly power: string;
  readonly toughness: string;
}

export interface CardDefinition {
  readonly name: string;
  readonly oracle: string;
  readonly types: TypeLine;
  // ManaCostAst lands in a later task (DSL AST). Until then this is `unknown`
  // so downstream types can compose without depending on an unstable shape.
  readonly manaCost: unknown | null;
  readonly pt?: CardPowerToughness;
  readonly loyalty?: string;
  readonly defense?: string;
  readonly colors?: ColorSet;
  readonly abilities: readonly unknown[];
  readonly triggers: readonly unknown[];
  readonly replacements: readonly unknown[];
  readonly statics: readonly unknown[];
  readonly keywords: readonly unknown[];
  readonly svars: ReadonlyMap<string, unknown>;
  // MDFC / transform / split cards carry a `faces` array whose entries are
  // themselves CardDefinitions; the primary face is the wrapper itself.
  readonly faces?: readonly CardDefinition[];
}
