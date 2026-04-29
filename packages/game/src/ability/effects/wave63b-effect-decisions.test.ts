// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 63.B — sub-param tightness for three more Wave 53 effects:
//   * CopyPermanent AddColors$ / AddSubtypes$ / AddKeywords$ /
//     Power$ / Toughness$ — verify Layer 4/5/6/7b application on the
//     freshly-minted token copy.
//   * Mana Replace$ — colour rewrite of produced atoms before they
//     hit the pool.
//   * Mana Pool$ True — explicit decision-bypass flag is parsed
//     without altering the deterministic MVP behaviour.
//   * Counter DestinationZone$ + LibraryPosition$ — already wired
//     in Wave 53; sanity-check that the param routes through the
//     replacement loop and reaches moveTo as the final destination.
import "./copy-permanent.js";
import "./mana.js";
import "./counter-spell.js";
import "../../svar/selectors/number.js";

import type { AbilityAst, LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
  CardType,
  Color,
  DEFAULT_PAPER_CARD_FLAGS,
  type ManaProduced,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { ManaPool } from "../../mana/mana-pool.js";
import type { StackItem } from "../../stack/stack-item.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Exile } from "../../zone/zones/exile.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { SpellAbility } from "../spell-ability.js";

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
  cardDataSyncedAt: "2026-04-28T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};
const bearPaper: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name: "Grizzly Bears",
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
};
const sourcePaper: PaperCard = {
  name: "Source",
  edition: "LEA",
  collectorNumber: "002",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
    player.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, player.seat));
    player.manaPool = new ManaPool();
  }
  return game;
};

const mkAst = (handlerKey: string, params: AbilityAst["effect"]["params"]): AbilityAst => ({
  kind: "spell",
  effect: { handlerKey, params },
  cost: { raw: "" },
});

const drainGen = (gen: Generator<unknown, void, unknown>): void => {
  let r = gen.next();
  while (!r.done) r = gen.next();
};

// ---------------------------------------------------------------------
// CopyPermanent AddColors$ / AddSubtypes$ / AddKeywords$ / Power$/Toughness$
// ---------------------------------------------------------------------

