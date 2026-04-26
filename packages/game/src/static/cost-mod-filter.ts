// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 6 — Filter language for cost-modification statics. Builds a closure
// from the static's ValidCard$ / Type$ / Activator$ params; the closure is
// consumed by gatherCostModsFor at cost-determination time.
//
// Filter context (the `item` passed to the filter):
//   { sourceCardId, controllerSeat, card?, kind: "spell" | "ability" }
//
// Grammar coverage (MVP):
//   ValidCard$:   <Base>(.<Qualifier>)*  with comma = OR-of-alternatives.
//     Bases:       Card, Spell, Creature, Artifact, Enchantment, Land,
//                  Instant, Sorcery, Planeswalker.
//     Qualifiers:  Self, YouCtrl, YouOwn, OppCtrl/OpponentCtrl,
//                  White|Blue|Black|Red|Green, non<Type>, non<Color>.
//   Type$ Spell|Ability — gates on item.kind.
//   Activator$ You|Opponent|Player.NonActive — compares item.controllerSeat
//     against the static-source's controller.
//
// Unknown bases or qualifiers cause the filter to reject conservatively so
// we never silently match cards the printed text excludes.
import { Color, type EntityId, type ParamValue, type PlayerSeat, type ZoneType } from "@mtg-forge-ts/core";
import type { Card } from "../card.js";
import type { Game } from "../game.js";

export interface SpellCostModItem {
  readonly sourceCardId: EntityId;
  readonly controllerSeat: PlayerSeat;
  readonly card: Card | undefined;
  readonly kind: "spell" | "ability";
  /**
   * Wave 11 — the zone the source card is in when this cost is being paid.
   * Used by the `AffectedZone$` filter. For spells being cast, this is the
   * origin zone (Hand for normal casts, Graveyard for Flashback, etc.).
   * For activated abilities it's the zone the ability is being activated
   * from (Battlefield for {T}-cost permanent abilities; Hand for Cycling).
   */
  readonly sourceZone?: ZoneType;
}

const isLiteralRaw = (p: ParamValue | undefined): string | undefined =>
  p && p.kind === "literal" ? p.raw : undefined;

const COLOR_NAMES = new Set(["White", "Blue", "Black", "Red", "Green"]);
const COLOR_BY_NAME: Readonly<Record<string, Color>> = {
  White: Color.White,
  Blue: Color.Blue,
  Black: Color.Black,
  Red: Color.Red,
  Green: Color.Green,
};

export const buildCostModFilter = (
  staticParams: Readonly<Record<string, ParamValue>>,
  sourceControllerSeat: PlayerSeat,
  staticSourceCardId: EntityId,
): ((item: unknown, game: Game) => boolean) => {
  const validCardRaw = isLiteralRaw(staticParams.ValidCard);
  const typeRaw = isLiteralRaw(staticParams.Type);
  const activatorRaw = isLiteralRaw(staticParams.Activator);
  const affectedZoneRaw = isLiteralRaw(staticParams.AffectedZone);

  return (rawItem: unknown, game: Game): boolean => {
    if (rawItem === null || typeof rawItem !== "object") return false;
    const probe = rawItem as { sourceCardId?: unknown };
    if (!("sourceCardId" in probe)) return false;
    const item = rawItem as SpellCostModItem;

    // Type$ Spell vs Ability — gate on item.kind.
    if (typeRaw === "Spell" && item.kind !== "spell") return false;
    if (typeRaw === "Ability" && item.kind !== "ability") return false;

    // Activator$ You / Opponent / Player.NonActive
    if (activatorRaw === "You" && item.controllerSeat !== sourceControllerSeat) return false;
    if (
      (activatorRaw === "Opponent" || activatorRaw === "Player.NonActive") &&
      item.controllerSeat === sourceControllerSeat
    ) {
      return false;
    }

    // AffectedZone$ — gate on the zone the source card is in when paying.
    // Forge's tokens are PascalCase enum names ("Battlefield", "Hand", …).
    // When the param is present and the item carries a sourceZone, both
    // must agree (case-insensitive for resilience against parser drift).
    if (affectedZoneRaw !== undefined) {
      const itemZone = item.sourceZone;
      if (itemZone === undefined) return false;
      if (itemZone.toLowerCase() !== affectedZoneRaw.toLowerCase()) return false;
    }

    // ValidCard$ — comma-OR of dot-AND alternatives.
    if (validCardRaw !== undefined) {
      if (!matchesValidCard(validCardRaw, item, game, sourceControllerSeat, staticSourceCardId)) {
        return false;
      }
    }
    return true;
  };
};

