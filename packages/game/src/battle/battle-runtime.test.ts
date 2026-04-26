// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 34 — Battle card type runtime smoke tests.
// Covers:
//   1. ETB stamps Defense counters from PaperCard.definition.defense.
//   2. Protector seat is auto-picked on ETB (single opponent) and stamped.
//   3. Damage to a Battle decrements Defense counters (existing path).
//   4. SBA on Defense=0 emits BattleDefeated and exiles the card.
import type { CardDefinition, EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";

const alice: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };

const rules: GameRules = {
  formatId: "standard",
  startingLife: 20,
  startingHandSize: 7,
  mulliganRule: "london",
  firstPlayerSkipsDraw: true,
  ruleOverrides: [],
  playerCount: { min: 2, max: 2 },
  poisonCountersToLose: 10,
  playForAnte: false,
  manaBurn: false,
  appliedVariants: [],
};

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "abc",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const mkBattleDef = (defense: string, name = "Invasion of Arcavios"): CardDefinition => ({
  name,
  oracle: "",
  types: TypeLine.parse("Battle — Siege"),
  manaCost: { raw: "2UU", symbols: [] },
  defense,
  abilities: [],
  triggers: [],
  replacements: [],
  statics: [],
  keywords: [],
  svars: new Map(),
});

const mkPlaneswalkerDef = (loyalty: string, name = "Jace, Mind Sculptor"): CardDefinition => ({
  name,
  oracle: "",
  types: TypeLine.parse("Legendary Planeswalker — Jace"),
  manaCost: { raw: "2UU", symbols: [] },
  loyalty,
  abilities: [],
  triggers: [],
  replacements: [],
  statics: [],
  keywords: [],
  svars: new Map(),
});

const mkPaper = (definition: CardDefinition): PaperCard => ({
  name: definition.name,
  edition: "MOM",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition,
});

const seedZones = (game: Game): void => {
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
};

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  seedZones(game);
  return game;
};

const drain = (g: Generator<EngineYield, void, unknown>): EngineYield[] => {
  const out: EngineYield[] = [];
  let s = g.next();
  while (!s.done) {
    out.push(s.value);
    s = g.next();
  }
  return out;
};

const addCardInHand = (game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, ZoneType.Hand);
  game.cards.set(id, card);
  const hand = game.getPlayer(seat).zones.get(ZoneType.Hand);
  if (!hand) throw new Error("test: missing hand");
  hand.add(id);
  return card;
};

describe("Wave 34 — Battle ETB stamping (CR 310.7)", () => {
  it("stamps Defense counters from definition.defense on ETB", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const battle = addCardInHand(game, mkPaper(mkBattleDef("5")), seat, id);
    drain(game.action.moveTo(id, ZoneType.Battlefield, { toSeat: seat }));
    expect(battle.zone).toBe(ZoneType.Battlefield);
    expect(battle.counters.get(CounterType.Defense)).toBe(5);
  });

  it("stamps Loyalty counters on Planeswalker ETB", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    const pw = addCardInHand(game, mkPaper(mkPlaneswalkerDef("4")), seat, id);
    drain(game.action.moveTo(id, ZoneType.Battlefield, { toSeat: seat }));
    expect(pw.zone).toBe(ZoneType.Battlefield);
    expect(pw.counters.get(CounterType.Loyalty)).toBe(4);
  });

  it("auto-picks the sole opponent as protectorSeat on Battle ETB", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const opp = mkPlayerSeat(1);
    const id = mkEntityId(1);
    const battle = addCardInHand(game, mkPaper(mkBattleDef("3")), seat, id);
    drain(game.action.moveTo(id, ZoneType.Battlefield, { toSeat: seat }));
    expect(battle.protectorSeat).toBe(opp);
  });

  it("does not stamp Defense if definition.defense is missing or non-numeric", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(1);
    // Skip the defense field entirely.
    const def: CardDefinition = {
      name: "Battle Without Defense",
      oracle: "",
      types: TypeLine.parse("Battle — Siege"),
      manaCost: { raw: "2", symbols: [] },
      abilities: [],
      triggers: [],
      replacements: [],
      statics: [],
      keywords: [],
      svars: new Map(),
    };
    const battle = addCardInHand(game, mkPaper(def), seat, id);
    drain(game.action.moveTo(id, ZoneType.Battlefield, { toSeat: seat }));
    expect(battle.counters.get(CounterType.Defense)).toBeUndefined();
  });
});

// Plain non-Battle creature paper for the damage source so SBA collector
// doesn't treat it as a Battle.
const mkSourcePaper = (): PaperCard => ({
  name: "Source Bear",
  edition: "MOM",
  collectorNumber: "999",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name: "Source Bear",
    oracle: "",
    types: TypeLine.parse("Creature — Bear"),
    manaCost: { raw: "1G", symbols: [] },
    pt: { power: "2", toughness: "2" },
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  },
});

describe("Wave 34 — Battle damage + defeat path (CR 310.5 / 704.5s)", () => {
  it("damage to a Battle decrements Defense counters", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const battleId = mkEntityId(10);
    const srcId = mkEntityId(20);
    const battle = addCardInHand(game, mkPaper(mkBattleDef("4")), seat, battleId);
    // Source on the battlefield (a creature, not a battle).
    const src = new Card(srcId, mkSourcePaper(), seat, seat, ZoneType.Battlefield);
    game.cards.set(srcId, src);
    const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
    if (bf) bf.add(srcId);
    drain(game.action.moveTo(battleId, ZoneType.Battlefield, { toSeat: seat }));
    drain(game.action.damage(srcId, "battle", battleId, 2, true));
    expect(battle.counters.get(CounterType.Defense)).toBe(2);
  });

  it("when Defense reaches 0, SBA exiles the Battle and emits BattleDefeated", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const battleId = mkEntityId(10);
    const srcId = mkEntityId(20);
    const battle = addCardInHand(game, mkPaper(mkBattleDef("3")), seat, battleId);
    const src = new Card(srcId, mkSourcePaper(), seat, seat, ZoneType.Battlefield);
    game.cards.set(srcId, src);
    const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
    if (bf) bf.add(srcId);
    drain(game.action.moveTo(battleId, ZoneType.Battlefield, { toSeat: seat }));
    drain(game.action.damage(srcId, "battle", battleId, 5, true));
    expect(battle.counters.get(CounterType.Defense) ?? 0).toBe(0);
    // Run SBA sweep — should detect zero-Defense and exile + emit event.
    const yields: EngineYield[] = [];
    const gen = game.sbaEngine.sweep();
    let step = gen.next();
    while (!step.done) {
      yields.push(step.value);
      step = gen.next();
    }
    expect(battle.zone).toBe(ZoneType.Exile);
    expect(battle.battleDefeated).toBe(true);
    const defeated = yields.find((y) => y.kind === "event" && y.event.kind === "BattleDefeated");
    expect(defeated).toBeDefined();
    if (defeated && defeated.kind === "event" && defeated.event.kind === "BattleDefeated") {
      expect(defeated.event.payload.cardId).toBe(battleId);
    }
  });
});