describe("Wave 63.B — CopyPermanent AddColors$/AddSubtypes$/AddKeywords$/Power$", () => {
  it("AddColors$ U adds blue to the copy via Layer 5", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const targetId = mkEntityId(20);

    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    const target = new Card(targetId, bearPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(targetId, target);
    const cardsBefore = game.cards.size;

    const sa = new SpellAbility(
      mkAst("CopyPermanent", {
        AddColors: { kind: "literal", raw: "U" },
      }),
      sourceId,
      seat0,
      new Map(),
      [targetId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.cards.size).toBe(cardsBefore + 1);
    const tokens = [...game.cards.values()].filter((c) => c.isToken);
    expect(tokens).toHaveLength(1);
    const token = tokens[0];
    expect(token).toBeDefined();
    if (!token) return;
    const chars = game.layerEngine.computeCharacteristics(token.id);
    // Bear's printed colors include green (from {1}{G} mana cost) — Layer 5
    // "add" unions blue on top.
    expect(chars.colors.has(Color.Blue)).toBe(true);
  });

  it("AddSubtypes$ Zombie adds the subtype via Layer 4", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const targetId = mkEntityId(20);

    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    const target = new Card(targetId, bearPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(targetId, target);

    const sa = new SpellAbility(
      mkAst("CopyPermanent", {
        AddSubtypes: { kind: "literal", raw: "Zombie" },
      }),
      sourceId,
      seat0,
      new Map(),
      [targetId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const tokens = [...game.cards.values()].filter((c) => c.isToken);
    const token = tokens[0];
    expect(token).toBeDefined();
    if (!token) return;
    const chars = game.layerEngine.computeCharacteristics(token.id);
    expect(chars.subtypes.has("Zombie")).toBe(true);
    // Original bear subtype still present (additive, not replacing).
    expect(chars.subtypes.has("Bear")).toBe(true);
  });

  it("AddKeywords$ Flying grants the keyword via Layer 6", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const targetId = mkEntityId(20);

    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    const target = new Card(targetId, bearPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(targetId, target);

    const sa = new SpellAbility(
      mkAst("CopyPermanent", {
        AddKeywords: { kind: "literal", raw: "Flying" },
      }),
      sourceId,
      seat0,
      new Map(),
      [targetId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const tokens = [...game.cards.values()].filter((c) => c.isToken);
    const token = tokens[0];
    expect(token).toBeDefined();
    if (!token) return;
    const grants = game.layerEngine.effectiveGrantedKeywords(token.id);
    expect(grants.has("flying")).toBe(true);
  });

  it("Power$ 5 / Toughness$ 5 set the copy's P/T at Layer 7b", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const targetId = mkEntityId(20);

    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    const target = new Card(targetId, bearPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(targetId, target);

    const sa = new SpellAbility(
      mkAst("CopyPermanent", {
        Power: { kind: "literal", raw: "5" },
        Toughness: { kind: "literal", raw: "5" },
      }),
      sourceId,
      seat0,
      new Map(),
      [targetId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const tokens = [...game.cards.values()].filter((c) => c.isToken);
    const token = tokens[0];
    expect(token).toBeDefined();
    if (!token) return;
    const chars = game.layerEngine.computeCharacteristics(token.id);
    expect(chars.power).toBe(5);
    expect(chars.toughness).toBe(5);
  });

  it("composes all Add* params on a single copy", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const targetId = mkEntityId(20);

    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    const target = new Card(targetId, bearPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(targetId, target);

    const sa = new SpellAbility(
      mkAst("CopyPermanent", {
        AddColors: { kind: "literal", raw: "U,B" },
        AddTypes: { kind: "literal", raw: "Artifact" },
        AddSubtypes: { kind: "literal", raw: "Zombie" },
        AddKeywords: { kind: "literal", raw: "Flying" },
        Power: { kind: "literal", raw: "4" },
        Toughness: { kind: "literal", raw: "4" },
      }),
      sourceId,
      seat0,
      new Map(),
      [targetId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const tokens = [...game.cards.values()].filter((c) => c.isToken);
    const token = tokens[0];
    expect(token).toBeDefined();
    if (!token) return;
    const chars = game.layerEngine.computeCharacteristics(token.id);
    expect(chars.colors.has(Color.Blue)).toBe(true);
    expect(chars.colors.has(Color.Black)).toBe(true);
    expect(chars.types.has(CardType.Artifact)).toBe(true);
    expect(chars.subtypes.has("Zombie")).toBe(true);
    expect(chars.power).toBe(4);
    expect(chars.toughness).toBe(4);
    const grants = game.layerEngine.effectiveGrantedKeywords(token.id);
    expect(grants.has("flying")).toBe(true);
  });
});

// ---------------------------------------------------------------------
// Mana Replace$ + Pool$
// ---------------------------------------------------------------------

describe("Wave 63.B — Mana Replace$ / Pool$", () => {
  it("Replace$ Any:U rewrites the Any branch to blue", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      mkAst("Mana", {
        Produced: { kind: "literal", raw: "Any" },
        Replace: { kind: "literal", raw: "Any:U" },
      }),
      sourceId,
      seat0,
      new Map(),
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const pool = game.getPlayer(seat0).manaPool as ManaPool;
    expect(pool.size()).toBe(1);
    expect((pool.toArray()[0] as ManaProduced).color).toBe(Color.Blue);
  });

  it("Replace$ G:U rewrites a green symbol to blue at the standard branch", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      mkAst("Mana", {
        Produced: { kind: "literal", raw: "G" },
        Replace: { kind: "literal", raw: "G:U" },
      }),
      sourceId,
      seat0,
      new Map(),
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const pool = game.getPlayer(seat0).manaPool as ManaPool;
    expect(pool.size()).toBe(1);
    expect((pool.toArray()[0] as ManaProduced).color).toBe(Color.Blue);
  });

  it("Replace$ G:U with long-form word `Green:Blue` is honoured", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      mkAst("Mana", {
        Produced: { kind: "literal", raw: "G" },
        Replace: { kind: "literal", raw: "Green:Blue" },
      }),
      sourceId,
      seat0,
      new Map(),
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const pool = game.getPlayer(seat0).manaPool as ManaPool;
    expect(pool.size()).toBe(1);
    expect((pool.toArray()[0] as ManaProduced).color).toBe(Color.Blue);
  });

  it("Pool$ True parses without altering the deterministic MVP behaviour", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield));

    const sa = new SpellAbility(
      mkAst("Mana", {
        Produced: { kind: "literal", raw: "Combo W U" },
        Pool: { kind: "literal", raw: "True" },
      }),
      sourceId,
      seat0,
      new Map(),
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const pool = game.getPlayer(seat0).manaPool as ManaPool;
    expect(pool.size()).toBe(1);
    // Combo MVP picks first listed → White.
    expect((pool.toArray()[0] as ManaProduced).color).toBe(Color.White);
  });
});

// ---------------------------------------------------------------------
// Counter DestinationZone$ + LibraryPosition$ (already wired in Wave 53;
// confirm replacement-loop integration end-to-end).
// ---------------------------------------------------------------------

describe("Wave 63.B — Counter DestinationZone$ + LibraryPosition$ (already-wired sanity)", () => {
  it("DestinationZone$ Exile sends the countered spell to exile (not graveyard)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const boltId = mkEntityId(10);
    const stackItemId = mkEntityId(11);
    const counterspellId = mkEntityId(20);

    const bolt = new Card(boltId, sourcePaper, seat1, seat1, ZoneType.Hand);
    const counter = new Card(counterspellId, sourcePaper, seat0, seat0, ZoneType.Hand);
    game.cards.set(boltId, bolt);
    game.cards.set(counterspellId, counter);
    game.getPlayer(seat1).zones.get(ZoneType.Hand)?.add(boltId);

    const stackItem: StackItem = {
      id: stackItemId,
      sourceCardId: boltId,
      controllerSeat: seat1,
      kind: "spell",
      isCast: true,
      targets: [],
      modes: [],
      xValue: null,
      costPaid: null,
      provenance: { originZone: ZoneType.Hand, altCostUsed: null, additionalCostsPaid: [] },
    };
    game.sharedZones.stack.push(stackItem);

    const sa = new SpellAbility(
      mkAst("Counter", {
        DestinationZone: { kind: "literal", raw: "Exile" },
      }),
      counterspellId,
      seat0,
      new Map(),
      [stackItemId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(game.sharedZones.stack.size).toBe(0);
    expect(bolt.zone).toBe(ZoneType.Exile);
    const exile = game.getPlayer(seat1).zones.get(ZoneType.Exile);
    expect(exile?.contains(boltId)).toBe(true);
    const gy = game.getPlayer(seat1).zones.get(ZoneType.Graveyard);
    expect(gy?.contains(boltId)).toBe(false);
  });

  it("DestinationZone$ Library + LibraryPosition$ 0 puts the countered spell on top of library", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const boltId = mkEntityId(10);
    const stackItemId = mkEntityId(11);
    const counterspellId = mkEntityId(20);
    const filler = mkEntityId(30);

    const bolt = new Card(boltId, sourcePaper, seat1, seat1, ZoneType.Hand);
    const counter = new Card(counterspellId, sourcePaper, seat0, seat0, ZoneType.Hand);
    const fillerCard = new Card(filler, sourcePaper, seat1, seat1, ZoneType.Library);
    game.cards.set(boltId, bolt);
    game.cards.set(counterspellId, counter);
    game.cards.set(filler, fillerCard);
    game.getPlayer(seat1).zones.get(ZoneType.Hand)?.add(boltId);
    game.getPlayer(seat1).zones.get(ZoneType.Library)?.add(filler);

    const stackItem: StackItem = {
      id: stackItemId,
      sourceCardId: boltId,
      controllerSeat: seat1,
      kind: "spell",
      isCast: true,
      targets: [],
      modes: [],
      xValue: null,
      costPaid: null,
      provenance: { originZone: ZoneType.Hand, altCostUsed: null, additionalCostsPaid: [] },
    };
    game.sharedZones.stack.push(stackItem);

    const sa = new SpellAbility(
      mkAst("Counter", {
        DestinationZone: { kind: "literal", raw: "Library" },
        LibraryPosition: { kind: "literal", raw: "0" },
      }),
      counterspellId,
      seat0,
      new Map(),
      [stackItemId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(bolt.zone).toBe(ZoneType.Library);
    const lib = game.getPlayer(seat1).zones.get(ZoneType.Library);
    // LibraryPosition$ 0 → top of library (index 0).
    expect(lib?.toArray()[0]).toBe(boltId);
  });
});
