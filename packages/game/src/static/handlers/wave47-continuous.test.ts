// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 47 — Continuous-static broadening flagship tests.
//
// Builds a real Game + LayerEngine, mints two creatures (one controlled
// by seat 0, one by seat 1), then drives ContinuousStaticHandler.build()
// against a battlefield-scoped Affected$ filter and pushes the resulting
// LayerPayload(s) directly into the LayerEngine arrays. Then asserts on
// the per-card Characteristics computed via the engine.
//
// Coverage by flagship:
//   - Glorious Anthem (Affected$ Creature.YouCtrl + AddPower / AddToughness)
//   - Levitation (Affected$ Creature.YouCtrl + AddKeyword$ Flying)
//   - SetPower / SetToughness on Card.Self (Doran-shape; literal value)
//   - Painter's Servant (AddColor on Card)
//   - Conspiracy (AddType on Creature.YouCtrl)
//   - Live Condition$ — Hellbent, Metalcraft, Delirium, FatefulHour,
//     Landfall, Revolt, Spellmastery (Threshold is covered by the
//     Wave 32 threshold-static.test.ts file).
import type { LobbyPlayer, ManaCostAst, PaperCard, StaticAst } from "@mtg-forge-ts/core";
import {
  Color,
  DEFAULT_PAPER_CARD_FLAGS,
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
import type { LayerPayload } from "../../layers/layer-dispatch.js";
import { pushLayerPayload } from "../../layers/layer-dispatch.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { ContinuousStaticHandler } from "./continuous.js";

const alice: LobbyPlayer = { id: "P0", name: "P0", controllerKind: "human" };
const bob: LobbyPlayer = { id: "P1", name: "P1", controllerKind: "human" };

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
  forgeSha: "test",
  cardDataSyncedAt: "2026-04-26T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "deadbeef",
};

const mkGame = (): Game => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xdeadbeefn),
  });
  // Game ctor doesn't populate per-player zone Maps until setupGame runs.
  // Seed each player with the four canonical Forge zones so the live-
  // condition evaluators (Hellbent / Delirium / Spellmastery) can read
  // hand and graveyard sizes deterministically.
  for (const p of game.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
  }
  return game;
};

const mkCreaturePaper = (name: string, types = "Creature — Bear", pt = { p: "2", t: "2" }): PaperCard => ({
  name,
  edition: "TEST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name,
    oracle: "",
    types: TypeLine.parse(types),
    manaCost: { raw: "1G", symbols: [] } satisfies ManaCostAst,
    pt: { power: pt.p, toughness: pt.t },
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  },
});

const mkArtifactPaper = (name: string): PaperCard => ({
  name,
  edition: "TEST",
  collectorNumber: "002",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name,
    oracle: "",
    types: TypeLine.parse("Artifact"),
    manaCost: { raw: "1", symbols: [] } satisfies ManaCostAst,
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  },
});

const mkInstantPaper = (name: string): PaperCard => ({
  name,
  edition: "TEST",
  collectorNumber: "003",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name,
    oracle: "",
    types: TypeLine.parse("Instant"),
    manaCost: { raw: "U", symbols: [] } satisfies ManaCostAst,
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  },
});

interface MintCardOpts {
  readonly game: Game;
  readonly id: number;
  readonly paper: PaperCard;
  readonly seat: 0 | 1;
  readonly zone?: ZoneType;
}
const mintCard = (opts: MintCardOpts): Card => {
  const cid = mkEntityId(opts.id);
  const seat = mkPlayerSeat(opts.seat);
  const card = new Card(cid, opts.paper, seat, seat, opts.zone ?? ZoneType.Battlefield);
  opts.game.cards.set(cid, card);
  return card;
};

const buildAndPush = (game: Game, ast: StaticAst, sourceCardId: number): LayerPayload => {
  const SOURCE = mkEntityId(sourceCardId);
  const STATIC = mkEntityId(sourceCardId + 9000);
  const s = new ContinuousStaticHandler().build(ast, {
    game,
    sourceCardId: SOURCE,
    controllerSeat: mkPlayerSeat(0),
    staticId: STATIC,
  });
  const payload = s.describe() as LayerPayload;
  pushLayerPayload(game, payload);
  game.layerEngine.bumpEpoch("test-push");
  return payload;
};

