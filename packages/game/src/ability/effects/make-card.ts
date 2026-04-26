// SPDX-License-Identifier: GPL-3.0-or-later
// MakeCardEffect — Forge `DB$ MakeCard` (Conjure / "create a card out of
// nothing"). Used by Wishes, Mind's Desire, and conjure-style cards
// (Sublime Epiphany's "conjure a duplicate"). Synthesizes a placeholder
// PaperCard with the named identity and puts it into the requested zone.
//
// Forge DSL examples:
//   SVar:GiftAbility:DB$ MakeCard | Name$ Rhystic Study | Defined$ Promised | Zone$ Battlefield
//   SVar:TrigConjure:DB$ MakeCard | Conjure$ True | DefinedName$ TriggeredCard | Zone$ Hand
//
// MVP scope:
//   - Name$ <CardName> | DefinedName$ <token> — accepted as the synthetic
//     card's identity.
//   - Zone$ <ZoneType> — destination (Hand/Battlefield/Library/Graveyard/
//     Exile). Defaults to Hand.
//   - Defined$ Promised → controller; Defined$ Targeted → target's owner;
//     else controller.
//   - RememberMade$ True appends the new EntityId to source.remembered.
//
// TODO(advanced): full CardDb-driven materialization (real PaperCard from
// the inventory, not a stub) lands in SP4 when CardDb integration is wired.
// For now we synthesize a minimal PaperCard so cards using MakeCard for
// placeholders / "you may exile a card with the chosen name" work.
import {
  CardType,
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  TypeLine,
  ZoneType,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import type { CardDefinition, EntityId, PaperCard, PlayerSeat, Supertype } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { Card } from "../../card.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const ZONE_BY_NAME: Record<string, ZoneType> = {
  hand: ZoneType.Hand,
  battlefield: ZoneType.Battlefield,
  graveyard: ZoneType.Graveyard,
  exile: ZoneType.Exile,
  library: ZoneType.Library,
};

const synthesizeMakeCardPaper = (name: string): PaperCard => {
  const definition: CardDefinition = {
    name,
    oracle: "",
    types: new TypeLine([] as Supertype[], [CardType.Sorcery], []),
    manaCost: null,
    colors: ColorSet.empty(),
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  };
  return {
    name,
    edition: "MAK",
    collectorNumber: "0",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition,
  };
};

export class MakeCardEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "MakeCard";

  // biome-ignore lint/correctness/useYield: synchronous card synthesis (no events emitted in MVP)
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const name = hasParam(sa, "Name")
      ? evaluateParamRaw(sa, "Name")
      : hasParam(sa, "DefinedName")
        ? evaluateParamRaw(sa, "DefinedName")
        : "Unknown";
    const zoneRaw = hasParam(sa, "Zone") ? evaluateParamRaw(sa, "Zone").toLowerCase().trim() : "hand";
    const zone = ZONE_BY_NAME[zoneRaw] ?? ZoneType.Hand;

    let owner: PlayerSeat = sa.controllerSeat;
    if (hasParam(sa, "Defined")) {
      const def = evaluateParamRaw(sa, "Defined").trim();
      if (def === "Player.Opponent" || def === "Opponent") {
        const n = sa.controllerSeat as unknown as number;
        owner = mkPlayerSeat(n === 0 ? 1 : 0);
      }
    }

    const newId: EntityId = game.newEntityId();
    const paper = synthesizeMakeCardPaper(name);
    const newCard = new Card(newId, paper, owner, owner, zone);
    game.cards.set(newId, newCard);
    const player = game.getPlayer(owner);
    const z = player.zones.get(zone);
    if (z) z.add(newId);

    if (hasParam(sa, "RememberMade") && evaluateParamRaw(sa, "RememberMade") === "True") {
      const source = game.cards.get(sa.sourceCardId);
      if (source) source.remembered.push(newId);
    }
  }
}

effectRegistry.register(MakeCardEffect);
