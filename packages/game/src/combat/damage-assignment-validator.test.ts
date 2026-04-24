// SPDX-License-Identifier: GPL-3.0-or-later
// Damage assignment validator (SP2 Task 47) — CR 702.17c lethal-before-
// spill, 702.19 trample, 702.2 deathtouch. Tests stub
// LayerEngine.computeCharacteristics for deterministic per-card P/T; keyword
// presence is seeded via Card.keywords directly.
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
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import type { DefenderTarget } from "./combat-state.js";
import {
  type CombatDamageAssignment,
  defaultAssignment,
  minimumLethalTo,
  validateAssignment,
  validateBlockerDamageDistribution,
} from "./damage-assignment-validator.js";

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
  return {
    game,
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

const playerDefender = (seat: PlayerSeat): DefenderTarget => ({ kind: "player", seat });

describe("minimumLethalTo (CR 702.2/702.17c)", () => {
  it("returns blocker toughness when attacker has no deathtouch", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const blocker = mkEntityId(10);
    fx.addCard(mkPlayerSeat(0), attacker);
    fx.addCard(mkPlayerSeat(1), blocker);
    fx.setStats(blocker, 2, 3);
    expect(minimumLethalTo(fx.game, attacker, blocker)).toBe(3);
  });

  it("subtracts pre-existing damage from toughness", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const blocker = mkEntityId(10);
    fx.addCard(mkPlayerSeat(0), attacker);
    const bcard = fx.addCard(mkPlayerSeat(1), blocker);
    fx.setStats(blocker, 2, 4);
    bcard.damage = 2;
    expect(minimumLethalTo(fx.game, attacker, blocker)).toBe(2);
  });

  it("collapses to 1 when attacker has deathtouch", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const blocker = mkEntityId(10);
    fx.addCard(mkPlayerSeat(0), attacker);
    fx.addCard(mkPlayerSeat(1), blocker);
    fx.setStats(blocker, 5, 10);
    fx.addKeyword(attacker, "deathtouch");
    expect(minimumLethalTo(fx.game, attacker, blocker)).toBe(1);
  });
});

