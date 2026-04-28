// SPDX-License-Identifier: GPL-3.0-or-later
// SeekEffect — Forge `SP$ Seek` (Choice of Fortunes, Circadian Struggle).
// CR 701.50: search your library for a card matching a description, put it
// into your hand, then shuffle. Unlike `Search` (a tutor with full
// visibility), `Seek` reveals only the chosen card — no hand-searching.
//
// Forge DSL examples:
//   A:SP$ Seek | Num$ 2 | RememberFound$ True
//   A:SP$ Seek | Num$ X | Type$ Card.SharesColorWith ... | RememberFound$ True
//
// MVP scope:
//   - Num$ N — total cards to seek (default 1).
//   - Type$ <filter> — filter applied to library candidates (default "Card").
//   - For each successful seek, pick the FIRST matching card by library
//     order (deterministic; Forge's randomized fallback is SP4).
//   - Move chosen card to controller's Hand and append to source.remembered
//     when RememberFound$ True.
//   - Library remains shuffled deterministically (no shuffle yield in MVP —
//     Forge's seek is described as a search-without-revealing, mechanically
//     equivalent to "reveal one matching, put in hand"; SP4 hooks shuffle).
import { CardType, GameStateIntegrityError, ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { canSearchLibrary } from "../../statics/wave60-cant-gates.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const matchesSeekFilter = (game: Game, cardId: EntityId, filter: string): boolean => {
  const tokens = filter.split(/[.+]/).map((t) => t.trim().toLowerCase());
  const chars = game.layerEngine.computeCharacteristics(cardId);
  for (const t of tokens) {
    if (!t || t === "card") continue;
    if (t === "creature" && !chars.types.has(CardType.Creature)) return false;
    if (t === "artifact" && !chars.types.has(CardType.Artifact)) return false;
    if (t === "enchantment" && !chars.types.has(CardType.Enchantment)) return false;
    if (t === "land" && !chars.types.has(CardType.Land)) return false;
    if (t === "instant" && !chars.types.has(CardType.Instant)) return false;
    if (t === "sorcery" && !chars.types.has(CardType.Sorcery)) return false;
    if (t === "nonland" && chars.types.has(CardType.Land)) return false;
    // Other tokens (sharescolorwith, valid, permanent.youctrl, etc.) are
    // pass-through for the MVP — SP4 will plug the full filter AST.
  }
  return true;
};

export class SeekEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Seek";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "Num") ? evaluateParamNumber(sa, "Num", game) : 1;
    const filter = hasParam(sa, "Type") ? evaluateParamRaw(sa, "Type") : "Card";
    const seat = sa.controllerSeat;
    // Wave 60.H — CR 701.18 search-prevention static. Mindlock Orb /
    // Stranglehold gate the library scan; on a match no card is found,
    // no reveal fires, no move happens. Forge's silent-skip semantics.
    if (!canSearchLibrary(game, seat)) {
      return;
    }
    const player = game.getPlayer(seat);
    const library = player.zones.get(ZoneType.Library);
    if (!library) throw new GameStateIntegrityError(`SeekEffect: player ${seat} has no Library zone`);

    const remembered = hasParam(sa, "RememberFound") && evaluateParamRaw(sa, "RememberFound") === "True";
    const source = game.cards.get(sa.sourceCardId);

    for (let i = 0; i < num; i++) {
      const ids = library.toArray();
      let found: EntityId | null = null;
      for (const id of ids) {
        if (matchesSeekFilter(game, id, filter)) {
          found = id;
          break;
        }
      }
      if (found === null) break;
      // Reveal then move-to-hand.
      yield game.emitEvent(
        mkEvent("CardsRevealed", game.turn, game.phase, {
          revealedBy: seat,
          revealedTo: "all",
          cardIds: [found],
          fromZone: ZoneType.Library,
        }),
      );
      yield* game.action.moveTo(found, ZoneType.Hand, { toSeat: seat, cause: "seek" });
      if (remembered && source) source.remembered.push(found);
    }
  }
}

effectRegistry.register(SeekEffect);