describe("Wave 47 — Glorious Anthem (Creature.YouCtrl + AddPower/AddToughness)", () => {
  const ast: StaticAst = {
    mode: "Continuous",
    params: {
      Mode: { kind: "literal", raw: "Continuous" },
      Affected: { kind: "literal", raw: "Creature.YouCtrl" },
      AddPower: { kind: "literal", raw: "1" },
      AddToughness: { kind: "literal", raw: "1" },
    },
    activeInZones: [],
  };

  it("buffs only creatures controlled by the static's controller", () => {
    const g = mkGame();
    // Static source (the Anthem itself, an enchantment) controlled by seat 0.
    mintCard({ game: g, id: 50, paper: mkCreaturePaper("Anthem"), seat: 0 });
    const mine = mintCard({ game: g, id: 51, paper: mkCreaturePaper("Mine"), seat: 0 });
    const theirs = mintCard({ game: g, id: 52, paper: mkCreaturePaper("Theirs"), seat: 1 });
    buildAndPush(g, ast, 50);
    const cMine = g.layerEngine.computeCharacteristics(mine.id);
    const cTheirs = g.layerEngine.computeCharacteristics(theirs.id);
    expect(cMine.power).toBe(3);
    expect(cMine.toughness).toBe(3);
    expect(cTheirs.power).toBe(2);
    expect(cTheirs.toughness).toBe(2);
  });
});

describe("Wave 47 — Levitation (Creature.YouCtrl + AddKeyword$ Flying)", () => {
  const ast: StaticAst = {
    mode: "Continuous",
    params: {
      Mode: { kind: "literal", raw: "Continuous" },
      Affected: { kind: "literal", raw: "Creature.YouCtrl" },
      AddKeyword: { kind: "literal", raw: "Flying" },
    },
    activeInZones: [],
  };

  it("grants Flying to controlled creatures only", () => {
    const g = mkGame();
    mintCard({ game: g, id: 60, paper: mkCreaturePaper("Source"), seat: 0 });
    const mine = mintCard({ game: g, id: 61, paper: mkCreaturePaper("Mine"), seat: 0 });
    const theirs = mintCard({ game: g, id: 62, paper: mkCreaturePaper("Theirs"), seat: 1 });
    buildAndPush(g, ast, 60);
    const granted0 = g.layerEngine.effectiveGrantedKeywords(mine.id);
    const granted1 = g.layerEngine.effectiveGrantedKeywords(theirs.id);
    expect(granted0.has("flying")).toBe(true);
    expect(granted1.has("flying")).toBe(false);
  });
});

describe("Wave 47 — SetPower / SetToughness on Card.Self", () => {
  it("SetPower$ 5 sets the source card's power to 5", () => {
    const g = mkGame();
    const ast: StaticAst = {
      mode: "Continuous",
      params: {
        Mode: { kind: "literal", raw: "Continuous" },
        Affected: { kind: "literal", raw: "Card.Self" },
        SetPower: { kind: "literal", raw: "5" },
        SetToughness: { kind: "literal", raw: "5" },
      },
      activeInZones: [],
    };
    const me = mintCard({ game: g, id: 70, paper: mkCreaturePaper("Self"), seat: 0 });
    buildAndPush(g, ast, 70);
    const c = g.layerEngine.computeCharacteristics(me.id);
    expect(c.power).toBe(5);
    expect(c.toughness).toBe(5);
  });
});

describe("Wave 47 — Painter's Servant (AddColor$ on Card)", () => {
  it("adds a color to every battlefield card", () => {
    const g = mkGame();
    const ast: StaticAst = {
      mode: "Continuous",
      params: {
        Mode: { kind: "literal", raw: "Continuous" },
        Affected: { kind: "literal", raw: "Card" },
        AddColor: { kind: "literal", raw: "Black" },
      },
      activeInZones: [],
    };
    mintCard({ game: g, id: 80, paper: mkCreaturePaper("Source"), seat: 0 });
    const target = mintCard({ game: g, id: 81, paper: mkCreaturePaper("Target"), seat: 0 });
    buildAndPush(g, ast, 80);
    const c = g.layerEngine.computeCharacteristics(target.id);
    expect(c.colors.has(Color.Black)).toBe(true);
  });
});

describe("Wave 47 — Conspiracy (AddType$ Goblin on Creature.YouCtrl)", () => {
  it("adds the Goblin subtype to controlled creatures", () => {
    const g = mkGame();
    const ast: StaticAst = {
      mode: "Continuous",
      params: {
        Mode: { kind: "literal", raw: "Continuous" },
        Affected: { kind: "literal", raw: "Creature.YouCtrl" },
        AddType: { kind: "literal", raw: "Goblin" },
      },
      activeInZones: [],
    };
    mintCard({ game: g, id: 90, paper: mkCreaturePaper("Source"), seat: 0 });
    const mine = mintCard({ game: g, id: 91, paper: mkCreaturePaper("Mine"), seat: 0 });
    const theirs = mintCard({ game: g, id: 92, paper: mkCreaturePaper("Theirs"), seat: 1 });
    buildAndPush(g, ast, 90);
    const cMine = g.layerEngine.computeCharacteristics(mine.id);
    const cTheirs = g.layerEngine.computeCharacteristics(theirs.id);
    expect(cMine.subtypes.has("Goblin")).toBe(true);
    expect(cTheirs.subtypes.has("Goblin")).toBe(false);
  });
});

