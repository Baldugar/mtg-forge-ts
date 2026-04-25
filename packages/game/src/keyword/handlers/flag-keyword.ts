// SPDX-License-Identifier: GPL-3.0-or-later
// FlagKeywordHandler — catchall handler (keyword = "*") for all flag-shape
// keywords (Flying, Reach, Trample, Deathtouch, Lifelink, Vigilance, Haste,
// Indestructible, Hexproof, Shroud, Menace, Defender, Fear, Intimidate,
// Daybound, Nightbound, Decayed, Devoid, Compleated, Companion, Cipher,
// Changeling, Convoke, Improvise, Delve, Phasing, Horsemanship, Skulk,
// Shadow, Banding, etc.).
//
// Implementation: on activate, adds the KeywordId to Card.keywords (creating
// the Set if absent). On deactivate, removes it. The KeywordId values are
// already in lowercase_snake_case (e.g. "first_strike", "trample") — the same
// form that combat code and hasKeyword() expect, so no transformation is needed.
import type { KeywordAst } from "@mtg-forge-ts/core";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class FlagKeywordHandler extends KeywordHandler {
  /** Matches any keyword not explicitly claimed by a more specific handler. */
  static override readonly keyword = "*" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add(ast.keyword);
  }

  override deactivate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete(ast.keyword);
  }
}

// Self-register as the global catchall for flag-shape keywords.
keywordHandlerRegistry.register(FlagKeywordHandler);
