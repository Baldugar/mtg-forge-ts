// SPDX-License-Identifier: GPL-3.0-or-later
// CombatHandler combat-damage transfer integration — Wave 27. Verifies
// that an attacker dealing combat damage to a player who currently holds
// the initiative (CR 906.4b) or the monarchy (CR 716.4b) transfers the
// title to the attacker's controller.
import type { Characteristics, EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  ZoneType,
  emptyCharacteristics,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import { Card } from "../card.js";
import { grantInitiative } from "../dnd/initiative-tracker.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { grantMonarch } from "../monarch/monarch-tracker.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { CombatHandler } from "./combat-handler.js";

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

const seedZones = (game: Game): void => {
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
};

interface Fixture {
  game: Game;
  handler: CombatHandler;
  setStats: (id: EntityId, power: number, toughness: number) => void;
}

const mkFixture = (): Fixture => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  seedZones(game);
  const stats = new Map<EntityId, { power: number; toughness: number }>();
  const orig = game.layerEngine.computeCharacteristics.bind(game.layerEngine);
  game.layerEngine.computeCharacteristics = (id: EntityId): Characteristics => {
    const s = stats.get(id);
    if (!s) return orig(id);
    const c = emptyCharacteristics();
    c.power = s.power;
    c.toughness = s.toughness;
    return c;
  };
  const handler = new CombatHandler(game);
  return { game, handler, setStats: (id, p, t) => stats.set(id, { power: p, toughness: t }) };
};

const addCard = (game: Game, seat: PlayerSeat, id: EntityId): void => {
  const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
  game.cards.set(id, card);
  const z = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  if (!z) throw new Error("missing zone");
  z.add(id);
};

const drain = (gen: Generator<EngineYield, void, unknown>): EngineYield[] => {
  const out: EngineYield[] = [];
  let step = gen.next();
  while (!step.done) {
    out.push(step.value);
    step = gen.next();
  }
  return out;
};

describe("CombatHandler — Initiative + Monarch combat-damage transfer", () => {
  it("attacker deals combat damage to the initiative-holder → initiative moves to attacker's controller", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    addCard(fx.game, seatA, attacker);
    fx.setStats(attacker, 2, 2);
    grantInitiative(fx.game, seatB);
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "player", seat: seatB } }]);

    drain(fx.handler.dealDamage(false));
    expect(fx.game.flags.initiative).toBe(seatA);
  });

  it("attacker deals combat damage to the monarch → monarchy moves to attacker's controller", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(2);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    addCard(fx.game, seatA, attacker);
    fx.setStats(attacker, 3, 3);
    grantMonarch(fx.game, seatB);
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "player", seat: seatB } }]);

    drain(fx.handler.dealDamage(false));
    expect(fx.game.flags.monarch).toBe(seatA);
  });

  it("attacker deals combat damage to a non-holder → no transfer", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(3);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    addCard(fx.game, seatA, attacker);
    fx.setStats(attacker, 2, 2);
    // seatA is the monarch and the initiative-holder; attacker is seatA's
    // creature attacking seatB. seatB is NOT the holder, so nothing
    // transfers.
    grantMonarch(fx.game, seatA);
    grantInitiative(fx.game, seatA);
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "player", seat: seatB } }]);

    drain(fx.handler.dealDamage(false));
    expect(fx.game.flags.monarch).toBe(seatA);
    expect(fx.game.flags.initiative).toBe(seatA);
  });

  it("0-power attacker doesn't transfer initiative even if defender is the holder", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(4);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    addCard(fx.game, seatA, attacker);
    fx.setStats(attacker, 0, 2);
    grantInitiative(fx.game, seatB);
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "player", seat: seatB } }]);

    drain(fx.handler.dealDamage(false));
    expect(fx.game.flags.initiative).toBe(seatB);
  });
});
