// SPDX-License-Identifier: GPL-3.0-or-later
// CombatHandler.dealDamage (SP2 Task 46) — generator walks attackers +
// blockers and emits damage events through GameAction.damage. Tests wire
// per-card P/T by stubbing LayerEngine.computeCharacteristics because
// SP2's base-characteristics pipeline only populates `name` from the
// PaperCard (full P/T sourcing lands in SP4 with the CardDb); and none
// of Layer 7's effect arrays are per-card.
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
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
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

interface TestFixture {
  readonly game: Game;
  readonly handler: CombatHandler;
  readonly setStats: (id: EntityId, power: number, toughness: number) => void;
}

const mkFixture = (): TestFixture => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  seedZones(game);
  const perCardStats = new Map<EntityId, { power: number; toughness: number }>();
  // Stub computeCharacteristics for deterministic per-card P/T. Preserves
  // the base field shape (name etc.) so other consumers don't blow up.
  const orig = game.layerEngine.computeCharacteristics.bind(game.layerEngine);
  game.layerEngine.computeCharacteristics = (id: EntityId): Characteristics => {
    const s = perCardStats.get(id);
    if (s === undefined) return orig(id);
    const chars = emptyCharacteristics();
    chars.power = s.power;
    chars.toughness = s.toughness;
    return chars;
  };
  const handler = new CombatHandler(game);
  return {
    game,
    handler,
    setStats: (id, power, toughness) => {
      perCardStats.set(id, { power, toughness });
    },
  };
};