const matchesValidCard = (
  raw: string,
  item: SpellCostModItem,
  game: Game,
  sourceControllerSeat: PlayerSeat,
  staticSourceCardId: EntityId,
): boolean => {
  const alternatives = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (alternatives.length === 0) return true;
  return alternatives.some((alt) =>
    matchesAlternative(alt, item, game, sourceControllerSeat, staticSourceCardId),
  );
};

const matchesAlternative = (
  alt: string,
  item: SpellCostModItem,
  _game: Game,
  sourceControllerSeat: PlayerSeat,
  staticSourceCardId: EntityId,
): boolean => {
  const parts = alt.split(".");
  const base = parts[0] ?? "Card";
  const qualifiers = parts.slice(1);
  const card = item.card;

  // Base type check.
  switch (base) {
    case "Card":
    case "Spell":
      break; // any card / any spell type
    case "Creature":
    case "Artifact":
    case "Enchantment":
    case "Land":
    case "Instant":
    case "Sorcery":
    case "Planeswalker":
      if (!card || !cardHasType(card, base)) return false;
      break;
    default:
      // Unknown base — be conservative and reject.
      return false;
  }

  // Qualifiers (dot-chained AND).
  for (const q of qualifiers) {
    if (q === "Self") {
      if (item.sourceCardId !== staticSourceCardId) return false;
      continue;
    }
    if (q === "YouCtrl") {
      if (item.controllerSeat !== sourceControllerSeat) return false;
      continue;
    }
    if (q === "YouOwn") {
      if (!card || card.ownerSeat !== sourceControllerSeat) return false;
      continue;
    }
    if (q === "OppCtrl" || q === "OpponentCtrl") {
      if (item.controllerSeat === sourceControllerSeat) return false;
      continue;
    }
    if (COLOR_NAMES.has(q)) {
      if (!card || !cardHasColor(card, q)) return false;
      continue;
    }
    if (q.startsWith("non") && q.length > 3) {
      const negated = q.slice(3);
      if (COLOR_NAMES.has(negated)) {
        if (card && cardHasColor(card, negated)) return false;
        continue;
      }
      // Treat any other "non<X>" suffix as a card-type negation.
      if (card && cardHasType(card, negated)) return false;
      continue;
    }
    // Wave 11 — fall through to a card-type / subtype check so qualifiers
    // like ".Dragon", ".Bear", ".Wizard" work (Forge subtypes appear after
    // the base in Card.Dragon, Creature.Wizard, etc.). cardHasType already
    // checks both supertypes/types AND subtypes via hasSubtype.
    if (card && cardHasType(card, q)) continue;
    // Unrecognised qualifier — conservative reject.
    return false;
  }
  return true;
};

const cardHasType = (card: Card, typeName: string): boolean => {
  const def = card.paperCard.definition;
  if (!def) return false;
  // CardDefinition.types is a TypeLine instance with .has() (covers
  // supertypes + types) and .hasSubtype() for subtypes.
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
  // Prefer an explicitly-declared `colors: ColorSet` if the definition has
  // one (Forge `Colors:` line or hand-built test fixtures populate this).
  const colors = (def as { colors?: { has?: (c: Color) => boolean } }).colors;
  if (colors && typeof colors.has === "function" && colors.has(colorBit)) return true;
  // Fall back to the parsed mana cost: a card whose printed cost contains
  // a {B} pip is black. ManaCostAst is shape-only ({ raw, symbols }) so we
  // scan symbols directly for colored / hybrid / monohybrid / phyrexian pips.
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
