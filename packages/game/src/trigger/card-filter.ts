// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 32 — shared ValidCard$/IsPresent$ filter used by AlwaysTrigger,
// AttacksTrigger, and ChangesZoneTrigger. The grammar accepts:
//
//   <Filter>      ::= <Alt> ("," <Alt>)*       — comma-OR alternatives
//   <Alt>         ::= <Base> ("." <Qualifier>)* | <Base> ("+" <Qualifier>)*
//   <Base>        ::= Card | Permanent | Creature | Artifact | Enchantment
//                   | Land | Instant | Sorcery | Planeswalker | <SubType>
//   <Qualifier>   ::= Self | Other | YouCtrl | OppCtrl | OpponentCtrl
//                   | tapped | untapped
//                   | White | Blue | Black | Red | Green
//                   | non<Type> | non<Color>
//                   | attacking
//                   | <SubType>
//
// An empty filter rejects (returns false) — callers should branch on
// `validRaw === undefined` before delegating to this helper.
//
// Constellation (T:Mode$ ChangesZone | ValidCard$ Card.Self,Enchantment.Other+YouCtrl)
//   Each comma-separated alternative is evaluated independently; the card
//   passes if ANY alternative matches. Within an alternative, qualifiers
//   are AND'd together (joined by `.` or `+`).
//
// Battalion (T:Mode$ Attacks | IsPresent$ Creature.attacking+Other | PresentCompare$ GE2)
//   The `attacking` qualifier passes when the card is in the supplied
//   `attackingIds` set (callers pass a non-undefined Set for Attacks-mode
//   filters; passing `undefined` makes the qualifier reject conservatively).
//
// Revolt is wired separately via permanentsLeftBfThisTurn — it's a
// per-trigger gate, not a per-card filter.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import { CardType, Color } from "@mtg-forge-ts/core";
import type { Card } from "../card.js";

const COLOR_NAMES: ReadonlySet<string> = new Set(["White", "Blue", "Black", "Red", "Green"]);
const COLOR_BY_NAME: Readonly<Record<string, Color>> = {
  White: Color.White,
  Blue: Color.Blue,
  Black: Color.Black,
  Red: Color.Red,
  Green: Color.Green,
};

const cardHasType = (card: Card, typeName: string): boolean => {
  const def = card.paperCard.definition;
  if (!def) return false;
  const types = def.types as { has?: (t: string) => boolean; hasSubtype?: (s: string) => boolean };
  if (typeof types.has === "function" && types.has(typeName)) return true;
  if (typeof types.hasSubtype === "function" && types.hasSubtype(typeName)) return true;
  return false;
};

const cardHasColor = (card: Card, colorName: string): boolean => {
  const colorBit = COLOR_BY_NAME[colorName];
  if (colorBit === undefined) return false;
  const def = card.paperCard.definition;
  if (!def) return false;
  const colors = (def as { colors?: { has?: (c: Color) => boolean } }).colors;
  if (colors && typeof colors.has === "function" && colors.has(colorBit)) return true;
  const mc = (def as { manaCost?: { symbols?: ReadonlyArray<{ color?: Color; a?: Color; b?: Color }> } })
    .manaCost;
  if (mc && Array.isArray(mc.symbols)) {
    for (const s of mc.symbols) {
      if (s.color === colorBit) return true;
      if (s.a === colorBit || s.b === colorBit) return true;
    }
  }
  return false;
};

/** Internal: split an Alt on `.` or `+` (Forge accepts both as AND-joiners). */
const splitAlt = (alt: string): string[] => alt.split(/[.+]/);

export interface CardFilterCtx {
  /** The trigger/static's controller, used for YouCtrl/OppCtrl qualifiers. */
  readonly controllerSeat: PlayerSeat;
  /** The trigger/static's source card id, used for Self/Other qualifiers. */
  readonly sourceCardId: EntityId;
  /**
   * Optional set of attacker card ids (Attacks-mode triggers). When the
   * filter contains the `attacking` qualifier and this set is undefined,
   * the qualifier conservatively rejects.
   */
  readonly attackingIds?: ReadonlySet<EntityId>;
}

/**
 * Test whether `card` satisfies a single dot-/plus-joined Alt expression.
 * Returns true on match, false on any mismatch (including unknown
 * qualifiers — conservative reject so we never over-trigger).
 */