describe("defaultAssignment (CR 702.17c + 702.19 + 702.2)", () => {
  it("zero-power attacker → empty assignment", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    fx.addCard(mkPlayerSeat(0), attacker);
    expect(defaultAssignment(fx.game, attacker, [], 0, playerDefender(mkPlayerSeat(1)))).toEqual([]);
  });

  it("3/3 attacker vs 2/2 blocker (no trample) → {b: 3}", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const blocker = mkEntityId(10);
    fx.addCard(mkPlayerSeat(0), attacker);
    fx.addCard(mkPlayerSeat(1), blocker);
    fx.setStats(blocker, 2, 2);
    const got = defaultAssignment(fx.game, attacker, [blocker], 3, playerDefender(mkPlayerSeat(1)));
    // lethal=2 to blocker; overage=1 dumped on last blocker → {b, 3}.
    expect(got).toEqual([{ targetKind: "creature", targetId: blocker, amount: 3 }]);
  });

  it("3/3 trampler vs 2/2 blocker → {b: 2, player: 1}", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const blocker = mkEntityId(10);
    const defenderSeat = mkPlayerSeat(1);
    fx.addCard(mkPlayerSeat(0), attacker);
    fx.addCard(defenderSeat, blocker);
    fx.setStats(blocker, 2, 2);
    fx.addKeyword(attacker, "trample");
    const got = defaultAssignment(fx.game, attacker, [blocker], 3, playerDefender(defenderSeat));
    expect(got).toEqual([
      { targetKind: "creature", targetId: blocker, amount: 2 },
      { targetKind: "player", targetId: defenderSeat, amount: 1 },
    ]);
  });

  it("2/2 attacker vs 2/2 blocker → {b: 2} only", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const blocker = mkEntityId(10);
    fx.addCard(mkPlayerSeat(0), attacker);
    fx.addCard(mkPlayerSeat(1), blocker);
    fx.setStats(blocker, 2, 2);
    const got = defaultAssignment(fx.game, attacker, [blocker], 2, playerDefender(mkPlayerSeat(1)));
    expect(got).toEqual([{ targetKind: "creature", targetId: blocker, amount: 2 }]);
  });

  it("1/1 deathtouch vs 5/5 blocker → {b: 1}", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const blocker = mkEntityId(10);
    fx.addCard(mkPlayerSeat(0), attacker);
    fx.addCard(mkPlayerSeat(1), blocker);
    fx.setStats(blocker, 5, 5);
    fx.addKeyword(attacker, "deathtouch");
    const got = defaultAssignment(fx.game, attacker, [blocker], 1, playerDefender(mkPlayerSeat(1)));
    expect(got).toEqual([{ targetKind: "creature", targetId: blocker, amount: 1 }]);
  });

  it("5/5 attacker vs 1/1 + 2/2 blockers no trample → {b1: 1, b2: 4}", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const b1 = mkEntityId(10);
    const b2 = mkEntityId(11);
    fx.addCard(mkPlayerSeat(0), attacker);
    fx.addCard(mkPlayerSeat(1), b1);
    fx.addCard(mkPlayerSeat(1), b2);
    fx.setStats(b1, 1, 1);
    fx.setStats(b2, 2, 2);
    const got = defaultAssignment(fx.game, attacker, [b1, b2], 5, playerDefender(mkPlayerSeat(1)));
    // lethal: 1+2=3. Remaining 2 dumped on last blocker.
    expect(got).toEqual([
      { targetKind: "creature", targetId: b1, amount: 1 },
      { targetKind: "creature", targetId: b2, amount: 4 },
    ]);
  });

  it("5/5 trampler vs 1/1 + 2/2 blockers → {b1: 1, b2: 2, player: 2}", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const b1 = mkEntityId(10);
    const b2 = mkEntityId(11);
    const defenderSeat = mkPlayerSeat(1);
    fx.addCard(mkPlayerSeat(0), attacker);
    fx.addCard(defenderSeat, b1);
    fx.addCard(defenderSeat, b2);
    fx.setStats(b1, 1, 1);
    fx.setStats(b2, 2, 2);
    fx.addKeyword(attacker, "trample");
    const got = defaultAssignment(fx.game, attacker, [b1, b2], 5, playerDefender(defenderSeat));
    expect(got).toEqual([
      { targetKind: "creature", targetId: b1, amount: 1 },
      { targetKind: "creature", targetId: b2, amount: 2 },
      { targetKind: "player", targetId: defenderSeat, amount: 2 },
    ]);
  });

  it("power < total lethal → assign in order until depleted", () => {
    const fx = mkFixture();
    const attacker = mkEntityId(1);
    const b1 = mkEntityId(10);
    const b2 = mkEntityId(11);
    fx.addCard(mkPlayerSeat(0), attacker);
    fx.addCard(mkPlayerSeat(1), b1);
    fx.addCard(mkPlayerSeat(1), b2);
    fx.setStats(b1, 3, 3);
    fx.setStats(b2, 3, 3);
    const got = defaultAssignment(fx.game, attacker, [b1, b2], 2, playerDefender(mkPlayerSeat(1)));
    // b1 gets all 2; b2 gets nothing (CR 702.17c ordering — not enough
    // damage to reach lethal on b1, so no spill to b2).
    expect(got).toEqual([{ targetKind: "creature", targetId: b1, amount: 2 }]);
  });
});

