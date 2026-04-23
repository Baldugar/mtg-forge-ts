// SPDX-License-Identifier: GPL-3.0-or-later
// CR 613.1c — Layer 3 text-changing effects. Substitute words (or whole
// tokens) in rules text BEFORE Layers 4-7 parse that text. Effects apply
// in timestamp order; word-boundary semantics ensure we don't replace
// inside larger tokens ("creatures" stays unchanged when replacing
// "creature", but whole-word "creature" does get replaced).
//
// Boundary implementation: negative lookarounds for word characters on both
// sides, rather than \b. Using \b breaks for patterns whose edges are non-
// word characters — e.g., "{2}" — because \b requires a transition between
// word and non-word chars and will not fire between two non-word chars.
// (?<!\w) / (?!\w) avoid that pitfall while still rejecting matches that
// abut a word character on either side.
//
// Forge reference: forge.game.staticability.StaticAbilityContinuous
// (changeTextTypes branch), forge.game.card.Card#changeText.
import type { Characteristics } from "@mtg-forge-ts/core";

export interface TextSubstitution {
  readonly from: string;
  readonly to: string;
  readonly timestamp: number;
}

export const applyLayer3Text = (target: Characteristics, subs: readonly TextSubstitution[]): void => {
  if (subs.length === 0) return;
  const ordered = [...subs].sort((a, b) => a.timestamp - b.timestamp);
  for (const sub of ordered) {
    // Escape regex metacharacters in the literal pattern, then wrap with
    // "no word char before / no word char after" lookarounds.
    const escaped = sub.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    target.rulesText = target.rulesText.replace(new RegExp(`(?<!\\w)${escaped}(?!\\w)`, "g"), sub.to);
  }
};