const cardMatchesAlt = (card: Card, alt: string, ctx: CardFilterCtx): boolean => {
  const parts = splitAlt(alt);
  const base = parts[0] ?? "Card";
  const qualifiers = parts.slice(1);

  // Base type check.
  switch (base) {
    case "Card":
    case "Permanent":
      break;
    case "Creature":
      if (!card.paperCard.definition?.types?.has(CardType.Creature)) return false;
      break;
    case "Artifact":
      if (!card.paperCard.definition?.types?.has(CardType.Artifact)) return false;
      break;
    case "Enchantment":
      if (!card.paperCard.definition?.types?.has(CardType.Enchantment)) return false;
      break;
    case "Land":
      if (!card.paperCard.definition?.types?.has(CardType.Land)) return false;
      break;
    case "Instant":
      if (!card.paperCard.definition?.types?.has(CardType.Instant)) return false;
      break;
    case "Sorcery":
      if (!card.paperCard.definition?.types?.has(CardType.Sorcery)) return false;
      break;
    case "Planeswalker":
      if (!card.paperCard.definition?.types?.has(CardType.Planeswalker)) return false;
      break;
    default:
      // Treat as a subtype (e.g. Goblin, Wizard, Forest, Saga).
      if (!cardHasType(card, base)) return false;
      break;
  }

  for (const q of qualifiers) {
    if (q === "Self") {
      if (card.id !== ctx.sourceCardId) return false;
      continue;
    }
    if (q === "Other") {
      if (card.id === ctx.sourceCardId) return false;
      continue;
    }
    if (q === "YouCtrl") {
      if (card.controllerSeat !== ctx.controllerSeat) return false;
      continue;
    }
    if (q === "OppCtrl" || q === "OpponentCtrl") {
      if (card.controllerSeat === ctx.controllerSeat) return false;
      continue;
    }
    if (q === "tapped") {
      if (!card.tapped) return false;
      continue;
    }
    if (q === "untapped") {
      if (card.tapped) return false;
      continue;
    }
    if (q === "attacking") {
      if (!ctx.attackingIds || !ctx.attackingIds.has(card.id)) return false;
      continue;
    }
    // Wave 71 — CR 701.58 — Card.Suspected matches when the card is
    // currently suspected (Murders at Karlov Manor). Mirrors Forge's
    // CardProperty.IsSuspected predicate.
    if (q === "Suspected" || q === "IsSuspected") {
      if (card.suspected !== true) return false;
      continue;
    }
    if (COLOR_NAMES.has(q)) {
      if (!cardHasColor(card, q)) return false;
      continue;
    }
    if (q.startsWith("non") && q.length > 3) {
      const negated = q.slice(3);
      if (COLOR_NAMES.has(negated)) {
        if (cardHasColor(card, negated)) return false;
        continue;
      }
      if (cardHasType(card, negated)) return false;
      continue;
    }
    // Fall through to subtype check (e.g. ".Dragon", ".Wizard", ".Swamp").
    if (cardHasType(card, q)) continue;
    // Unrecognised qualifier — conservative reject.
    return false;
  }
  return true;
};

/**
 * Test whether `card` satisfies a (possibly comma-separated) ValidCard$ /
 * IsPresent$ filter expression. Returns true if ANY alternative matches.
 *
 * Empty filters reject. Malformed filters that produce only empty alts
 * also reject conservatively.
 */
export const cardMatchesFilter = (card: Card, raw: string, ctx: CardFilterCtx): boolean => {
  if (raw.length === 0) return false;
  const alts = raw.split(",");
  for (const alt of alts) {
    if (alt.length === 0) continue;
    if (cardMatchesAlt(card, alt, ctx)) return true;
  }
  return false;
};

/**
 * Compare the actual count of matching cards against a `PresentCompare$`
 * expression. Recognised operators: GE, GT, LE, LT, EQ, NE, M (mod) is
 * out of scope. Unknown operators reject.
 */
export const evalPresentCompare = (actual: number, raw: string): boolean => {
  if (raw.length < 2) return false;
  const op = raw.slice(0, 2);
  const nRaw = raw.slice(2);
  const n = Number.parseInt(nRaw, 10);
  if (!Number.isFinite(n)) return false;
  switch (op) {
    case "GE":
      return actual >= n;
    case "GT":
      return actual > n;
    case "LE":
      return actual <= n;
    case "LT":
      return actual < n;
    case "EQ":
      return actual === n;
    case "NE":
      return actual !== n;
    default:
      return false;
  }
};
