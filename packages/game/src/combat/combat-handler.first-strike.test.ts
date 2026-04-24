// SPDX-License-Identifier: GPL-3.0-or-later
// CombatHandler first-strike / double-strike split (SP2 Task 48) — CR 702.7
// / 702.4. Tests stub LayerEngine.computeCharacteristics for deterministic
// per-card P/T and set Card.keywords directly for first_strike /
// double_strike seeding (SP3's keyword registry replaces this).
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

interface Fixture {
  readonly game: Game;
  readonly handler: CombatHandler;
  readonly setStats: (id: EntityId, power: number, toughness: number) => void;
  readonly addKeyword: (id: EntityId, keyword: string) => void;
  readonly addCard: (seat: PlayerSeat, id: EntityId) => Card;
}

const mkFixture = (): Fixture => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  seedZones(game);
  const perCardStats = new Map<EntityId, { power: number; toughness: number }>();
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
    addKeyword: (id, keyword) => {
      const card = game.cards.get(id);
      if (!card) throw new Error("test: missing card");
      if (!card.keywords) card.keywords = new Set();
      card.keywords.add(keyword);
    },
    addCard: (seat, id) => {
      const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
      game.cards.set(id, card);
      const z = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
      if (!z) throw new Error("test: missing battlefield");
      z.add(id);
      return card;
    },
  };
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

interface DmgSnapshot {
  sourceId: EntityId;
  targetKind: string;
  targetId: EntityId | PlayerSeat;
  amount: number;
}