describe("Wave 47 — live Condition$ evaluators", () => {
  const anthemAst = (cond: string): StaticAst => ({
    mode: "Continuous",
    params: {
      Mode: { kind: "literal", raw: "Continuous" },
      Affected: { kind: "literal", raw: "Creature.YouCtrl" },
      AddPower: { kind: "literal", raw: "1" },
      AddToughness: { kind: "literal", raw: "1" },
      Condition: { kind: "literal", raw: cond },
    },
    activeInZones: [],
  });

  it("Hellbent — fires only when controller's hand is empty", () => {
    const g = mkGame();
    mintCard({ game: g, id: 100, paper: mkCreaturePaper("Source"), seat: 0 });
    const mine = mintCard({ game: g, id: 101, paper: mkCreaturePaper("Mine"), seat: 0 });
    buildAndPush(g, anthemAst("Hellbent"), 100);
    // Default: hand has 0 cards (we never seeded the hand zone) — Hellbent ON.
    expect(g.layerEngine.computeCharacteristics(mine.id).power).toBe(3);
    // Add a card to the controller's hand → Hellbent OFF.
    const handZone = g.players[0]?.zones.get(ZoneType.Hand);
    if (!handZone) throw new Error("hand zone missing");
    handZone.add(mkEntityId(999));
    g.layerEngine.bumpEpoch("hand-add");
    expect(g.layerEngine.computeCharacteristics(mine.id).power).toBe(2);
  });

  it("Metalcraft — fires when controller controls 3+ artifacts", () => {
    const g = mkGame();
    mintCard({ game: g, id: 110, paper: mkCreaturePaper("Source"), seat: 0 });
    const mine = mintCard({ game: g, id: 111, paper: mkCreaturePaper("Mine"), seat: 0 });
    buildAndPush(g, anthemAst("Metalcraft"), 110);
    // 0 artifacts → off.
    expect(g.layerEngine.computeCharacteristics(mine.id).power).toBe(2);
    mintCard({ game: g, id: 112, paper: mkArtifactPaper("A1"), seat: 0 });
    mintCard({ game: g, id: 113, paper: mkArtifactPaper("A2"), seat: 0 });
    g.layerEngine.bumpEpoch("a-add");
    expect(g.layerEngine.computeCharacteristics(mine.id).power).toBe(2); // still 2 artifacts
    mintCard({ game: g, id: 114, paper: mkArtifactPaper("A3"), seat: 0 });
    g.layerEngine.bumpEpoch("a-add");
    expect(g.layerEngine.computeCharacteristics(mine.id).power).toBe(3); // 3 artifacts → on
  });

  it("Delirium — fires when 4+ card types in controller's graveyard", () => {
    const g = mkGame();
    mintCard({ game: g, id: 120, paper: mkCreaturePaper("Source"), seat: 0 });
    const mine = mintCard({ game: g, id: 121, paper: mkCreaturePaper("Mine"), seat: 0 });
    buildAndPush(g, anthemAst("Delirium"), 120);
    expect(g.layerEngine.computeCharacteristics(mine.id).power).toBe(2);
    // Seed 4 distinct card types into seat 0's graveyard.
    const gy = g.players[0]?.zones.get(ZoneType.Graveyard);
    if (!gy) throw new Error("gy missing");
    const seedTypes: { id: number; paper: PaperCard }[] = [
      { id: 130, paper: mkCreaturePaper("C1") },
      { id: 131, paper: mkArtifactPaper("A1") },
      { id: 132, paper: mkInstantPaper("I1") },
      {
        id: 133,
        paper: mkCreaturePaper("E1", "Enchantment"),
      },
    ];
    for (const s of seedTypes) {
      const c = mintCard({ game: g, id: s.id, paper: s.paper, seat: 0, zone: ZoneType.Graveyard });
      gy.add(c.id);
    }
    g.layerEngine.bumpEpoch("gy-seed");
    expect(g.layerEngine.computeCharacteristics(mine.id).power).toBe(3);
  });

  it("FatefulHour — fires when controller has ≤5 life", () => {
    const g = mkGame();
    mintCard({ game: g, id: 140, paper: mkCreaturePaper("Source"), seat: 0 });
    const mine = mintCard({ game: g, id: 141, paper: mkCreaturePaper("Mine"), seat: 0 });
    buildAndPush(g, anthemAst("FatefulHour"), 140);
    expect(g.layerEngine.computeCharacteristics(mine.id).power).toBe(2);
    const p = g.players[0];
    if (!p) throw new Error("player missing");
    p.life = 5;
    g.layerEngine.bumpEpoch("life-drop");
    expect(g.layerEngine.computeCharacteristics(mine.id).power).toBe(3);
  });

  it("Landfall — fires when controller played a land this turn", () => {
    const g = mkGame();
    mintCard({ game: g, id: 150, paper: mkCreaturePaper("Source"), seat: 0 });
    const mine = mintCard({ game: g, id: 151, paper: mkCreaturePaper("Mine"), seat: 0 });
    buildAndPush(g, anthemAst("Landfall"), 150);
    expect(g.layerEngine.computeCharacteristics(mine.id).power).toBe(2);
    g.flags.landsPlayedThisTurn.set(mkPlayerSeat(0), 1);
    g.layerEngine.bumpEpoch("land-play");
    expect(g.layerEngine.computeCharacteristics(mine.id).power).toBe(3);
  });

  it("Revolt — fires when a permanent left controller's bf this turn", () => {
    const g = mkGame();
    mintCard({ game: g, id: 160, paper: mkCreaturePaper("Source"), seat: 0 });
    const mine = mintCard({ game: g, id: 161, paper: mkCreaturePaper("Mine"), seat: 0 });
    buildAndPush(g, anthemAst("Revolt"), 160);
    expect(g.layerEngine.computeCharacteristics(mine.id).power).toBe(2);
    g.flags.permanentsLeftBfThisTurn.set(mkPlayerSeat(0), 1);
    g.layerEngine.bumpEpoch("revolt");
    expect(g.layerEngine.computeCharacteristics(mine.id).power).toBe(3);
  });

  it("Spellmastery — fires when ≥2 instants/sorceries in graveyard", () => {
    const g = mkGame();
    mintCard({ game: g, id: 170, paper: mkCreaturePaper("Source"), seat: 0 });
    const mine = mintCard({ game: g, id: 171, paper: mkCreaturePaper("Mine"), seat: 0 });
    buildAndPush(g, anthemAst("Spellmastery"), 170);
    expect(g.layerEngine.computeCharacteristics(mine.id).power).toBe(2);
    const gy = g.players[0]?.zones.get(ZoneType.Graveyard);
    if (!gy) throw new Error("gy missing");
    const i1 = mintCard({ game: g, id: 172, paper: mkInstantPaper("I1"), seat: 0, zone: ZoneType.Graveyard });
    gy.add(i1.id);
    g.layerEngine.bumpEpoch("gy-i1");
    expect(g.layerEngine.computeCharacteristics(mine.id).power).toBe(2); // only 1 instant
    const i2 = mintCard({ game: g, id: 173, paper: mkInstantPaper("I2"), seat: 0, zone: ZoneType.Graveyard });
    gy.add(i2.id);
    g.layerEngine.bumpEpoch("gy-i2");
    expect(g.layerEngine.computeCharacteristics(mine.id).power).toBe(3); // 2 instants → on
  });
});

