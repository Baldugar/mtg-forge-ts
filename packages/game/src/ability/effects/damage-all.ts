// SPDX-License-Identifier: GPL-3.0-or-later
// DamageAllEffect — deals NumDmg damage to all permanents matching ValidCards$.
// Pyroclasm, Earthquake, Inferno, etc. (31 cards in corpus).
//
// Forge DSL:
//   SP$ DamageAll | Cost$ 2 R | NumDmg$ 2 | ValidCards$ Creature
//   SP$ DamageAll | Cost$ X R | NumDmg$ X | ValidCards$ Creature
//   SP$ DamageAll | NumDmg$ 1 | ValidCards$ Creature.OppCtrl | ValidPlayers$ Opponent
//
// Supported ValidCards$ filter tokens (MVP — same set as DestroyAll):
//   Creature            — any Creature on battlefield
//   Creature.YouCtrl    — Creature controlled by sa.controllerSeat
//   Creature.OpponentCtrl / Creature.OppCtrl — Creature NOT controlled by sa.controllerSeat
//   Artifact            — any Artifact on battlefield
//   Enchantment         — any Enchantment on battlefield
//   Land                — any Land on battlefield
//   Permanent           — any permanent on battlefield
//
// ValidPlayers$ — also damage players (Goblin Chainwhirler / Pyroclasm-vs-
// players family). Recognised tokens: Each / Opponent / You.
//
// Cards are collected first, then damage is dealt to all simultaneously
// per CR 700.7; SBAs afterwards clean up creatures with lethal damage.
import { CardType, ZoneType, mkPlayerSeat } from "@mtg-forge-ts/core";
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

/** Collect all card ids on the battlefield matching the ValidCards$ filter. */
function collectMatching(sa: SpellAbility, game: Game): EntityId[] {
  const filterRaw = hasParam(sa, "ValidCards") ? evaluateParamRaw(sa, "ValidCards") : "Creature";
  const tokens = filterRaw.split(".").map((t) => t.trim().toLowerCase());
  const baseType = tokens[0] ?? "creature";
  const qualifier = tokens[1] ?? "";

  const matched: EntityId[] = [];
  for (const [id, card] of game.cards) {
    // Zone guard: DamageAll targets battlefield permanents only (CR 700.7).
    if (card.zone !== ZoneType.Battlefield) continue;

    const chars = game.layerEngine.computeCharacteristics(id);

    if (baseType !== "permanent") {
      if (baseType === "creature" && !chars.types.has(CardType.Creature)) continue;
      if (baseType === "artifact" && !chars.types.has(CardType.Artifact)) continue;
      if (baseType === "enchantment" && !chars.types.has(CardType.Enchantment)) continue;
      if (baseType === "land" && !chars.types.has(CardType.Land)) continue;
    }

    if (qualifier === "youctrl" && card.controllerSeat !== sa.controllerSeat) continue;
    if (
      (qualifier === "opponentctrl" || qualifier === "oppctrl") &&
      card.controllerSeat === sa.controllerSeat
    )
      continue;

    matched.push(id);
  }
  return matched;
}

/**
 * M6.39 — Resolve `ValidPlayers$` to the list of seats taking damage.
 * Forge tokens: `Each` (both players), `Opponent`/`Opponents` (every
 * non-controller seat), `You` (controller only). Returns an empty list
 * when the param is absent.
 */
function collectPlayerRecipients(sa: SpellAbility, game: Game): readonly PlayerSeat[] {
  if (!hasParam(sa, "ValidPlayers")) return [];
  const raw = evaluateParamRaw(sa, "ValidPlayers").trim();
  const seats: PlayerSeat[] = [];
  for (const player of game.players) {
    const seat = player.seat;
    const isController = seat === sa.controllerSeat;
    if (raw === "Each") seats.push(seat);
    else if (raw === "Opponent" || raw === "Opponents") {
      if (!isController) seats.push(seat);
    } else if (raw === "You") {
      if (isController) seats.push(seat);
    }
  }
  // Defensive: if no players matched but the engine has only one player
  // map (test fixtures), fall back to the single non-controller seat
  // synthesised from controllerSeat.
  if (seats.length === 0 && game.players.length < 2 && raw !== "You") {
    const oppSeatNum = (sa.controllerSeat as unknown as number) === 0 ? 1 : 0;
    seats.push(mkPlayerSeat(oppSeatNum));
  }
  return seats;
}

export class DamageAllEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "DamageAll";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const amount = evaluateParamNumber(sa, "NumDmg", game);
    // Collect targets first (simultaneous damage semantics, CR 700.7).
    const targets = collectMatching(sa, game);
    const playerRecipients = collectPlayerRecipients(sa, game);

    for (const cardId of targets) {
      yield* game.action.damage(sa.sourceCardId, "creature", cardId, amount, false);
    }
    for (const seat of playerRecipients) {
      yield* game.action.damage(sa.sourceCardId, "player", seat as unknown as EntityId, amount, false);
    }
  }
}

effectRegistry.register(DamageAllEffect);
