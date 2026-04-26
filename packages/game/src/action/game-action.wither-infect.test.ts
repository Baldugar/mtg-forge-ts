// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 36 — Wither (CR 702.79) and Infect (CR 702.90) damage redirection.
// Damage from a wither/infect source to a creature is dealt as -1/-1
// counters instead of regular damage. Damage from infect source to a
// player is dealt as poison counters instead of life loss.
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

const aliceLP: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bobLP: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };
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
  cardDataSyncedAt: "2026-04-26T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};
const paper: PaperCard = {
  name: "T",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const ALICE = mkPlayerSeat(0);
const BOB = mkPlayerSeat(1);

const drain = (g: Generator<EngineYield, void, unknown>): EngineYield[] => {
  const out: EngineYield[] = [];
  let s = g.next();
  while (!s.done) {
    out.push(s.value);
    s = g.next();
  }
  return out;
};

const mkFx = () => {
  const game = new Game({ lobbyPlayers: [aliceLP, bobLP], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  const addCard = (id: EntityId, kw?: string) => {
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    if (kw) {
      card.keywords = new Set([kw]);
    }
    game.cards.set(id, card);
    return card;
  };
  return { game, addCard };
};

describe("Wave 36 — Wither / Infect damage redirection (CR 702.79 / 702.90)", () => {
  it("Wither: damage to creature applies as -1/-1 counters, not Card.damage", () => {
    const fx = mkFx();
    const src = mkEntityId(1);
    const tgt = mkEntityId(2);
    fx.addCard(src, "wither");
    const target = fx.addCard(tgt);
    drain(fx.game.action.damage(src, "creature", tgt, 3, true));
    expect(target.damage).toBe(0);
    expect(target.counters.get(CounterType.MinusOneMinusOne)).toBe(3);
  });

  it("Infect to creature applies as -1/-1 counters", () => {
    const fx = mkFx();
    const src = mkEntityId(3);
    const tgt = mkEntityId(4);
    fx.addCard(src, "infect");
    const target = fx.addCard(tgt);
    drain(fx.game.action.damage(src, "creature", tgt, 2, true));
    expect(target.damage).toBe(0);
    expect(target.counters.get(CounterType.MinusOneMinusOne)).toBe(2);
  });

  it("Infect to player applies as poison counters, not life loss", () => {
    const fx = mkFx();
    const src = mkEntityId(5);
    fx.addCard(src, "infect");
    const bob = fx.game.players.find((p) => p.seat === BOB);
    if (!bob) throw new Error("no Bob");
    const initialLife = bob.life;
    drain(fx.game.action.damage(src, "player", BOB, 2, true));
    expect(bob.life).toBe(initialLife);
    expect(bob.counters.get(CounterType.Poison)).toBe(2);
  });

  it("Non-wither/infect source damages creature normally (regression)", () => {
    const fx = mkFx();
    const src = mkEntityId(6);
    const tgt = mkEntityId(7);
    fx.addCard(src);
    const target = fx.addCard(tgt);
    drain(fx.game.action.damage(src, "creature", tgt, 2, true));
    expect(target.damage).toBe(2);
    expect(target.counters.get(CounterType.MinusOneMinusOne)).toBeUndefined();
  });

  it("Wither source to player still uses regular life loss (only Infect redirects to poison)", () => {
    const fx = mkFx();
    const src = mkEntityId(8);
    fx.addCard(src, "wither");
    const bob = fx.game.players.find((p) => p.seat === BOB);
    if (!bob) throw new Error("no Bob");
    const initialLife = bob.life;
    drain(fx.game.action.damage(src, "player", BOB, 3, true));
    expect(bob.life).toBe(initialLife - 3);
    expect(bob.counters.get(CounterType.Poison) ?? 0).toBe(0);
  });
});