describe("validateAssignment (CR 702.17c + 702.19 + 702.2)", () => {
  const attacker = mkEntityId(1);
  const b1 = mkEntityId(10);
  const b2 = mkEntityId(11);
  const defenderSeat = mkPlayerSeat(1);

  const mkFx = (): Fixture => {
    const fx = mkFixture();
    fx.addCard(mkPlayerSeat(0), attacker);
    fx.addCard(defenderSeat, b1);
    fx.addCard(defenderSeat, b2);
    fx.setStats(b1, 1, 1);
    fx.setStats(b2, 2, 2);
    return fx;
  };

  it("power=0 → only empty assignment is valid", () => {
    const fx = mkFx();
    expect(validateAssignment(fx.game, attacker, [b1], 0, playerDefender(defenderSeat), [])).toBe(true);
    expect(
      validateAssignment(fx.game, attacker, [b1], 0, playerDefender(defenderSeat), [
        { targetKind: "creature", targetId: b1, amount: 1 },
      ]),
    ).toBe(false);
  });

  it("{b1: 2, b2: 3} with attacker power=5 (no trample) is legal", () => {
    const fx = mkFx();
    // 5/5 attacker vs 1/1 and 2/2: lethal cum = 1,3. Assignment cum = 2,5.
    // 2>=1 ✓, 5>=min(3,5)=3 ✓, total=5 ✓. No defender spill without trample.
    const proposed: CombatDamageAssignment[] = [
      { targetKind: "creature", targetId: b1, amount: 2 },
      { targetKind: "creature", targetId: b2, amount: 3 },
    ];
    expect(validateAssignment(fx.game, attacker, [b1, b2], 5, playerDefender(defenderSeat), proposed)).toBe(
      true,
    );
  });

  it("under-assigned to first blocker before second → illegal", () => {
    const fx = mkFx();
    // b1 has lethal=1; assigning 0 to b1 and 5 to b2 violates lethal-before-spill.
    const proposed: CombatDamageAssignment[] = [{ targetKind: "creature", targetId: b2, amount: 5 }];
    expect(validateAssignment(fx.game, attacker, [b1, b2], 5, playerDefender(defenderSeat), proposed)).toBe(
      false,
    );
  });

  it("spill to defender without trample → illegal", () => {
    const fx = mkFx();
    const proposed: CombatDamageAssignment[] = [
      { targetKind: "creature", targetId: b1, amount: 1 },
      { targetKind: "creature", targetId: b2, amount: 2 },
      { targetKind: "player", targetId: defenderSeat, amount: 2 },
    ];
    expect(validateAssignment(fx.game, attacker, [b1, b2], 5, playerDefender(defenderSeat), proposed)).toBe(
      false,
    );
  });

  it("spill to defender with trample → legal once lethal reached on all", () => {
    const fx = mkFx();
    fx.addKeyword(attacker, "trample");
    const proposed: CombatDamageAssignment[] = [
      { targetKind: "creature", targetId: b1, amount: 1 },
      { targetKind: "creature", targetId: b2, amount: 2 },
      { targetKind: "player", targetId: defenderSeat, amount: 2 },
    ];
    expect(validateAssignment(fx.game, attacker, [b1, b2], 5, playerDefender(defenderSeat), proposed)).toBe(
      true,
    );
  });

  it("trample without reaching lethal on b2 → illegal", () => {
    const fx = mkFx();
    fx.addKeyword(attacker, "trample");
    // b1 lethal=1, b2 lethal=2; assigning 1 to b1 and 1 to b2 and spilling 3
    // to defender violates lethal-before-spill for b2.
    const proposed: CombatDamageAssignment[] = [
      { targetKind: "creature", targetId: b1, amount: 1 },
      { targetKind: "creature", targetId: b2, amount: 1 },
      { targetKind: "player", targetId: defenderSeat, amount: 3 },
    ];
    expect(validateAssignment(fx.game, attacker, [b1, b2], 5, playerDefender(defenderSeat), proposed)).toBe(
      false,
    );
  });

  it("sum != power → illegal", () => {
    const fx = mkFx();
    const proposed: CombatDamageAssignment[] = [{ targetKind: "creature", targetId: b1, amount: 3 }];
    expect(validateAssignment(fx.game, attacker, [b1], 5, playerDefender(defenderSeat), proposed)).toBe(
      false,
    );
  });

  it("negative amount → illegal", () => {
    const fx = mkFx();
    const proposed: CombatDamageAssignment[] = [{ targetKind: "creature", targetId: b1, amount: -1 }];
    expect(validateAssignment(fx.game, attacker, [b1], 1, playerDefender(defenderSeat), proposed)).toBe(
      false,
    );
  });

  it("non-integer amount → illegal", () => {
    const fx = mkFx();
    const proposed: CombatDamageAssignment[] = [{ targetKind: "creature", targetId: b1, amount: 1.5 }];
    expect(validateAssignment(fx.game, attacker, [b1], 2, playerDefender(defenderSeat), proposed)).toBe(
      false,
    );
  });

  it("deathtouch: lethal is 1 per blocker so {b1:1, b2:1, player:3} with trample is legal", () => {
    const fx = mkFx();
    fx.addKeyword(attacker, "trample");
    fx.addKeyword(attacker, "deathtouch");
    fx.setStats(b2, 10, 10);
    const proposed: CombatDamageAssignment[] = [
      { targetKind: "creature", targetId: b1, amount: 1 },
      { targetKind: "creature", targetId: b2, amount: 1 },
      { targetKind: "player", targetId: defenderSeat, amount: 3 },
    ];
    expect(validateAssignment(fx.game, attacker, [b1, b2], 5, playerDefender(defenderSeat), proposed)).toBe(
      true,
    );
  });
});

