// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 42 — Count$ selector pack closing the long tail of Forge corpus
// forms our evaluator silently swallowed (cost-mod helpers wrap unknown
// args in a try/catch returning 0, masking the failure). Each selector
// here is wired through countArgRegistry; the dispatcher in count.ts
// handles compound forms by splitting the family head from the qualifier
// (e.g. "Devotion.Black" → look up "Devotion", handler reads ".Black").
//
// Forms registered:
//   - Count$Devotion.<Color>             (CR 700.5)
//   - Count$CastTotalManaSpent [Subtype] (mana paid for THIS card's cast)
//   - Count$NumColors                    (distinct colors of source/target)
//   - Count$Mountains / Plains / Islands / Swamps / Forests
//                                        (battlefield basic-land subtype)
//   - Count$Storm                        (CR 702.40 — spells cast this turn)
//   - Count$Valid <filter>               (battlefield, ValidCard$ grammar)
//   - Count$ValidGraveyard / ValidExile / ValidHand / ValidLibrary <filter>
//                                        (zone-scoped variants)
//
// All selectors are READ-ONLY — they walk game.cards / game.flags and
// return a number. They never mutate game state.
import type { EntityId, PlayerSeat, SVarExpressionAst } from "@mtg-forge-ts/core";
import { CardType, Color, ZoneType } from "@mtg-forge-ts/core";
import type { Card } from "../../card.js";
import { cardMatchesFilter } from "../../trigger/card-filter.js";
import type { SvarContext } from "../context.js";
import { countArgRegistry } from "./count.js";

// --- Devotion (Count$Devotion.<Color>) -------------------------------------

const COLOR_BY_NAME: Readonly<Record<string, Color>> = {
  White: Color.White,
  Blue: Color.Blue,
  Black: Color.Black,
  Red: Color.Red,
  Green: Color.Green,
};

/**
 * Count colored mana symbols matching `target` among the controller's
 * permanents on the battlefield. CR 700.5: hybrid pips count once if
 * EITHER half matches; phyrexian pips count toward their color; generic
 * and colorless pips never count.
 *
 * Each symbol contributes at most 1 to the total (a hybrid {B/G} pip
 * adds 1 to Devotion-to-Black AND 1 to Devotion-to-Green when each is
 * computed independently — but a single Devotion query only counts the
 * symbol once toward the queried color).
 */
const countDevotionTo = (target: Color, ctx: SvarContext): number => {
  const controller = ctx.controller;
  if (controller === undefined) return 0;
  let total = 0;
  for (const [id, card] of ctx.game.cards) {
    if (card.zone !== ZoneType.Battlefield) continue;
    if (card.controllerSeat !== controller) continue;
    const chars = ctx.game.layerEngine.computeCharacteristics(id);
    for (const sym of chars.manaCost.symbols) {
      switch (sym.kind) {
        case "colored":
          if (sym.color === target) total += 1;
          break;
        case "hybrid":
        case "hybridPhyrexian":
          if (sym.a === target || sym.b === target) total += 1;
          break;
        case "monoHybrid":
        case "phyrexian":
        case "colorlessHybrid":
          if (sym.color === target) total += 1;
          break;
        // generic / colorless / snow / variable / coloredX never contribute.
        default:
          break;
      }
    }
  }
  return total;
};

const computeDevotion = (ast: SVarExpressionAst, ctx: SvarContext): number => {
  const raw = ast.args?.[0]?.raw ?? "";
  // raw is e.g. "Devotion.Black" — strip the head.
  const dot = raw.indexOf(".");
  if (dot < 0) return 0;
  const colorName = raw.slice(dot + 1);
  const color = COLOR_BY_NAME[colorName];
  if (color === undefined) return 0;
  return countDevotionTo(color, ctx);
};

countArgRegistry.register("Devotion", computeDevotion);

// --- Cast total mana spent --------------------------------------------------

/**
 * Count$CastTotalManaSpent reads the source card's `manaSpentTotal` slot
 * populated by CostMana.pay during the cast. The optional `<Subtype>`
 * variant (Snow, Cave, Plains…) restricts the count to mana produced by
 * a permanent of that subtype — not yet wired (would require taps-for-mana
 * provenance threading through the mana pool); returns 0 with a TODO until
 * SP3 Part E adds subtype provenance to ManaPoolEntry.
 */
const computeCastTotalManaSpent = (ast: SVarExpressionAst, ctx: SvarContext): number => {
  const raw = ast.args?.[0]?.raw ?? "";
  const sourceId = ctx.sourceCardId;
  if (sourceId === undefined) return 0;
  const card = ctx.game.cards.get(sourceId);
  if (!card) return 0;
  // Subtype variant: "CastTotalManaSpent Snow" — split off the suffix.
  const space = raw.indexOf(" ");
  if (space >= 0 && space < raw.length - 1) {
    // TODO(advanced): subtype-specific mana-spent tracking requires
    // ManaPoolEntry to carry provenance (which permanent's subtype
    // produced this mana). Returns 0 conservatively.
    return 0;
  }
  return card.manaSpentTotal ?? 0;
};

