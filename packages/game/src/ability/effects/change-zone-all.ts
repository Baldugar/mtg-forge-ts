// SPDX-License-Identifier: GPL-3.0-or-later
// ChangeZoneAllEffect — moves all permanents matching ValidCards$ from
// Origin$ zone to Destination$ zone. Mass bounce / mass exile (26 cards).
//
// Forge DSL:
//   SP$ ChangeZoneAll | Cost$ 4 U | ValidCards$ Creature | Origin$ Battlefield | Destination$ Hand
//   SP$ ChangeZoneAll | Cost$ 5 U U | ValidCards$ Artifact | Origin$ Battlefield | Destination$ Exile
//
// Supported ValidCards$ filter tokens (MVP — same set as DestroyAll):
//   Creature / Creature.YouCtrl / Creature.OpponentCtrl
//   Artifact / Enchantment / Land / Permanent
//
// MVP destinations: Hand, Graveyard, Exile. Library moves require shuffle logic
// (SP3+) and are deferred; they return a "not implemented" warning as a no-op.
//
// Hand moves route to the card's ownerSeat (bounce is owner-targeted per CR).
// Cards are collected first, then moved (simultaneous semantics, CR 700.7).
import { CardType, ZoneType } from "@mtg-forge-ts/core";
import type { EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const ZONE_MAP: Readonly<Record<string, ZoneType>> = {
  Battlefield: ZoneType.Battlefield,
  Graveyard: ZoneType.Graveyard,
  Exile: ZoneType.Exile,
  Hand: ZoneType.Hand,
  Library: ZoneType.Library,
};

function parseZone(raw: string): ZoneType | undefined {
  return ZONE_MAP[raw];
}

/** Collect all card ids in the origin zone matching the ValidCards$ filter.
 *  The origin zone is read from Origin$ param (default: Battlefield). */
function collectMatching(sa: SpellAbility, game: Game, originZone: ZoneType): EntityId[] {
  const filterRaw = hasParam(sa, "ValidCards") ? evaluateParamRaw(sa, "ValidCards") : "Creature";
  const tokens = filterRaw.split(".").map((t) => t.trim().toLowerCase());
  const baseType = tokens[0] ?? "creature";
  const qualifier = tokens[1] ?? "";

  const matched: EntityId[] = [];
  for (const [id, card] of game.cards) {
    // Zone guard: only collect from the specified origin zone (CR 700.7).
    if (card.zone !== originZone) continue;

    const chars = game.layerEngine.computeCharacteristics(id);

    if (baseType !== "permanent") {
      if (baseType === "creature" && !chars.types.has(CardType.Creature)) continue;
      if (baseType === "artifact" && !chars.types.has(CardType.Artifact)) continue;
      if (baseType === "enchantment" && !chars.types.has(CardType.Enchantment)) continue;
      if (baseType === "land" && !chars.types.has(CardType.Land)) continue;
    }

    if (qualifier === "youctrl" && card.controllerSeat !== sa.controllerSeat) continue;
    if (qualifier === "opponentctrl" && card.controllerSeat === sa.controllerSeat) continue;

    matched.push(id);
  }
  return matched;
}

export class ChangeZoneAllEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ChangeZoneAll";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const destRaw = hasParam(sa, "Destination") ? evaluateParamRaw(sa, "Destination") : undefined;
    if (!destRaw) return;

    const destZone = parseZone(destRaw);
    if (destZone === undefined) return;

    // Library moves require shuffle — deferred to SP3+.
    if (destZone === ZoneType.Library) return;

    // Determine origin zone from Origin$ param (default: Battlefield).
    const originRaw = hasParam(sa, "Origin") ? evaluateParamRaw(sa, "Origin") : "Battlefield";
    const originZone = parseZone(originRaw) ?? ZoneType.Battlefield;

    // Collect targets before any moves (simultaneous semantics, CR 700.7).
    const targets = collectMatching(sa, game, originZone);

    for (const cardId of targets) {
      const card = game.cards.get(cardId);
      if (!card) continue;

      if (destZone === ZoneType.Hand && card.ownerSeat !== undefined) {
        // Bounce goes to the owner's hand (CR).
        yield* game.action.moveTo(cardId, destZone, { toSeat: card.ownerSeat, cause: "effect" });
      } else {
        yield* game.action.moveTo(cardId, destZone, { cause: "effect" });
      }
    }
  }
}

effectRegistry.register(ChangeZoneAllEffect);
