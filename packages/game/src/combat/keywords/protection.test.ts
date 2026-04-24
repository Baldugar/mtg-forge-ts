// SPDX-License-Identifier: GPL-3.0-or-later
// Protection (CR 702.16 — DEBT) helpers. Task 49 covers the damage-
// prevention + block-rejection scope (B + D). Targeting + attachment
// (T + E) are deferred to SP3 (cast pipeline's stepChooseTargets and
// attach-replacement registration).
import type { Characteristics, EntityId, LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
  CardType,
  Color,
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  Supertype,
  ZoneType,
  emptyCharacteristics,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../../action/engine-yield.js";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { damageProtected, hasProtectionFrom, readProtectionTags } from "./protection.js";

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
  types?: CardType[];
  subtypes?: string[];
  supertypes?: Supertype[];
  colors?: number;
}

const mkFixture = () => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  seedZones(game);
  const overrides = new Map<EntityId, CharOverride>();
  const orig = game.layerEngine.computeCharacteristics.bind(game.layerEngine);
  game.layerEngine.computeCharacteristics = (id: EntityId): Characteristics => {
    const o = overrides.get(id);
    if (!o) return orig(id);
    const c = emptyCharacteristics();
    if (o.types) for (const t of o.types) c.types.add(t);
    if (o.subtypes) for (const s of o.subtypes) c.subtypes.add(s);
    if (o.supertypes) for (const s of o.supertypes) c.supertypes.add(s);
    if (o.colors !== undefined) c.colors = ColorSet.fromJSON(o.colors);
    return c;
  };
  const addCard = (id: EntityId) => {
    const seat = mkPlayerSeat(0);
    const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
    game.cards.set(id, card);
    return card;
  };
  const addKeyword = (id: EntityId, kw: string) => {
    const card = game.cards.get(id);
    if (!card) throw new Error("test: missing card");
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add(kw);
  };
  return {
    game,
    addCard,
    addKeyword,
    setChars: (id: EntityId, o: CharOverride) => overrides.set(id, o),
  };
};

describe("readProtectionTags", () => {
  it("returns empty for card without keywords", () => {
    const fx = mkFixture();
    const id = mkEntityId(1);
    fx.addCard(id);
    expect(readProtectionTags(fx.game, id)).toEqual([]);
  });
  it("extracts the tag after 'protection:' prefix", () => {
    const fx = mkFixture();
    const id = mkEntityId(1);
    fx.addCard(id);
    fx.addKeyword(id, "protection:red");
    fx.addKeyword(id, "flying");
    fx.addKeyword(id, "protection:elves");
    const tags = [...readProtectionTags(fx.game, id)];
    tags.sort();
    expect(tags).toEqual(["elves", "red"]);
  });
});