countArgRegistry.register("CastTotalManaSpent", computeCastTotalManaSpent);

// --- NumColors --------------------------------------------------------------

/**
 * Count$NumColors — distinct colors of the source card (or, when targets
 * are present, the first target's colors). Reads the layered Characteristics
 * so animate / color-grant effects layer in correctly.
 */
const computeNumColors = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  let cardId: EntityId | undefined = undefined;
  if (ctx.targets && ctx.targets.length > 0) cardId = ctx.targets[0];
  else cardId = ctx.sourceCardId;
  if (cardId === undefined) return 0;
  if (!ctx.game.cards.has(cardId)) return 0;
  const chars = ctx.game.layerEngine.computeCharacteristics(cardId);
  return chars.colors.size;
};

countArgRegistry.register("NumColors", computeNumColors);

// --- Basic-land subtype counts (Mountains / Plains / etc.) ----------------

const mkBasicLandCounter =
  (subtype: string) =>
  (_ast: SVarExpressionAst, ctx: SvarContext): number => {
    const controller = ctx.controller;
    if (controller === undefined) return 0;
    let n = 0;
    for (const [id, card] of ctx.game.cards) {
      if (card.zone !== ZoneType.Battlefield) continue;
      if (card.controllerSeat !== controller) continue;
      const chars = ctx.game.layerEngine.computeCharacteristics(id);
      if (!chars.types.has(CardType.Land)) continue;
      if (chars.subtypes.has(subtype)) n += 1;
    }
    return n;
  };

countArgRegistry.register("Plains", mkBasicLandCounter("Plains"));
countArgRegistry.register("Islands", mkBasicLandCounter("Island"));
countArgRegistry.register("Swamps", mkBasicLandCounter("Swamp"));
countArgRegistry.register("Mountains", mkBasicLandCounter("Mountain"));
countArgRegistry.register("Forests", mkBasicLandCounter("Forest"));

// --- Storm -----------------------------------------------------------------

/**
 * Count$Storm — total non-land spells cast THIS TURN by the controller.
 * Backed by GameFlags.spellsCastThisTurn (already maintained by the cast
 * pipeline via day-night-tracker.noteSpellCast and reset on TurnEnded).
 *
 * Note: StormKeywordHandler reads the same counter but subtracts 1 because
 * the storm spell itself is already counted by the time its trigger fires
 * (CR 702.40a wants "other spells cast before this one"). This selector
 * returns the RAW count for cards that want "spells cast this turn"
 * generically; the keyword handler keeps its -1 adjustment locally.
 */
const computeStorm = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  const controller = ctx.controller;
  if (controller === undefined) return 0;
  return ctx.game.flags.spellsCastThisTurn.get(controller) ?? 0;
};

countArgRegistry.register("Storm", computeStorm);

// --- Valid + zone-scoped Valid<Zone> ---------------------------------------

const ZONE_BY_VALID_SUFFIX: Readonly<Record<string, ZoneType>> = {
  Valid: ZoneType.Battlefield,
  ValidGraveyard: ZoneType.Graveyard,
  ValidExile: ZoneType.Exile,
  ValidHand: ZoneType.Hand,
  ValidLibrary: ZoneType.Library,
};

const mkValidCounter =
  (zone: ZoneType, head: string) =>
  (ast: SVarExpressionAst, ctx: SvarContext): number => {
    const raw = ast.args?.[0]?.raw ?? "";
    // raw is e.g. "Valid Creature.YouCtrl" or "ValidGraveyard Card.YouCtrl";
    // strip the family head + the single space separator.
    if (!raw.startsWith(head)) return 0;
    let rest = raw.slice(head.length);
    // Permit space OR dot as the separator after the head ("Valid.Creature"
    // and "Valid Creature" both appear in Forge-style data); trim the leading
    // separator either way.
    if (rest.length > 0 && (rest.charCodeAt(0) === 0x20 || rest.charCodeAt(0) === 0x2e)) {
      rest = rest.slice(1);
    }
    if (rest.length === 0) return 0;
    const controller = ctx.controller;
    const sourceCardId = ctx.sourceCardId;
    // ValidCard$ grammar uses `YouCtrl/OppCtrl/Self/Other` qualifiers that
    // require both a controller seat and a source card id. Without them, the
    // filter cannot resolve those qualifiers; bail conservatively.
    if (controller === undefined) return 0;
    const filterCtx = {
      controllerSeat: controller as PlayerSeat,
      sourceCardId: (sourceCardId ?? (-1 as unknown as EntityId)) as EntityId,
    };
    let n = 0;
    for (const card of ctx.game.cards.values()) {
      if (card.zone !== zone) continue;
      if (cardMatchesFilter(card as Card, rest, filterCtx)) n += 1;
    }
    return n;
  };

for (const [head, zone] of Object.entries(ZONE_BY_VALID_SUFFIX)) {
  countArgRegistry.register(head, mkValidCounter(zone, head));
}
