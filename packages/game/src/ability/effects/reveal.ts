// SPDX-License-Identifier: GPL-3.0-or-later
// RevealEffect — Forge `SP$ Reveal` / `DB$ Reveal`. Reveals defined cards
// (or a chosen subset of the player's hand by `RevealValid$` filter) from
// the controller's hand and emits a CardsRevealed event.
//
// Forge DSL examples:
//   SVar:DBReveal:DB$ Reveal | RevealDefined$ Self
//   SVar:TrigReveal:DB$ Reveal | RevealValid$ Dinosaur | RememberRevealed$ True | Optional$ True
//   SVar:DBReveal:DB$ Reveal | RevealValid$ Card.Artifact+YouCtrl | AnyNumber$ True
//
// MVP scope:
//   - RevealDefined$ Self → reveal source card.
//   - RevealDefined$ Targeted → reveal sa.targets.
//   - RevealValid$ <filter> → reveal all cards in controller's hand
//     matching a coarse filter (Card.<Type>+<qualifier>, where Type is
//     a CardType keyword and qualifier is empty / YouCtrl / etc).
//   - Default (no params) reveals the source card.
// `RememberRevealed$ True` appends revealed ids to source.remembered.
//
// Wave 80 — extends the coarse filter language to also cover subtypes
// (Card.Dinosaur, Card.Goblin) and the five mono-color qualifiers
// (White / Blue / Black / Red / Green) on the qualifier side. Full SP4
// TargetRestriction AST is still out of scope for cross-zone predicates;
// what's covered here is the dominant Forge usage on RevealValid$ from
// hand for reveal-effect SVars.
import { CardType, Color, ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

// Wave 80 — extended coarse filter. Each `+`-joined qualifier is checked
// independently; ALL qualifiers must match. Recognized tokens:
//   - "Card" / no head: match any card.
//   - Card type (creature, artifact, enchantment, land, instant, sorcery,
//     planeswalker, nonland, noncreature).
//   - Mono-color (white/blue/black/red/green/colorless/multicolor).
//   - Subtype (any other token; case-insensitive match against the card's
//     computed subtypes set).
//   - Soft qualifiers (youctrl, oppctrl, ...) pass through — the call site
//     scopes the search to the controller's hand or the explicit-targets
//     path, so seat is implicit.
const matchesQualifier = (game: Game, cardId: EntityId, raw: string): boolean => {
  const t = raw.toLowerCase();
  const chars = game.layerEngine.computeCharacteristics(cardId);
  switch (t) {
    case "":
    case "card":
      return true;
    case "creature":
      return chars.types.has(CardType.Creature);
    case "artifact":
      return chars.types.has(CardType.Artifact);
    case "enchantment":
      return chars.types.has(CardType.Enchantment);
    case "land":
      return chars.types.has(CardType.Land);
    case "instant":
      return chars.types.has(CardType.Instant);
    case "sorcery":
      return chars.types.has(CardType.Sorcery);
    case "planeswalker":
      return chars.types.has(CardType.Planeswalker);
    case "nonland":
      return !chars.types.has(CardType.Land);
    case "noncreature":
      return !chars.types.has(CardType.Creature);
    case "white":
      return chars.colors.has(Color.White);
    case "blue":
      return chars.colors.has(Color.Blue);
    case "black":
      return chars.colors.has(Color.Black);
    case "red":
      return chars.colors.has(Color.Red);
    case "green":
      return chars.colors.has(Color.Green);
    case "colorless":
      return chars.colors.size === 0;
    case "multicolor":
      return chars.colors.size >= 2;
    case "youctrl":
    case "yourctrl":
    case "oppctrl":
    case "youown":
    case "oppown":
      // Seat-scope qualifiers: caller already constrains the search to the
      // controller's hand, so accept and continue.
      return true;
    default:
      // Subtype match (Dinosaur, Goblin, Wizard, ...) — case-insensitive.
      for (const sub of chars.subtypes) {
        if (sub.toLowerCase() === t) return true;
      }
      return false;
  }
};

const matchesCoarseFilter = (game: Game, cardId: EntityId, filter: string): boolean => {
  const tokens = filter.split(".").map((t) => t.trim());
  const head = tokens[0] ?? "";
  if (head === "Card") {
    const rest = tokens[1] ?? "";
    if (!rest) return true;
    const subTokens = rest.split("+").map((s) => s.trim());
    for (const tok of subTokens) {
      if (!matchesQualifier(game, cardId, tok)) return false;
    }
    return true;
  }
  // Bare head (e.g. "Dinosaur" or "Creature") followed by optional "+"
  // qualifiers. This covers Forge shapes like "Dinosaur+YouCtrl" written
  // without a "Card." prefix.
  const subTokens = (tokens[0] ?? "").split("+").map((s) => s.trim());
  const restTokens = tokens.slice(1).flatMap((t) => t.split("+").map((s) => s.trim()));
  for (const tok of [...subTokens, ...restTokens]) {
    if (!matchesQualifier(game, cardId, tok)) return false;
  }
  return true;
};

export class RevealEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Reveal";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const seat = sa.controllerSeat;
    const ids: EntityId[] = [];

    if (hasParam(sa, "RevealDefined")) {
      const def = evaluateParamRaw(sa, "RevealDefined").trim();
      if (def === "Self") ids.push(sa.sourceCardId);
      else if (def === "Targeted") {
        for (const t of sa.targets) ids.push(t);
      } else {
        // Fallback: reveal source.
        ids.push(sa.sourceCardId);
      }
    } else if (hasParam(sa, "RevealValid")) {
      const filter = evaluateParamRaw(sa, "RevealValid");
      const player = game.getPlayer(seat);
      const hand = player.zones.get(ZoneType.Hand);
      if (hand) {
        for (const id of hand.toArray()) {
          if (matchesCoarseFilter(game, id, filter)) ids.push(id);
        }
      }
    } else {
      ids.push(sa.sourceCardId);
    }

    if (ids.length === 0) return;

    if (hasParam(sa, "RememberRevealed") && evaluateParamRaw(sa, "RememberRevealed") === "True") {
      const source = game.cards.get(sa.sourceCardId);
      if (source) {
        for (const id of ids) source.remembered.push(id);
      }
    }

    yield game.emitEvent(
      mkEvent("CardsRevealed", game.turn, game.phase, {
        revealedBy: seat,
        revealedTo: "all",
        cardIds: ids,
        fromZone: ZoneType.Hand,
      }),
    );
  }
}

effectRegistry.register(RevealEffect);