const addCard = (game: Game, seat: PlayerSeat, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
  game.cards.set(id, card);
  const z = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  if (!z) throw new Error("test: missing battlefield");
  z.add(id);
  return card;
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

const damageEvents = (
  yields: readonly EngineYield[],
): Array<{
  sourceId: EntityId;
  targetKind: string;
  targetId: EntityId | PlayerSeat;
  amount: number;
}> => {
  const out: Array<{
    sourceId: EntityId;
    targetKind: string;
    targetId: EntityId | PlayerSeat;
    amount: number;
  }> = [];
  for (const y of yields) {
    if (y.kind !== "event") continue;
    if (y.event.kind !== "DamageDealt") continue;
    out.push({
      sourceId: y.event.payload.sourceId,
      targetKind: y.event.payload.targetKind,
      targetId: y.event.payload.targetId,
      amount: y.event.payload.amount,
    });
  }
  return out;
};

describe("CombatHandler.dealDamage (SP2 Task 46)", () => {
  it("unblocked 3/3 attacker deals 3 to declared player defender", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    addCard(fx.game, seatA, attacker);
    fx.setStats(attacker, 3, 3);
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "player", seat: seatB } }]);

    const yields = drain(fx.handler.dealDamage(false));
    const dmg = damageEvents(yields);
    expect(dmg).toHaveLength(1);
    expect(dmg[0]?.sourceId).toBe(attacker);
    expect(dmg[0]?.targetKind).toBe("player");
    expect(dmg[0]?.targetId).toBe(seatB);
    expect(dmg[0]?.amount).toBe(3);
  });

  it("unblocked 0-power attacker emits no damage event", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    addCard(fx.game, seatA, attacker);
    fx.setStats(attacker, 0, 1);
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "player", seat: seatB } }]);

    const yields = drain(fx.handler.dealDamage(false));
    expect(damageEvents(yields)).toHaveLength(0);
  });

  it("negative-power attacker (clamped to 0 per CR 104.3m) emits no damage", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    addCard(fx.game, seatA, attacker);
    fx.setStats(attacker, -3, 1);
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "player", seat: seatB } }]);

    const yields = drain(fx.handler.dealDamage(false));
    expect(damageEvents(yields)).toHaveLength(0);
  });

  it("blocked 3/3 attacker with one 2/2 blocker — default assigns 3 to blocker", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const blocker = mkEntityId(10);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    addCard(fx.game, seatA, attacker);
    addCard(fx.game, seatB, blocker);
    fx.setStats(attacker, 3, 3);
    fx.setStats(blocker, 2, 2);
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "player", seat: seatB } }]);
    fx.handler.declareBlockers([{ blockerId: blocker, attackerIds: [attacker] }]);
    fx.handler.setBlockerOrder(attacker, [blocker]);

    const yields = drain(fx.handler.dealDamage(false));
    const dmg = damageEvents(yields);
    // Attacker deals 3 to blocker; blocker deals 2 to attacker.
    const attackerDeals = dmg.filter((d) => d.sourceId === attacker);
    expect(attackerDeals).toHaveLength(1);
    expect(attackerDeals[0]?.targetKind).toBe("creature");
    expect(attackerDeals[0]?.targetId).toBe(blocker);
    expect(attackerDeals[0]?.amount).toBe(3);
  });

  it("blocker deals its power back to the first attacker it blocks", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const blocker = mkEntityId(10);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    addCard(fx.game, seatA, attacker);
    addCard(fx.game, seatB, blocker);
    fx.setStats(attacker, 3, 3);
    fx.setStats(blocker, 2, 2);
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "player", seat: seatB } }]);
    fx.handler.declareBlockers([{ blockerId: blocker, attackerIds: [attacker] }]);
    fx.handler.setBlockerOrder(attacker, [blocker]);

    const yields = drain(fx.handler.dealDamage(false));
    const dmg = damageEvents(yields);
    const blockerDeals = dmg.filter((d) => d.sourceId === blocker);
    expect(blockerDeals).toHaveLength(1);
    expect(blockerDeals[0]?.targetKind).toBe("creature");
    expect(blockerDeals[0]?.targetId).toBe(attacker);
    expect(blockerDeals[0]?.amount).toBe(2);
  });

  it("first-strike step with default isActiveInStep (Task 46) emits nothing", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    addCard(fx.game, seatA, attacker);
    fx.setStats(attacker, 3, 3);
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "player", seat: seatB } }]);

    const yields = drain(fx.handler.dealDamage(true));
    // Task 46 default: no creature is active in the FS step. Task 48
    // replaces isActiveInStep with real keyword-aware logic.
    expect(damageEvents(yields)).toHaveLength(0);
  });

  it("pre-declared damageAssignments override the default (all-to-first)", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const b1 = mkEntityId(10);
    const b2 = mkEntityId(11);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    addCard(fx.game, seatA, attacker);
    addCard(fx.game, seatB, b1);
    addCard(fx.game, seatB, b2);
    fx.setStats(attacker, 5, 5);
    fx.setStats(b1, 1, 1);
    fx.setStats(b2, 1, 1);
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "player", seat: seatB } }]);
    fx.handler.declareBlockers([
      { blockerId: b1, attackerIds: [attacker] },
      { blockerId: b2, attackerIds: [attacker] },
    ]);
    fx.handler.setBlockerOrder(attacker, [b1, b2]);
    fx.handler.assignDamage(attacker, [
      { targetId: b1, amount: 2 },
      { targetId: b2, amount: 3 },
    ]);

    const yields = drain(fx.handler.dealDamage(false));
    const dmg = damageEvents(yields).filter((d) => d.sourceId === attacker);
    expect(dmg).toHaveLength(2);
    expect(dmg[0]?.targetId).toBe(b1);
    expect(dmg[0]?.amount).toBe(2);
    expect(dmg[1]?.targetId).toBe(b2);
    expect(dmg[1]?.amount).toBe(3);
  });

  it("two unblocked attackers each emit their own damage event", () => {
    const fx = mkFixture();
    const a1 = mkEntityId(1);
    const a2 = mkEntityId(2);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    addCard(fx.game, seatA, a1);
    addCard(fx.game, seatA, a2);
    fx.setStats(a1, 2, 2);
    fx.setStats(a2, 4, 4);
    fx.handler.declareAttackers([
      { attackerId: a1, defender: { kind: "player", seat: seatB } },
      { attackerId: a2, defender: { kind: "player", seat: seatB } },
    ]);

    const yields = drain(fx.handler.dealDamage(false));
    const dmg = damageEvents(yields);
    expect(dmg).toHaveLength(2);
    expect(dmg.reduce((n, d) => n + d.amount, 0)).toBe(6);
  });

  it("attacker with no declared defender is still processed (planeswalker/battle via defenderKind)", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const pw = mkEntityId(42);
    const seatA = mkPlayerSeat(0);
    addCard(fx.game, seatA, attacker);
    fx.setStats(attacker, 2, 2);
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "planeswalker", id: pw } }]);
    const yields = drain(fx.handler.dealDamage(false));
    const dmg = damageEvents(yields);
    expect(dmg).toHaveLength(1);
    expect(dmg[0]?.targetKind).toBe("planeswalker");
    expect(dmg[0]?.targetId).toBe(pw);
    expect(dmg[0]?.amount).toBe(2);
  });

  it("clear() resets state so a subsequent dealDamage emits nothing", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    addCard(fx.game, seatA, attacker);
    fx.setStats(attacker, 3, 3);
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "player", seat: seatB } }]);
    fx.handler.clear();
    const yields = drain(fx.handler.dealDamage(false));
    expect(damageEvents(yields)).toHaveLength(0);
  });
});
