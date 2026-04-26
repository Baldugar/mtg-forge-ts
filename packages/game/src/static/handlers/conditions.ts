// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 47 — live-evaluators for `Condition$ <name>` flags on Continuous
// statics (Forge keyword conditions). Each evaluator returns true iff
// the condition holds for `controllerSeat` in the current game state.
// The continuous-static handler wraps each layer effect in a guard that
// re-checks the condition on every layer-engine epoch bump (matching the
// Wave 32 contract for asLongAs-style live conditions).
//
// Evaluators implemented:
//   Threshold     — controller has ≥7 cards in graveyard.
//   Hellbent      — controller's hand is empty.
//   Metalcraft    — controller controls ≥3 artifacts.
//   Delirium      — ≥4 distinct card types among cards in controller's GY.
//   FatefulHour   — controller has ≤5 life.
//   Landfall      — controller played a land this turn (Game.flags).
//   Revolt        — a permanent the controller controlled left the
//                   battlefield this turn (Game.flags counter).
//   Spellmastery  — controller has ≥2 instants/sorceries in graveyard.
//
// `Heroic` is normally a trigger-condition (T:Mode$ SpellCast |
// TargetsValid$ Card.Self) and not a static gate; if it appears here we
// default to true (always-on) with a TODO marker. Same defensive default
// for any unrecognised name so the surrounding effect at least applies.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import { CardType, ZoneType } from "@mtg-forge-ts/core";
import type { Card } from "../../card.js";
import type { Game } from "../../game.js";

const cardHasType = (card: Card, ct: CardType): boolean => {
  return card.paperCard.definition?.types?.has(ct) === true;
};

const collectGraveyardCards = (game: Game, seat: PlayerSeat): Card[] => {
  const player = game.players.find((p) => p.seat === seat);
  if (!player) return [];
  const gy = player.zones.get(ZoneType.Graveyard);
  if (!gy) return [];
  const out: Card[] = [];
  for (const id of gy.toArray() as EntityId[]) {
    const c = game.cards.get(id);
    if (c) out.push(c);
  }
  return out;
};

const evalThreshold = (game: Game, seat: PlayerSeat): boolean => {
  const player = game.players.find((p) => p.seat === seat);
  if (!player) return false;
  const gy = player.zones.get(ZoneType.Graveyard);
  return gy !== undefined && gy.size >= 7;
};

const evalHellbent = (game: Game, seat: PlayerSeat): boolean => {
  const player = game.players.find((p) => p.seat === seat);
  if (!player) return false;
  const hand = player.zones.get(ZoneType.Hand);
  return hand !== undefined && hand.size === 0;
};

const evalMetalcraft = (game: Game, seat: PlayerSeat): boolean => {
  let count = 0;
  for (const c of game.cards.values()) {
    if (c.zone !== ZoneType.Battlefield) continue;
    if (c.controllerSeat !== seat) continue;
    if (cardHasType(c as Card, CardType.Artifact)) count++;
    if (count >= 3) return true;
  }
  return false;
};

const evalDelirium = (game: Game, seat: PlayerSeat): boolean => {
  const seen = new Set<CardType>();
  for (const c of collectGraveyardCards(game, seat)) {
    const types = c.paperCard.definition?.types;
    if (!types) continue;
    for (const t of [
      CardType.Artifact,
      CardType.Battle,
      CardType.Creature,
      CardType.Enchantment,
      CardType.Instant,
      CardType.Kindred,
      CardType.Land,
      CardType.Planeswalker,
      CardType.Sorcery,
    ]) {
      if (types.has(t)) seen.add(t);
    }
    if (seen.size >= 4) return true;
  }
  return seen.size >= 4;
};

const evalFatefulHour = (game: Game, seat: PlayerSeat): boolean => {
  const player = game.players.find((p) => p.seat === seat);
  if (!player) return false;
  return player.life <= 5;
};

const evalLandfall = (game: Game, seat: PlayerSeat): boolean => {
  const lands = game.flags.landsPlayedThisTurn.get(seat) ?? 0;
  return lands >= 1;
};

const evalRevolt = (game: Game, seat: PlayerSeat): boolean => {
  const left = game.flags.permanentsLeftBfThisTurn.get(seat) ?? 0;
  return left >= 1;
};

const evalSpellmastery = (game: Game, seat: PlayerSeat): boolean => {
  let count = 0;
  for (const c of collectGraveyardCards(game, seat)) {
    if (cardHasType(c, CardType.Instant) || cardHasType(c, CardType.Sorcery)) count++;
    if (count >= 2) return true;
  }
  return false;
};

/**
 * Evaluate a Forge `Condition$ <name>` flag against the current game
 * state. Returns true when the condition holds (the surrounding static
 * applies); false when it doesn't.
 *
 * Unknown / unrecognised names default to `true` so the effect at least
 * applies — they're tagged with a TODO(advanced-condition) and will be
 * promoted to live evaluators in subsequent waves.
 *
 * Robustness — the function tolerates a "stub Game" shape that lacks
 * `flags` (the threshold-static.test.ts mock for Wave 32 only models a
 * graveyard zone). When `game.flags` is undefined, Landfall/Revolt
 * conservatively return false.
 */
export const evalCondition = (cond: string | undefined, game: Game, seat: PlayerSeat): boolean => {
  if (cond === undefined) return true;
  switch (cond) {
    case "Threshold":
      return evalThreshold(game, seat);
    case "Hellbent":
      return evalHellbent(game, seat);
    case "Metalcraft":
      return evalMetalcraft(game, seat);
    case "Delirium":
      return evalDelirium(game, seat);
    case "FatefulHour":
      return evalFatefulHour(game, seat);
    case "Landfall":
      // Wave 47 — defensive: stub-Game tests may not provide `flags`.
      if (!game.flags) return false;
      return evalLandfall(game, seat);
    case "Revolt":
      if (!game.flags) return false;
      return evalRevolt(game, seat);
    case "Spellmastery":
      return evalSpellmastery(game, seat);
    case "Heroic":
      // CR — Heroic fires from triggers (T:Mode$ SpellCast |
      // TargetsValid$ Card.Self), not static gates. If it appears as
      // a Continuous Condition$, treat as always-on.
      // TODO(advanced-condition): static Heroic.
      return true;
    default:
      // TODO(advanced-condition): unrecognised condition; default true so
      // the surrounding effect at least applies.
      return true;
  }
};
