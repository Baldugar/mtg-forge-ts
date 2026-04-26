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
// TODO(advanced): full Forge filter language (sub-types, color filters,
// nested predicates) is out of scope for the MVP — those filters are
// handled by SP4's full TargetRestriction AST.
import { CardType, ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const matchesCoarseFilter = (game: Game, cardId: EntityId, filter: string): boolean => {
  const tokens = filter.split(".").map((t) => t.trim());
  const head = tokens[0] ?? "";
  if (head === "Card") {
    const rest = tokens[1] ?? "";
    if (!rest) return true;
    const subTokens = rest.split("+").map((s) => s.trim().toLowerCase());
    const chars = game.layerEngine.computeCharacteristics(cardId);
    for (const t of subTokens) {
      if (t === "creature" && !chars.types.has(CardType.Creature)) return false;
      if (t === "artifact" && !chars.types.has(CardType.Artifact)) return false;
      if (t === "enchantment" && !chars.types.has(CardType.Enchantment)) return false;
      if (t === "land" && !chars.types.has(CardType.Land)) return false;
      if (t === "instant" && !chars.types.has(CardType.Instant)) return false;
      if (t === "sorcery" && !chars.types.has(CardType.Sorcery)) return false;
      if (t === "nonland" && chars.types.has(CardType.Land)) return false;
      // qualifiers we don't enforce (e.g. youctrl) just pass through —
      // RevealValid$ on hand cards is implicitly limited to the controller.
    }
    return true;
  }
  // Bare type name (e.g. "Dinosaur") → check creature subtype.
  const lower = head.toLowerCase();
  const chars = game.layerEngine.computeCharacteristics(cardId);
  for (const sub of chars.subtypes) {
    if (sub.toLowerCase() === lower) return true;
  }
  return false;
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