describe("Wave 47 — backwards compat: Card.EnchantedBy single-target shape preserved", () => {
  it("Bestow-shape Card.EnchantedBy targetCardIdFn returns the attached id", () => {
    const g = mkGame();
    const ast: StaticAst = {
      mode: "Continuous",
      params: {
        Mode: { kind: "literal", raw: "Continuous" },
        Affected: { kind: "literal", raw: "Card.EnchantedBy" },
        AddPower: { kind: "literal", raw: "4" },
        AddToughness: { kind: "literal", raw: "2" },
      },
      activeInZones: [],
    };
    const aura = mintCard({ game: g, id: 200, paper: mkCreaturePaper("Aura"), seat: 0 });
    const target = mintCard({ game: g, id: 201, paper: mkCreaturePaper("Target"), seat: 0 });
    aura.attachedTo = target.id;
    const SOURCE = aura.id;
    const STATIC = mkEntityId(9999);
    const s = new ContinuousStaticHandler().build(ast, {
      game: g,
      sourceCardId: SOURCE,
      controllerSeat: mkPlayerSeat(0),
      staticId: STATIC,
    });
    const payload = s.describe() as LayerPayload;
    expect(payload.kind).toBe("pt-modify");
    if (payload.kind !== "pt-modify") return;
    expect(payload.effect.targetCardIdFn?.()).toBe(target.id);
  });
});