describe("hasProtectionFrom (CR 702.16)", () => {
  it("protection:red matches a red object", () => {
    const fx = mkFixture();
    const a = mkEntityId(1);
    const b = mkEntityId(2);
    fx.addCard(a);
    fx.addCard(b);
    fx.addKeyword(a, "protection:red");
    fx.setChars(b, { colors: Color.Red });
    expect(hasProtectionFrom(fx.game, a, b)).toBe(true);
  });
  it("protection:red does NOT match a blue object", () => {
    const fx = mkFixture();
    const a = mkEntityId(1);
    const b = mkEntityId(2);
    fx.addCard(a);
    fx.addCard(b);
    fx.addKeyword(a, "protection:red");
    fx.setChars(b, { colors: Color.Blue });
    expect(hasProtectionFrom(fx.game, a, b)).toBe(false);
  });
  it("single-letter 'r' tag matches red", () => {
    const fx = mkFixture();
    const a = mkEntityId(1);
    const b = mkEntityId(2);
    fx.addCard(a);
    fx.addCard(b);
    fx.addKeyword(a, "protection:r");
    fx.setChars(b, { colors: Color.Red });
    expect(hasProtectionFrom(fx.game, a, b)).toBe(true);
  });
  it("protection:artifact matches an artifact", () => {
    const fx = mkFixture();
    const a = mkEntityId(1);
    const b = mkEntityId(2);
    fx.addCard(a);
    fx.addCard(b);
    fx.addKeyword(a, "protection:artifact");
    fx.setChars(b, { types: [CardType.Artifact] });
    expect(hasProtectionFrom(fx.game, a, b)).toBe(true);
  });
  it("protection:elf matches a creature with Elf subtype", () => {
    const fx = mkFixture();
    const a = mkEntityId(1);
    const b = mkEntityId(2);
    fx.addCard(a);
    fx.addCard(b);
    fx.addKeyword(a, "protection:elf");
    fx.setChars(b, { types: [CardType.Creature], subtypes: ["Elf", "Warrior"] });
    expect(hasProtectionFrom(fx.game, a, b)).toBe(true);
  });
  it("protection:legendary matches a legendary supertype", () => {
    const fx = mkFixture();
    const a = mkEntityId(1);
    const b = mkEntityId(2);
    fx.addCard(a);
    fx.addCard(b);
    fx.addKeyword(a, "protection:legendary");
    fx.setChars(b, { supertypes: [Supertype.Legendary] });
    expect(hasProtectionFrom(fx.game, a, b)).toBe(true);
  });
});

describe("damage prevention via protection (GameAction.damage integration)", () => {
  it("damage to a creature with protection from source: card.damage unchanged", () => {
    const fx = mkFixture();
    const src = mkEntityId(1);
    const tgt = mkEntityId(2);
    fx.addCard(src);
    const tgtCard = fx.addCard(tgt);
    fx.setChars(src, { colors: Color.Red });
    fx.addKeyword(tgt, "protection:red");
    // Drain the damage generator.
    const drain = (g: Generator<EngineYield, void, unknown>) => {
      const out: EngineYield[] = [];
      let s = g.next();
      while (!s.done) {
        out.push(s.value);
        s = g.next();
      }
      return out;
    };
    const yields = drain(fx.game.action.damage(src, "creature", tgt, 5, true));
    // DamageDealt is emitted, but amount is zeroed — Card.damage unchanged.
    expect(tgtCard.damage).toBe(0);
    const dmgEvents = yields.filter((y) => y.kind === "event" && y.event.kind === "DamageDealt");
    expect(dmgEvents).toHaveLength(1);
  });
  it("damage without protection: card.damage updates normally", () => {
    const fx = mkFixture();
    const src = mkEntityId(1);
    const tgt = mkEntityId(2);
    fx.addCard(src);
    const tgtCard = fx.addCard(tgt);
    fx.setChars(src, { colors: Color.Red });
    const drain = (g: Generator<EngineYield, void, unknown>) => {
      const out: EngineYield[] = [];
      let s = g.next();
      while (!s.done) {
        out.push(s.value);
        s = g.next();
      }
      return out;
    };
    drain(fx.game.action.damage(src, "creature", tgt, 3, true));
    expect(tgtCard.damage).toBe(3);
  });
});

describe("damageProtected convenience wrapper", () => {
  it("true when target has protection from source's color", () => {
    const fx = mkFixture();
    const src = mkEntityId(1);
    const tgt = mkEntityId(2);
    fx.addCard(src);
    fx.addCard(tgt);
    fx.setChars(src, { colors: Color.Green });
    fx.addKeyword(tgt, "protection:green");
    expect(damageProtected(fx.game, src, tgt)).toBe(true);
  });
  it("false when target has no protection", () => {
    const fx = mkFixture();
    const src = mkEntityId(1);
    const tgt = mkEntityId(2);
    fx.addCard(src);
    fx.addCard(tgt);
    expect(damageProtected(fx.game, src, tgt)).toBe(false);
  });
});
