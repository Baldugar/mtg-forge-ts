// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.F — Continuous static extra sub-payloads — flagship tests.
//
// Three sub-payloads on the existing Continuous static handler. Each
// extends a different surface:
//   1. RemoveKeyword$ — Layer 6 negative keyword removal applied AFTER
//      additive grants. Smoke + multi-keyword + add-then-remove combo.
//   2. AddAbility$    — granted activated SA via SVar dispatch; extends
//      Wave 60.B's GrantedAbilitySweep with a 4th `activated` kind.
//   3. MayLookAt$     — face-down peek-rights gate; consults the gate
//      via the `mayLookAtFaceDown` query helper.
import type { LobbyPlayer, ManaCostAst, PaperCard, SVarAst, StaticAst } from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import { hasKeyword } from "../../combat/damage-assignment-helpers.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import type { LayerPayload } from "../../layers/layer-dispatch.js";
import { pushLayerPayload, removeLayerPayload } from "../../layers/layer-dispatch.js";
import { mayLookAtFaceDown } from "../../statics/wave60-may-look-at-gate.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { ContinuousStaticHandler } from "./continuous.js";

// Side-effect imports so the granted-ability sweep can find handler
// classes for any inner T:/R:/S: bodies. (The activated kind doesn't need
// the trigger / replacement registries, but importing them is cheap and
// keeps the test future-proof if a granted activated SVar's handler key
// transitively pulls in shared infrastructure.)
import "../../trigger/handlers/index.js";
import "../../replacement/handlers/index.js";
import "./index.js";

// ── fixtures ────────────────────────────────────────────────────────────────
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
  for (const p of game.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
  }
  return game;
};

const mkPaperWithSVars = (name: string, types: string, svars: ReadonlyMap<string, SVarAst>): PaperCard => ({
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
    manaCost: { raw: "1W", symbols: [] } satisfies ManaCostAst,
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars,
  },
});

const mkBear = (name: string): PaperCard => ({
  name,
  edition: "TEST",
  collectorNumber: "002",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name,
    oracle: "",
    types: TypeLine.parse("Creature — Bear"),
    manaCost: { raw: "1G", symbols: [] } satisfies ManaCostAst,
    pt: { power: "2", toughness: "2" },
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  },
});

