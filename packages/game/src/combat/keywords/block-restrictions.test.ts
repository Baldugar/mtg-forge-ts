// SPDX-License-Identifier: GPL-3.0-or-later
// Block-legality checks (SP2 Task 49 + Task 50) — CR 509.1b and the per-
// keyword rule refs noted in block-restrictions.ts. Tests stub
// LayerEngine.computeCharacteristics for deterministic P/T and type/color
// membership, and seed Card.keywords directly for evasion/protection tags.
import type { Characteristics, EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  CardType,
  Color,
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  ZoneType,
  emptyCharacteristics,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { isBlockLegal, validateBlockDeclarations } from "./block-restrictions.js";

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

interface CharOverride {
  power?: number;
  toughness?: number;
  types?: CardType[];
  subtypes?: string[];
  colors?: number;
}

interface Fixture {
  readonly game: Game;
  readonly setChars: (id: EntityId, o: CharOverride) => void;
  readonly addKeyword: (id: EntityId, keyword: string) => void;
  readonly addCard: (seat: PlayerSeat, id: EntityId) => Card;
}

const mkFixture = (): Fixture => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  seedZones(game);
  const overrides = new Map<EntityId, CharOverride>();
  const orig = game.layerEngine.computeCharacteristics.bind(game.layerEngine);
  game.layerEngine.computeCharacteristics = (id: EntityId): Characteristics => {
    const o = overrides.get(id);
    if (!o) return orig(id);
    const chars = emptyCharacteristics();
    if (o.power !== undefined) chars.power = o.power;
    if (o.toughness !== undefined) chars.toughness = o.toughness;
    if (o.types) for (const t of o.types) chars.types.add(t);
    if (o.subtypes) for (const s of o.subtypes) chars.subtypes.add(s);
    if (o.colors !== undefined) chars.colors = ColorSet.fromJSON(o.colors);
    return chars;
  };
  return {
    game,
    setChars: (id, o) => overrides.set(id, o),
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

describe("isBlockLegal (SP2 Task 49+50, CR 509.1b)", () => {
  describe("flying (CR 702.9) / reach (CR 702.17)", () => {
    it("flying attacker cannot be blocked by ground creature", () => {
      const fx = mkFixture();
      const att = mkEntityId(1);
      const blk = mkEntityId(2);
      fx.addCard(mkPlayerSeat(0), att);
      fx.addCard(mkPlayerSeat(1), blk);
      fx.addKeyword(att, "flying");
      const r = isBlockLegal(fx.game, blk, att, [blk]);
      expect(r.legal).toBe(false);
    });
    it("flying attacker can be blocked by flying", () => {
      const fx = mkFixture();
      const att = mkEntityId(1);
      const blk = mkEntityId(2);
      fx.addCard(mkPlayerSeat(0), att);
      fx.addCard(mkPlayerSeat(1), blk);
      fx.addKeyword(att, "flying");
      fx.addKeyword(blk, "flying");
      expect(isBlockLegal(fx.game, blk, att, [blk]).legal).toBe(true);
    });
    it("flying attacker can be blocked by reach", () => {
      const fx = mkFixture();
      const att = mkEntityId(1);
      const blk = mkEntityId(2);
      fx.addCard(mkPlayerSeat(0), att);
      fx.addCard(mkPlayerSeat(1), blk);
      fx.addKeyword(att, "flying");
      fx.addKeyword(blk, "reach");
      expect(isBlockLegal(fx.game, blk, att, [blk]).legal).toBe(true);
    });
  });

  describe("menace (CR 702.110)", () => {
    it("menace attacker cannot be blocked by a single creature", () => {
      const fx = mkFixture();
      const att = mkEntityId(1);
      const blk = mkEntityId(2);
      fx.addCard(mkPlayerSeat(0), att);
      fx.addCard(mkPlayerSeat(1), blk);
      fx.addKeyword(att, "menace");
      expect(isBlockLegal(fx.game, blk, att, [blk]).legal).toBe(false);
    });
    it("menace attacker is legal with two blockers", () => {
      const fx = mkFixture();
      const att = mkEntityId(1);
      const blk1 = mkEntityId(2);
      const blk2 = mkEntityId(3);
      fx.addCard(mkPlayerSeat(0), att);
      fx.addCard(mkPlayerSeat(1), blk1);
      fx.addCard(mkPlayerSeat(1), blk2);
      fx.addKeyword(att, "menace");
      expect(isBlockLegal(fx.game, blk1, att, [blk1, blk2]).legal).toBe(true);
    });
  });

  describe("skulk (CR 702.118)", () => {
    it("skulk 2/2 rejects 3/3 blocker", () => {
      const fx = mkFixture();
      const att = mkEntityId(1);
      const blk = mkEntityId(2);
      fx.addCard(mkPlayerSeat(0), att);
      fx.addCard(mkPlayerSeat(1), blk);
      fx.setChars(att, { power: 2, toughness: 2 });
      fx.setChars(blk, { power: 3, toughness: 3 });
      fx.addKeyword(att, "skulk");
      expect(isBlockLegal(fx.game, blk, att, [blk]).legal).toBe(false);
    });
    it("skulk 3/3 accepts 3/3 blocker (equal power)", () => {
      const fx = mkFixture();
      const att = mkEntityId(1);
      const blk = mkEntityId(2);
      fx.addCard(mkPlayerSeat(0), att);
      fx.addCard(mkPlayerSeat(1), blk);
      fx.setChars(att, { power: 3, toughness: 3 });
      fx.setChars(blk, { power: 3, toughness: 3 });
      fx.addKeyword(att, "skulk");
      expect(isBlockLegal(fx.game, blk, att, [blk]).legal).toBe(true);
    });
  });

  describe("protection (CR 702.16b — B from DEBT)", () => {
    it("attacker with protection from blocker's color cannot be blocked", () => {
      const fx = mkFixture();
      const att = mkEntityId(1);
      const blk = mkEntityId(2);
      fx.addCard(mkPlayerSeat(0), att);
      fx.addCard(mkPlayerSeat(1), blk);
      fx.addKeyword(att, "protection:red");
      fx.setChars(blk, { colors: Color.Red });
      expect(isBlockLegal(fx.game, blk, att, [blk]).legal).toBe(false);
    });
    it("blocker with protection from attacker's color cannot block (symmetric)", () => {
      const fx = mkFixture();
      const att = mkEntityId(1);
      const blk = mkEntityId(2);
      fx.addCard(mkPlayerSeat(0), att);
      fx.addCard(mkPlayerSeat(1), blk);
      fx.setChars(att, { colors: Color.Green });
      fx.addKeyword(blk, "protection:green");
      expect(isBlockLegal(fx.game, blk, att, [blk]).legal).toBe(false);
    });
    it("mismatched protection colors: block legal", () => {
      const fx = mkFixture();
      const att = mkEntityId(1);
      const blk = mkEntityId(2);
      fx.addCard(mkPlayerSeat(0), att);
      fx.addCard(mkPlayerSeat(1), blk);
      fx.addKeyword(att, "protection:red");
      fx.setChars(blk, { colors: Color.Blue });
      expect(isBlockLegal(fx.game, blk, att, [blk]).legal).toBe(true);
    });
  });

  describe("horsemanship (CR 702.30)", () => {
    it("horsemanship attacker cannot be blocked by non-horsemanship", () => {
      const fx = mkFixture();
      const att = mkEntityId(1);
      const blk = mkEntityId(2);
      fx.addCard(mkPlayerSeat(0), att);
      fx.addCard(mkPlayerSeat(1), blk);
      fx.addKeyword(att, "horsemanship");
      expect(isBlockLegal(fx.game, blk, att, [blk]).legal).toBe(false);
    });
    it("horsemanship attacker accepts horsemanship blocker", () => {
      const fx = mkFixture();
      const att = mkEntityId(1);
      const blk = mkEntityId(2);
      fx.addCard(mkPlayerSeat(0), att);
      fx.addCard(mkPlayerSeat(1), blk);
      fx.addKeyword(att, "horsemanship");
      fx.addKeyword(blk, "horsemanship");
      expect(isBlockLegal(fx.game, blk, att, [blk]).legal).toBe(true);
    });
  });

  describe("fear (CR 702.36)", () => {
    it("fear attacker rejects non-black non-artifact blocker", () => {
      const fx = mkFixture();
      const att = mkEntityId(1);
      const blk = mkEntityId(2);
      fx.addCard(mkPlayerSeat(0), att);
      fx.addCard(mkPlayerSeat(1), blk);
      fx.addKeyword(att, "fear");
      fx.setChars(blk, { colors: Color.White });
      expect(isBlockLegal(fx.game, blk, att, [blk]).legal).toBe(false);
    });
    it("fear attacker accepts black blocker", () => {
      const fx = mkFixture();
      const att = mkEntityId(1);
      const blk = mkEntityId(2);
      fx.addCard(mkPlayerSeat(0), att);
      fx.addCard(mkPlayerSeat(1), blk);
      fx.addKeyword(att, "fear");
      fx.setChars(blk, { colors: Color.Black });
      expect(isBlockLegal(fx.game, blk, att, [blk]).legal).toBe(true);
    });
    it("fear attacker accepts artifact blocker", () => {
      const fx = mkFixture();
      const att = mkEntityId(1);
      const blk = mkEntityId(2);
      fx.addCard(mkPlayerSeat(0), att);
      fx.addCard(mkPlayerSeat(1), blk);
      fx.addKeyword(att, "fear");
      fx.setChars(blk, { types: [CardType.Artifact] });
      expect(isBlockLegal(fx.game, blk, att, [blk]).legal).toBe(true);
    });
  });

  describe("intimidate (CR 702.13)", () => {
    it("intimidate attacker rejects non-shared-color non-artifact blocker", () => {
      const fx = mkFixture();
      const att = mkEntityId(1);
      const blk = mkEntityId(2);
      fx.addCard(mkPlayerSeat(0), att);
      fx.addCard(mkPlayerSeat(1), blk);
      fx.addKeyword(att, "intimidate");
      fx.setChars(att, { colors: Color.Red });
      fx.setChars(blk, { colors: Color.Blue });
      expect(isBlockLegal(fx.game, blk, att, [blk]).legal).toBe(false);
    });
    it("intimidate attacker accepts shared-color blocker", () => {
      const fx = mkFixture();
      const att = mkEntityId(1);
      const blk = mkEntityId(2);
      fx.addCard(mkPlayerSeat(0), att);
      fx.addCard(mkPlayerSeat(1), blk);
      fx.addKeyword(att, "intimidate");
      fx.setChars(att, { colors: Color.Red });
      fx.setChars(blk, { colors: Color.Red | Color.Blue });
      expect(isBlockLegal(fx.game, blk, att, [blk]).legal).toBe(true);
    });
    it("intimidate attacker accepts artifact blocker", () => {
      const fx = mkFixture();
      const att = mkEntityId(1);
      const blk = mkEntityId(2);
      fx.addCard(mkPlayerSeat(0), att);
      fx.addCard(mkPlayerSeat(1), blk);
      fx.addKeyword(att, "intimidate");
      fx.setChars(att, { colors: Color.Red });
      fx.setChars(blk, { types: [CardType.Artifact] });
      expect(isBlockLegal(fx.game, blk, att, [blk]).legal).toBe(true);
    });
  });

  describe("landwalk (CR 702.14 family)", () => {
    it("islandwalk attacker cannot be blocked when defender controls an Island", () => {
      const fx = mkFixture();
      const att = mkEntityId(1);
      const blk = mkEntityId(2);
      const island = mkEntityId(3);
      fx.addCard(mkPlayerSeat(0), att);
      fx.addCard(mkPlayerSeat(1), blk);
      fx.addCard(mkPlayerSeat(1), island);
      fx.setChars(island, { types: [CardType.Land], subtypes: ["Island"] });
      fx.addKeyword(att, "islandwalk");
      expect(isBlockLegal(fx.game, blk, att, [blk]).legal).toBe(false);
    });
    it("islandwalk attacker is legal when defender controls no Islands", () => {
      const fx = mkFixture();
      const att = mkEntityId(1);
      const blk = mkEntityId(2);
      const forest = mkEntityId(3);
      fx.addCard(mkPlayerSeat(0), att);
      fx.addCard(mkPlayerSeat(1), blk);
      fx.addCard(mkPlayerSeat(1), forest);
      fx.setChars(forest, { types: [CardType.Land], subtypes: ["Forest"] });
      fx.addKeyword(att, "islandwalk");
      expect(isBlockLegal(fx.game, blk, att, [blk]).legal).toBe(true);
    });
  });

  describe("no evasion keywords present", () => {
    it("vanilla attacker accepts vanilla blocker", () => {
      const fx = mkFixture();
      const att = mkEntityId(1);
      const blk = mkEntityId(2);
      fx.addCard(mkPlayerSeat(0), att);
      fx.addCard(mkPlayerSeat(1), blk);
      expect(isBlockLegal(fx.game, blk, att, [blk]).legal).toBe(true);
    });
  });
});

describe("validateBlockDeclarations", () => {
  it("returns empty array when all declarations are legal", () => {
    const fx = mkFixture();
    const att = mkEntityId(1);
    const blk = mkEntityId(2);
    fx.addCard(mkPlayerSeat(0), att);
    fx.addCard(mkPlayerSeat(1), blk);
    const errs = validateBlockDeclarations(fx.game, [{ blockerId: blk, attackerIds: [att] }]);
    expect(errs).toHaveLength(0);
  });
  it("surfaces menace violation when only one blocker declared", () => {
    const fx = mkFixture();
    const att = mkEntityId(1);
    const blk = mkEntityId(2);
    fx.addCard(mkPlayerSeat(0), att);
    fx.addCard(mkPlayerSeat(1), blk);
    fx.addKeyword(att, "menace");
    const errs = validateBlockDeclarations(fx.game, [{ blockerId: blk, attackerIds: [att] }]);
    expect(errs).toHaveLength(1);
    expect(errs[0]?.reason).toContain("menace");
  });
  it("groups by attacker: two blockers on a menace attacker are legal", () => {
    const fx = mkFixture();
    const att = mkEntityId(1);
    const blk1 = mkEntityId(2);
    const blk2 = mkEntityId(3);
    fx.addCard(mkPlayerSeat(0), att);
    fx.addCard(mkPlayerSeat(1), blk1);
    fx.addCard(mkPlayerSeat(1), blk2);
    fx.addKeyword(att, "menace");
    const errs = validateBlockDeclarations(fx.game, [
      { blockerId: blk1, attackerIds: [att] },
      { blockerId: blk2, attackerIds: [att] },
    ]);
    expect(errs).toHaveLength(0);
  });
});