describe("validateBlockerDamageDistribution (CR 702.22 — banding)", () => {
  const mkFx = () => {
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
    const blocker = mkEntityId(100);
    const a1 = mkEntityId(1);
    const a2 = mkEntityId(2);
    const a3 = mkEntityId(3);
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    for (const id of [blocker]) {
      game.cards.set(id, new Card(id, paper, seatB, seatB, ZoneType.Battlefield));
    }
    for (const id of [a1, a2, a3]) {
      game.cards.set(id, new Card(id, paper, seatA, seatA, ZoneType.Battlefield));
    }
    perCardStats.set(blocker, { power: 4, toughness: 4 });
    return {
      game,
      blocker,
      a1,
      a2,
      a3,
      addKeyword: (id: EntityId, kw: string) => {
        const card = game.cards.get(id);
        if (!card) throw new Error("fx");
        if (!card.keywords) card.keywords = new Set();
        card.keywords.add(kw);
      },
    };
  };

  it("single attacker: must assign all damage to that attacker", () => {
    const fx = mkFx();
    expect(
      validateBlockerDamageDistribution(fx.game, fx.blocker, [fx.a1], 4, [{ attackerId: fx.a1, amount: 4 }]),
    ).toBe(true);
  });

  it("single attacker with wrong amount: invalid", () => {
    const fx = mkFx();
    expect(
      validateBlockerDamageDistribution(fx.game, fx.blocker, [fx.a1], 4, [{ attackerId: fx.a1, amount: 3 }]),
    ).toBe(false);
  });

  it("multi-attacker without banding: invalid", () => {
    const fx = mkFx();
    expect(
      validateBlockerDamageDistribution(fx.game, fx.blocker, [fx.a1, fx.a2], 4, [
        { attackerId: fx.a1, amount: 2 },
        { attackerId: fx.a2, amount: 2 },
      ]),
    ).toBe(false);
  });

  it("multi-attacker with banding, sums to power: valid", () => {
    const fx = mkFx();
    fx.addKeyword(fx.blocker, "banding");
    expect(
      validateBlockerDamageDistribution(fx.game, fx.blocker, [fx.a1, fx.a2], 4, [
        { attackerId: fx.a1, amount: 3 },
        { attackerId: fx.a2, amount: 1 },
      ]),
    ).toBe(true);
  });

  it("banding blocker, sum != power: invalid", () => {
    const fx = mkFx();
    fx.addKeyword(fx.blocker, "banding");
    expect(
      validateBlockerDamageDistribution(fx.game, fx.blocker, [fx.a1, fx.a2], 4, [
        { attackerId: fx.a1, amount: 3 },
        { attackerId: fx.a2, amount: 2 },
      ]),
    ).toBe(false);
  });

  it("banding blocker assigning to a non-blocked attacker: invalid", () => {
    const fx = mkFx();
    fx.addKeyword(fx.blocker, "banding");
    expect(
      validateBlockerDamageDistribution(fx.game, fx.blocker, [fx.a1, fx.a2], 4, [
        { attackerId: fx.a1, amount: 2 },
        { attackerId: fx.a3, amount: 2 },
      ]),
    ).toBe(false);
  });

  it("negative amount: invalid", () => {
    const fx = mkFx();
    fx.addKeyword(fx.blocker, "banding");
    expect(
      validateBlockerDamageDistribution(fx.game, fx.blocker, [fx.a1, fx.a2], 4, [
        { attackerId: fx.a1, amount: 5 },
        { attackerId: fx.a2, amount: -1 },
      ]),
    ).toBe(false);
  });
});