const damageEvents = (yields: readonly EngineYield[]): DmgSnapshot[] => {
  const out: DmgSnapshot[] = [];
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

describe("CombatHandler first-strike split (SP2 Task 48)", () => {
  it("no FS/DS creatures: runCombatDamage skips the FS step", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    fx.addCard(seatA, attacker);
    fx.setStats(attacker, 3, 3);
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "player", seat: seatB } }]);
    const yields = drain(fx.handler.runCombatDamage());
    const dmg = damageEvents(yields);
    expect(dmg).toHaveLength(1);
    expect(dmg[0]?.amount).toBe(3);
    // firstStrikeSplitActive was never set (no FS/DS combatants).
    expect(fx.handler.state.firstStrikeSplitActive).toBe(false);
  });

  it("FS attacker deals in FS step only; dealDamage(false) skips it", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    fx.addCard(seatA, attacker);
    fx.setStats(attacker, 2, 2);
    fx.addKeyword(attacker, "first_strike");
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "player", seat: seatB } }]);

    const fsYields = drain(fx.handler.dealDamage(true));
    expect(damageEvents(fsYields)).toHaveLength(1);
    expect(damageEvents(fsYields)[0]?.amount).toBe(2);

    const regYields = drain(fx.handler.dealDamage(false));
    expect(damageEvents(regYields)).toHaveLength(0);
  });

  it("DS attacker deals in BOTH steps (double hit)", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    fx.addCard(seatA, attacker);
    fx.setStats(attacker, 2, 2);
    fx.addKeyword(attacker, "double_strike");
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "player", seat: seatB } }]);

    const fsYields = drain(fx.handler.dealDamage(true));
    expect(damageEvents(fsYields)).toHaveLength(1);
    expect(damageEvents(fsYields)[0]?.amount).toBe(2);

    const regYields = drain(fx.handler.dealDamage(false));
    expect(damageEvents(regYields)).toHaveLength(1);
    expect(damageEvents(regYields)[0]?.amount).toBe(2);
  });

  it("non-FS attacker: skipped in FS step, deals in regular step", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    fx.addCard(seatA, attacker);
    fx.setStats(attacker, 3, 3);
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "player", seat: seatB } }]);

    const fsYields = drain(fx.handler.dealDamage(true));
    expect(damageEvents(fsYields)).toHaveLength(0);

    const regYields = drain(fx.handler.dealDamage(false));
    expect(damageEvents(regYields)).toHaveLength(1);
    expect(damageEvents(regYields)[0]?.amount).toBe(3);
  });

  it("runCombatDamage with FS attacker vs 1/1 regular blocker: blocker dies in FS step", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const blocker = mkEntityId(10);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    fx.addCard(seatA, attacker);
    const blockerCard = fx.addCard(seatB, blocker);
    fx.setStats(attacker, 1, 1);
    fx.setStats(blocker, 1, 1);
    fx.addKeyword(attacker, "first_strike");
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "player", seat: seatB } }]);
    fx.handler.declareBlockers([{ blockerId: blocker, attackerIds: [attacker] }]);
    fx.handler.setBlockerOrder(attacker, [blocker]);

    const yields = drain(fx.handler.runCombatDamage());
    const dmg = damageEvents(yields);
    // FS attacker deals 1 to blocker → blocker.damage becomes 1 (lethal).
    expect(blockerCard.damage).toBe(1);
    // Blocker was not first-strike, so in FS step it didn't act; in the
    // regular step the blocker is still on the battlefield (SBA hasn't
    // fired in this scope) so it SHOULD deal damage. We accept that —
    // SBA integration is SP3 Task 51.
    const attackerDealt = dmg.filter((d) => d.sourceId === attacker);
    expect(attackerDealt).toHaveLength(1);
    expect(attackerDealt[0]?.amount).toBe(1);
    // Attacker dealt in FS step, so shouldn't deal again in regular step.
    expect(attackerDealt[0]?.targetId).toBe(blocker);
  });

  it("DS attacker vs 2/2 regular blocker: both steps fire; second step assigns minimum lethal (overage discarded, CR 702.17c)", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const blocker = mkEntityId(10);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    fx.addCard(seatA, attacker);
    fx.addCard(seatB, blocker);
    fx.setStats(attacker, 2, 2);
    fx.setStats(blocker, 2, 2);
    fx.addKeyword(attacker, "double_strike");
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "player", seat: seatB } }]);
    fx.handler.declareBlockers([{ blockerId: blocker, attackerIds: [attacker] }]);
    fx.handler.setBlockerOrder(attacker, [blocker]);

    const yields = drain(fx.handler.runCombatDamage());
    const dmg = damageEvents(yields);
    const attackerDealt = dmg.filter((d) => d.sourceId === attacker);
    // DS attacker deals in FS step AND regular step — 2 events.
    // Audit I-4 — FS step assigns 2 (lethal). After that the blocker has
    // 2 damage marked, so minimum lethal in the regular step is
    // max(1, 2 - 2) = 1; the remaining 1 power is discarded per CR 702.17c.
    expect(attackerDealt).toHaveLength(2);
    expect(attackerDealt[0]?.amount).toBe(2);
    expect(attackerDealt[1]?.amount).toBe(1);
  });

  it("FS attacker + DS blocker both participate in FS step", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const blocker = mkEntityId(10);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    fx.addCard(seatA, attacker);
    fx.addCard(seatB, blocker);
    fx.setStats(attacker, 2, 2);
    fx.setStats(blocker, 1, 3);
    fx.addKeyword(attacker, "first_strike");
    fx.addKeyword(blocker, "double_strike");
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "player", seat: seatB } }]);
    fx.handler.declareBlockers([{ blockerId: blocker, attackerIds: [attacker] }]);
    fx.handler.setBlockerOrder(attacker, [blocker]);

    const fsYields = drain(fx.handler.dealDamage(true));
    const fsDmg = damageEvents(fsYields);
    // Attacker deals to blocker, DS blocker deals to attacker.
    expect(fsDmg.filter((d) => d.sourceId === attacker)).toHaveLength(1);
    expect(fsDmg.filter((d) => d.sourceId === blocker)).toHaveLength(1);

    const regYields = drain(fx.handler.dealDamage(false));
    const regDmg = damageEvents(regYields);
    // Attacker is FS-only and dealt in FS — skipped now. Blocker is DS —
    // deals again.
    expect(regDmg.filter((d) => d.sourceId === attacker)).toHaveLength(0);
    expect(regDmg.filter((d) => d.sourceId === blocker)).toHaveLength(1);
  });

  it("runCombatDamage with FS+regular mix: firstStrikeSplitActive toggles correctly", () => {
    const fx = mkFixture();
    const fsAttacker = mkEntityId(1);
    const regAttacker = mkEntityId(2);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    fx.addCard(seatA, fsAttacker);
    fx.addCard(seatA, regAttacker);
    fx.setStats(fsAttacker, 2, 2);
    fx.setStats(regAttacker, 3, 3);
    fx.addKeyword(fsAttacker, "first_strike");
    fx.handler.declareAttackers([
      { attackerId: fsAttacker, defender: { kind: "player", seat: seatB } },
      { attackerId: regAttacker, defender: { kind: "player", seat: seatB } },
    ]);

    const yields = drain(fx.handler.runCombatDamage());
    const dmg = damageEvents(yields);
    // FS attacker deals 2, regular attacker deals 3 → total 5.
    expect(dmg.reduce((n, d) => n + d.amount, 0)).toBe(5);
    // After runCombatDamage, split flag is back to false.
    expect(fx.handler.state.firstStrikeSplitActive).toBe(false);
  });

  it("clear() resets dealtFirstStrike so a second combat starts clean", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    fx.addCard(seatA, attacker);
    fx.setStats(attacker, 2, 2);
    fx.addKeyword(attacker, "first_strike");
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "player", seat: seatB } }]);

    // FS step: dealt. Regular step: skipped.
    drain(fx.handler.dealDamage(true));
    const regAYields = drain(fx.handler.dealDamage(false));
    expect(damageEvents(regAYields)).toHaveLength(0);

    // Clear, re-declare, re-run regular step directly (no FS pass):
    // attacker now falls through (best-effort) since dealtFirstStrike
    // is empty.
    fx.handler.clear();
    fx.handler.declareAttackers([{ attackerId: attacker, defender: { kind: "player", seat: seatB } }]);
    const regBYields = drain(fx.handler.dealDamage(false));
    expect(damageEvents(regBYields)).toHaveLength(1);
  });
});
