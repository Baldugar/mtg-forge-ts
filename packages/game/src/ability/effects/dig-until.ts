// SPDX-License-Identifier: GPL-3.0-or-later
// DigUntilEffect — Forge `SP$ DigUntil` / `DB$ DigUntil` (Diabolic Tutor's
// "reveal until you find" family — DigLand / DigNonland subroutines).
// Reveals cards from the top of the controller's library one at a time,
// stopping when N cards matching the filter have been revealed.
//
// Matching cards go to FoundDestination$; non-matching to RevealedDestination$.
//
// Forge DSL examples:
//   SVar:DigLand:DB$ DigUntil | Valid$ Card.Land | FoundDestination$ Hand
//                            | RevealedDestination$ Library | RevealedLibraryPosition$ -1
//
// MVP scope:
//   - Amount$ (or default 1) cards to find.
//   - Valid$ Card.<Type> filter (Land / nonLand / Creature / Artifact / Enchantment).
//   - FoundDestination$ Hand|Graveyard|Exile|Battlefield (default Hand).
//   - RevealedDestination$ Library|Graveyard|Exile (default Library, bottom).
//   - RevealedLibraryPosition$ -1 → bottom; 0 → top (default bottom for Forge).
import type { EntityId } from "@mtg-forge-ts/core";
import { CardType, GameStateIntegrityError, ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const ZONE_BY_NAME: Record<string, ZoneType> = {
  hand: ZoneType.Hand,
  graveyard: ZoneType.Graveyard,
  exile: ZoneType.Exile,
  battlefield: ZoneType.Battlefield,
  library: ZoneType.Library,
};

const matchesValid = (game: Game, cardId: EntityId, filter: string): boolean => {
  const tokens = filter.split(".").map((t) => t.trim());
  const head = tokens[0] ?? "";
  if (head !== "Card") return true;
  const rest = tokens[1] ?? "";
  if (!rest) return true;
  const sub = rest.split("+").map((t) => t.trim().toLowerCase());
  const chars = game.layerEngine.computeCharacteristics(cardId);
  for (const t of sub) {
    if (t === "land" && !chars.types.has(CardType.Land)) return false;
    if (t === "nonland" && chars.types.has(CardType.Land)) return false;
    if (t === "creature" && !chars.types.has(CardType.Creature)) return false;
    if (t === "artifact" && !chars.types.has(CardType.Artifact)) return false;
    if (t === "enchantment" && !chars.types.has(CardType.Enchantment)) return false;
    if (t === "instant" && !chars.types.has(CardType.Instant)) return false;
    if (t === "sorcery" && !chars.types.has(CardType.Sorcery)) return false;
  }
  return true;
};

export class DigUntilEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "DigUntil";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const seat = sa.controllerSeat;
    const player = game.getPlayer(seat);
    const library = player.zones.get(ZoneType.Library);
    if (!library) throw new GameStateIntegrityError(`DigUntilEffect: player ${seat} has no Library zone`);

    const need = hasParam(sa, "Amount") ? evaluateParamNumber(sa, "Amount", game) : 1;
    const filter = hasParam(sa, "Valid") ? evaluateParamRaw(sa, "Valid") : "Card";
    const foundZone =
      ZONE_BY_NAME[
        (hasParam(sa, "FoundDestination") ? evaluateParamRaw(sa, "FoundDestination") : "Hand").toLowerCase()
      ] ?? ZoneType.Hand;
    const revealedZone =
      ZONE_BY_NAME[
        (hasParam(sa, "RevealedDestination")
          ? evaluateParamRaw(sa, "RevealedDestination")
          : "Library"
        ).toLowerCase()
      ] ?? ZoneType.Library;
    const libPosRaw = hasParam(sa, "RevealedLibraryPosition")
      ? evaluateParamRaw(sa, "RevealedLibraryPosition")
      : "-1";
    const toBottom = libPosRaw.trim() === "-1";

    const found: EntityId[] = [];
    const revealed: EntityId[] = [];

    // Pull cards one at a time off the top until we find `need` or run out.
    while (found.length < need) {
      const topId = library.peekAt(0);
      if (topId === undefined) break;
      library.removeAt(0);
      if (matchesValid(game, topId, filter)) {
        found.push(topId);
      } else {
        revealed.push(topId);
      }
    }

    // Emit a CardsRevealed event for the union — Forge's DigUntil reveals
    // every drawn card to all players.
    const allIds = [...found, ...revealed];
    if (allIds.length > 0) {
      yield game.emitEvent(
        mkEvent("CardsRevealed", game.turn, game.phase, {
          revealedBy: seat,
          revealedTo: "all",
          cardIds: allIds,
          fromZone: ZoneType.Library,
        }),
      );
    }

    // Move found cards to FoundDestination$.
    for (const id of found) {
      // Re-seat in library so locate() succeeds in moveTo.
      library.add(id);
      yield* game.action.moveTo(id, foundZone, { toSeat: seat, cause: "digUntil" });
    }

    // Send revealed cards to RevealedDestination$.
    if (revealedZone === ZoneType.Library) {
      // Direct re-seat onto library — same pattern as DigEffect.
      if (toBottom) {
        for (const id of revealed) library.add(id);
      } else {
        for (let i = revealed.length - 1; i >= 0; i--) {
          const id = revealed[i];
          if (id !== undefined) library.addToTop(id);
        }
      }
    } else {
      for (const id of revealed) {
        library.add(id);
        yield* game.action.moveTo(id, revealedZone, { toSeat: seat, cause: "digUntil" });
      }
    }
  }
}

effectRegistry.register(DigUntilEffect);