interface MintOpts {
  readonly game: Game;
  readonly id: number;
  readonly paper: PaperCard;
  readonly seat?: 0 | 1;
  readonly zone?: ZoneType;
  readonly intrinsicKeywords?: readonly string[];
}
const mintCard = (opts: MintOpts): Card => {
  const cid = mkEntityId(opts.id);
  const seat = mkPlayerSeat(opts.seat ?? 0);
  const card = new Card(cid, opts.paper, seat, seat, opts.zone ?? ZoneType.Battlefield);
  if (opts.intrinsicKeywords && opts.intrinsicKeywords.length > 0) {
    card.keywords = new Set(opts.intrinsicKeywords);
  }
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

// ── 1. RemoveKeyword$ smoke ─────────────────────────────────────────────────
describe("Wave 60.F — RemoveKeyword$ Layer 6 negative keyword removal", () => {
  const ast: StaticAst = {
    mode: "Continuous",
    params: {
      Mode: { kind: "literal", raw: "Continuous" },
      Affected: { kind: "literal", raw: "Creature.YouCtrl" },
      RemoveKeyword: { kind: "literal", raw: "Flying" },
    },
    activeInZones: [],
  };

  it("strips Flying from matched creatures; unmatched still has it", () => {
    const g = mkGame();
    mintCard({ game: g, id: 200, paper: mkPaperWithSVars("Source", "Enchantment", new Map()), seat: 0 });
    const mine = mintCard({
      game: g,
      id: 201,
      paper: mkBear("Mine"),
      seat: 0,
      intrinsicKeywords: ["flying"],
    });
    const theirs = mintCard({
      game: g,
      id: 202,
      paper: mkBear("Theirs"),
      seat: 1,
      intrinsicKeywords: ["flying"],
    });
    expect(hasKeyword(g, mine.id, "flying")).toBe(true);
    expect(hasKeyword(g, theirs.id, "flying")).toBe(true);

    buildAndPush(g, ast, 200);

    // Mine (matched) loses flying; theirs (unmatched) retains it.
    expect(hasKeyword(g, mine.id, "flying")).toBe(false);
    expect(hasKeyword(g, theirs.id, "flying")).toBe(true);
  });

  it("multi-keyword removal — strips Flying & Trample in one static", () => {
    const g = mkGame();
    const multiAst: StaticAst = {
      mode: "Continuous",
      params: {
        Mode: { kind: "literal", raw: "Continuous" },
        Affected: { kind: "literal", raw: "Creature.YouCtrl" },
        RemoveKeyword: { kind: "literal", raw: "Flying & Trample" },
      },
      activeInZones: [],
    };
    mintCard({ game: g, id: 210, paper: mkPaperWithSVars("Source", "Enchantment", new Map()), seat: 0 });
    const mine = mintCard({
      game: g,
      id: 211,
      paper: mkBear("Mine"),
      seat: 0,
      intrinsicKeywords: ["flying", "trample", "vigilance"],
    });
    expect(hasKeyword(g, mine.id, "flying")).toBe(true);
    expect(hasKeyword(g, mine.id, "trample")).toBe(true);
    expect(hasKeyword(g, mine.id, "vigilance")).toBe(true);

    buildAndPush(g, multiAst, 210);

    expect(hasKeyword(g, mine.id, "flying")).toBe(false);
    expect(hasKeyword(g, mine.id, "trample")).toBe(false);
    // Unrelated keyword survives — only listed names are removed.
    expect(hasKeyword(g, mine.id, "vigilance")).toBe(true);
  });

  it("add-then-remove combo: AddKeyword$ Trample + RemoveKeyword$ Flying nets only Trample", () => {
    const g = mkGame();
    const comboAst: StaticAst = {
      mode: "Continuous",
      params: {
        Mode: { kind: "literal", raw: "Continuous" },
        Affected: { kind: "literal", raw: "Creature.YouCtrl" },
        AddKeyword: { kind: "literal", raw: "Trample" },
        RemoveKeyword: { kind: "literal", raw: "Flying" },
      },
      activeInZones: [],
    };
    mintCard({ game: g, id: 220, paper: mkPaperWithSVars("Source", "Enchantment", new Map()), seat: 0 });
    const mine = mintCard({
      game: g,
      id: 221,
      paper: mkBear("Mine"),
      seat: 0,
      intrinsicKeywords: ["flying"],
    });
    expect(hasKeyword(g, mine.id, "flying")).toBe(true);
    expect(hasKeyword(g, mine.id, "trample")).toBe(false);

    buildAndPush(g, comboAst, 220);

    // Net: addition lands, removal still wins on Flying.
    expect(hasKeyword(g, mine.id, "trample")).toBe(true);
    expect(hasKeyword(g, mine.id, "flying")).toBe(false);
  });
});

// ── 2. AddAbility$ — granted activated ability ─────────────────────────────
describe("Wave 60.F — AddAbility$ grants an activated ability per matched card", () => {
  // SVar body (no AB: prefix; Forge convention). The granted activated
  // SA is a tap-and-gain-1-life ability stored on the static-source card
  // and granted to every matched creature.
  const activatedSVar: SVarAst = {
    kind: "value",
    raw: "AB$ GainLife | Cost$ T | LifeAmount$ 1 | SpellDescription$ Gain 1 life.",
  };
  const svars = new Map<string, SVarAst>([["LifeAct", activatedSVar]]);

  const ast: StaticAst = {
    mode: "Continuous",
    params: {
      Mode: { kind: "literal", raw: "Continuous" },
      Affected: { kind: "literal", raw: "Creature.YouCtrl" },
      AddAbility: { kind: "literal", raw: "LifeAct" },
    },
    activeInZones: [],
  };

  it("granted activated SA appears on matched cards; absent on unmatched", () => {
    const g = mkGame();
    mintCard({ game: g, id: 300, paper: mkPaperWithSVars("Lord", "Enchantment", svars), seat: 0 });
    const mine = mintCard({ game: g, id: 301, paper: mkBear("Mine"), seat: 0 });
    const theirs = mintCard({ game: g, id: 302, paper: mkBear("Theirs"), seat: 1 });

    const mineBefore = mine.spellAbilities.length;
    const theirsBefore = theirs.spellAbilities.length;
    buildAndPush(g, ast, 300);

    // Mine picked up the granted activated SA; theirs did not.
    expect(mine.spellAbilities.length).toBe(mineBefore + 1);
    expect(theirs.spellAbilities.length).toBe(theirsBefore);

    // The granted SA is bound to the matched card (sourceCardId === Mine).
    const grantedSA = mine.spellAbilities[mine.spellAbilities.length - 1];
    expect(grantedSA).toBeDefined();
    if (!grantedSA) return;
    expect(grantedSA.sourceCardId).toBe(mine.id);
    expect(grantedSA.handlerKey).toBe("GainLife");
    // grantedBy provenance is stamped for audit / snapshot.
    const tagged = grantedSA as unknown as {
      grantedBy?: { staticId: unknown; svarName: string };
    };
    expect(tagged.grantedBy).toBeDefined();
    expect(tagged.grantedBy?.svarName).toBe("LifeAct");
  });

  it("granted activated SA is removed on static deactivation", () => {
    const g = mkGame();
    mintCard({ game: g, id: 310, paper: mkPaperWithSVars("Lord", "Enchantment", svars), seat: 0 });
    const mine = mintCard({ game: g, id: 311, paper: mkBear("Mine"), seat: 0 });

    const before = mine.spellAbilities.length;
    const payload = buildAndPush(g, ast, 310);
    expect(mine.spellAbilities.length).toBe(before + 1);

    removeLayerPayload(g, payload);
    // Splice on unregister restores the original list.
    expect(mine.spellAbilities.length).toBe(before);
  });
});

// ── 3. MayLookAt$ — face-down peek-rights gate ──────────────────────────────
describe("Wave 60.F — MayLookAt$ face-down peek-rights gate", () => {
  it("MayLookAt$ You — controller seat sees true, opponent sees false", () => {
    const g = mkGame();
    const ast: StaticAst = {
      mode: "Continuous",
      params: {
        Mode: { kind: "literal", raw: "Continuous" },
        Affected: { kind: "literal", raw: "Card.Self" },
        MayLookAt: { kind: "literal", raw: "You" },
      },
      activeInZones: [],
    };
    const source = mintCard({
      game: g,
      id: 400,
      paper: mkPaperWithSVars("Telepathy", "Enchantment", new Map()),
      seat: 0,
    });

    // Pre-push: no gates, no peek rights.
    expect(mayLookAtFaceDown(g, source.id, mkPlayerSeat(0))).toBe(false);
    expect(mayLookAtFaceDown(g, source.id, mkPlayerSeat(1))).toBe(false);

    buildAndPush(g, ast, 400);

    // Controller (seat 0) has peek rights via "You"; opponent does not.
    expect(mayLookAtFaceDown(g, source.id, mkPlayerSeat(0))).toBe(true);
    expect(mayLookAtFaceDown(g, source.id, mkPlayerSeat(1))).toBe(false);
  });

  it("MayLookAt$ Each — every seat has peek rights; gate is removed on deactivation", () => {
    const g = mkGame();
    const ast: StaticAst = {
      mode: "Continuous",
      params: {
        Mode: { kind: "literal", raw: "Continuous" },
        Affected: { kind: "literal", raw: "Card.Self" },
        MayLookAt: { kind: "literal", raw: "Each" },
      },
      activeInZones: [],
    };
    const source = mintCard({
      game: g,
      id: 410,
      paper: mkPaperWithSVars("Lantern", "Artifact", new Map()),
      seat: 0,
    });

    const payload = buildAndPush(g, ast, 410);
    // Both seats see the gate as admitting them.
    expect(mayLookAtFaceDown(g, source.id, mkPlayerSeat(0))).toBe(true);
    expect(mayLookAtFaceDown(g, source.id, mkPlayerSeat(1))).toBe(true);

    removeLayerPayload(g, payload);
    // Post-deactivation, gate gone — every seat is denied.
    expect(mayLookAtFaceDown(g, source.id, mkPlayerSeat(0))).toBe(false);
    expect(mayLookAtFaceDown(g, source.id, mkPlayerSeat(1))).toBe(false);
  });
});
