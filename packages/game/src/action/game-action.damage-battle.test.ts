// SPDX-License-Identifier: GPL-3.0-or-later
// GameAction.damage — battle target (CR 310.5, Task 51). Damage dealt to
// a battle removes that many Defense counters. When the last counter is
// removed, the SBA sweep (Task 30, CR 704.5s) exiles the battle.
import type { EntityId, LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import type { EngineYield } from "./engine-yield.js";

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
const paper: PaperCard = {
  name: "T",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkFx = () => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  const seat = mkPlayerSeat(0);
  const addBattle = (id: EntityId, defense: number) => {
    const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
    card.counters.set(CounterType.Defense, defense);
    game.cards.set(id, card);
    return card;
  };
  const addSource = (id: EntityId) => {
    const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
    game.cards.set(id, card);
    return card;
  };
  return { game, addBattle, addSource };
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

describe("GameAction.damage with targetKind='battle' (Task 51, CR 310.5)", () => {
  it("3 damage to a 5-defense battle leaves 2 Defense counters", () => {
    const fx = mkFx();
    const src = mkEntityId(1);
    const battleId = mkEntityId(10);
    fx.addSource(src);
    const battle = fx.addBattle(battleId, 5);
    drain(fx.game.action.damage(src, "battle", battleId, 3, true));
    expect(battle.counters.get(CounterType.Defense)).toBe(2);
  });

  it("5 damage to a 5-defense battle removes all counters (0 → delete)", () => {
    const fx = mkFx();
    const src = mkEntityId(1);
    const battleId = mkEntityId(10);
    fx.addSource(src);
    const battle = fx.addBattle(battleId, 5);
    drain(fx.game.action.damage(src, "battle", battleId, 5, true));
    expect(battle.counters.has(CounterType.Defense)).toBe(false);
  });

  it("10 damage to a 5-defense battle clamps to 0 (no negative)", () => {
    const fx = mkFx();
    const src = mkEntityId(1);
    const battleId = mkEntityId(10);
    fx.addSource(src);
    const battle = fx.addBattle(battleId, 5);
    drain(fx.game.action.damage(src, "battle", battleId, 10, true));
    expect(battle.counters.has(CounterType.Defense)).toBe(false);
  });

  it("emits DamageDealt with targetKind='battle'", () => {
    const fx = mkFx();
    const src = mkEntityId(1);
    const battleId = mkEntityId(10);
    fx.addSource(src);
    fx.addBattle(battleId, 3);
    const yields = drain(fx.game.action.damage(src, "battle", battleId, 2, true));
    const evt = yields.find((y) => y.kind === "event" && y.event.kind === "DamageDealt");
    expect(evt).toBeDefined();
    if (evt && evt.kind === "event" && evt.event.kind === "DamageDealt") {
      expect(evt.event.payload.targetKind).toBe("battle");
      expect(evt.event.payload.amount).toBe(2);
    }
  });

  it("0 damage is a no-op on counters", () => {
    const fx = mkFx();
    const src = mkEntityId(1);
    const battleId = mkEntityId(10);
    fx.addSource(src);
    const battle = fx.addBattle(battleId, 4);
    drain(fx.game.action.damage(src, "battle", battleId, 0, true));
    expect(battle.counters.get(CounterType.Defense)).toBe(4);
  });
});
