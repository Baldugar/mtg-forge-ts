// SPDX-License-Identifier: GPL-3.0-or-later
// CR 614 — replacement effect shape. Tasks 16-19 implement the registry.
import type { AbilityBase } from "./active-ability.js";

// Replacement effects act on "mutation intents" — the abstract description
// of what GameAction is about to do, before it applies. Each registered
// ReplacementAbility matches against an intent and returns either a
// modified intent or null (prevent).
export type MutationIntent = Readonly<Record<string, unknown>> & { readonly kind: string };

export interface ReplacementAbility extends AbilityBase {
  readonly kind: "replacement";
  matches(intent: MutationIntent): boolean;
  // Returns a replacement intent, OR null meaning "event prevented".
  apply(intent: MutationIntent, game: unknown): MutationIntent | null;
  // CR 614.1c-d — self-replacements apply before external replacements
  // for permanent-entering events. Set by the registrar at register time
  // when the effect text is specified by the permanent itself.
  readonly isSelfReplacement: boolean;
}
