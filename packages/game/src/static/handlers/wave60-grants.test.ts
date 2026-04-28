// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.B — Continuous static grants of T/R/S abilities — flagship tests.
//
// Three end-to-end shapes:
//   1. AddTrigger$ — Anthem grants "when this dies, draw a card" to
//      every controlled creature; killing a matched creature pushes a
//      pending triggered ability onto the trigger registry.
//   2. AddStaticAbility$ — Anthem grants nested "+1/+1" sub-static (an
//      `S:Mode$ Continuous | Affected$ Card.Self | AddPower$ 1 | AddToughness$ 1`)
//      to every controlled creature; the matched creatures' effective
//      P/T reflects the buff.
//   3. AddReplacement$ — Anthem grants "if this would die, exile it
//      instead" to every controlled creature; the granted replacement
//      ability gathers in `replacementRegistry.gatherApplicable` for
//      the matched card's death intent.
//
// Lifecycle assertions across all three:
//   - Initial sweep registers grants for currently-matched cards.
//   - Live filter membership: minting a new matching card + bumping the
//     epoch grows the granted set; removing a matching card from the
//     filter shrinks it.
//   - Static deactivation (removeLayerPayload) tears down all current
//     grants symmetrically.
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
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import type { LayerPayload } from "../../layers/layer-dispatch.js";
import { pushLayerPayload, removeLayerPayload } from "../../layers/layer-dispatch.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { ContinuousStaticHandler } from "./continuous.js";

// Side-effect imports to register the trigger / replacement / static
// handler families used by buildGrantedTrigger / buildGrantedReplacement /
// buildGrantedStatic.
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

const mkCreaturePaperWithSVars = (name: string, svars: ReadonlyMap<string, SVarAst>): PaperCard => ({
  name,
  edition: "TEST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name,
    oracle: "",
    types: TypeLine.parse("Enchantment"),
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
}
const mintCard = (opts: MintOpts): Card => {
  const cid = mkEntityId(opts.id);
  const seat = mkPlayerSeat(opts.seat ?? 0);
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

// ── 1. AddTrigger$ — granted "when this dies, draw a card" ──────────────────
describe("Wave 60.B — AddTrigger$ grants a triggered ability per matched card", () => {
  // SVar body (no T: prefix; Forge convention). The granted trigger is a
  // Dies-shape ChangesZone with Execute$ -> a DB$ Draw ability SVar on
  // the static-source card.
  const triggerSVar: SVarAst = {
    kind: "value",
    raw: "Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | Execute$ TrigDraw | TriggerDescription$ When this creature dies, draw a card.",
  };
  const drawSVar: SVarAst = {
    kind: "ability",
    raw: "DB$ Draw | NumCards$ 1",
    ability: {
      handlerKey: "Draw",
      params: { NumCards: { kind: "literal", raw: "1" } },
    },
  };
  const svars = new Map<string, SVarAst>([
    ["DiesGrant", triggerSVar],
    ["TrigDraw", drawSVar],
  ]);

  const ast: StaticAst = {
    mode: "Continuous",
    params: {
      Mode: { kind: "literal", raw: "Continuous" },
      Affected: { kind: "literal", raw: "Creature.YouCtrl" },
      AddTrigger: { kind: "literal", raw: "DiesGrant" },
    },
    activeInZones: [],
  };

  it("registers a granted trigger for each currently-matched creature", () => {
    const g = mkGame();
    mintCard({ game: g, id: 50, paper: mkCreaturePaperWithSVars("Anthem", svars), seat: 0 });
    const mine1 = mintCard({ game: g, id: 51, paper: mkBear("Mine1"), seat: 0 });
    const mine2 = mintCard({ game: g, id: 52, paper: mkBear("Mine2"), seat: 0 });
    mintCard({ game: g, id: 53, paper: mkBear("Theirs"), seat: 1 });

    const triggerSizeBefore = g.triggerRegistry.size();
    buildAndPush(g, ast, 50);
    const triggerSizeAfter = g.triggerRegistry.size();

    // Two granted triggers for the two seat-0 creatures (the static's
    // source card itself is an Enchantment so it doesn't match
    // Creature.YouCtrl).
    expect(triggerSizeAfter - triggerSizeBefore).toBe(2);

    // Each granted trigger fires only on its matched card's death.
    // We verify by finding the triggers that match a Mine1-dies event.
    const dieEvent = {
      kind: "CardChangedZone" as const,
      version: 1 as const,
      turn: 1,
      phase: "Main1" as never,
      payload: {
        cardId: mine1.id,
        fromZone: ZoneType.Battlefield,
        toZone: ZoneType.Graveyard,
      },
    };
    let matchCount = 0;
    // Walk every trigger in the registry; we don't have a public iterator,
    // so we drive onEvent and read the pending queue.
    g.triggerRegistry.onEvent(dieEvent as never);
    matchCount = g.triggerRegistry.peekPending().length;
    g.triggerRegistry.drain(); // clear for cleanliness
    expect(matchCount).toBe(1);

    // mine2 dying ALSO fires exactly one (its own granted trigger).
    g.triggerRegistry.onEvent({
      kind: "CardChangedZone",
      version: 1,
      turn: 1,
      phase: "Main1" as never,
      payload: {
        cardId: mine2.id,
        fromZone: ZoneType.Battlefield,
        toZone: ZoneType.Graveyard,
      },
    } as never);
    expect(g.triggerRegistry.peekPending().length).toBe(1);
  });

  it("tears down all granted triggers on removeLayerPayload", () => {
    const g = mkGame();
    mintCard({ game: g, id: 60, paper: mkCreaturePaperWithSVars("Anthem", svars), seat: 0 });
    mintCard({ game: g, id: 61, paper: mkBear("Mine1"), seat: 0 });
    mintCard({ game: g, id: 62, paper: mkBear("Mine2"), seat: 0 });
    const before = g.triggerRegistry.size();
    const payload = buildAndPush(g, ast, 60);
    expect(g.triggerRegistry.size()).toBe(before + 2);
    removeLayerPayload(g, payload);
    expect(g.triggerRegistry.size()).toBe(before);
  });

  it("live membership: a new matching creature added later receives a grant on epoch bump", () => {
    const g = mkGame();
    mintCard({ game: g, id: 70, paper: mkCreaturePaperWithSVars("Anthem", svars), seat: 0 });
    mintCard({ game: g, id: 71, paper: mkBear("Mine1"), seat: 0 });
    const before = g.triggerRegistry.size();
    buildAndPush(g, ast, 70);
    expect(g.triggerRegistry.size()).toBe(before + 1);
    // Add a new matching creature — should be added to the granted set
    // on the next bumpEpoch call.
    mintCard({ game: g, id: 72, paper: mkBear("Mine2"), seat: 0 });
    g.layerEngine.bumpEpoch("test-mint");
    expect(g.triggerRegistry.size()).toBe(before + 2);
  });
});

// ── 2. AddStaticAbility$ — granted "+1/+1" sub-static ───────────────────────
describe("Wave 60.B — AddStaticAbility$ grants a nested static per matched card", () => {
  const subStaticSVar: SVarAst = {
    kind: "value",
    raw: "Mode$ Continuous | Affected$ Card.Self | AddPower$ 1 | AddToughness$ 1",
  };
  const svars = new Map<string, SVarAst>([["AnthemBuff", subStaticSVar]]);

  const ast: StaticAst = {
    mode: "Continuous",
    params: {
      Mode: { kind: "literal", raw: "Continuous" },
      Affected: { kind: "literal", raw: "Creature.YouCtrl" },
      AddStaticAbility: { kind: "literal", raw: "AnthemBuff" },
    },
    activeInZones: [],
  };

  it("matched creatures pick up +1/+1 effective P/T via the granted static", () => {
    const g = mkGame();
    mintCard({ game: g, id: 80, paper: mkCreaturePaperWithSVars("Anthem", svars), seat: 0 });
    const mine = mintCard({ game: g, id: 81, paper: mkBear("Mine"), seat: 0 });
    const theirs = mintCard({ game: g, id: 82, paper: mkBear("Theirs"), seat: 1 });

    // Pre-grant: 2/2.
    expect(g.layerEngine.computeCharacteristics(mine.id).power).toBe(2);
    expect(g.layerEngine.computeCharacteristics(mine.id).toughness).toBe(2);

    buildAndPush(g, ast, 80);

    // Granted sub-static lands +1/+1 on every Creature.YouCtrl.
    expect(g.layerEngine.computeCharacteristics(mine.id).power).toBe(3);
    expect(g.layerEngine.computeCharacteristics(mine.id).toughness).toBe(3);
    // Opponent's creature is untouched — Affected$ filter excludes them.
    expect(g.layerEngine.computeCharacteristics(theirs.id).power).toBe(2);
    expect(g.layerEngine.computeCharacteristics(theirs.id).toughness).toBe(2);
  });

  it("removeLayerPayload restores baseline P/T", () => {
    const g = mkGame();
    mintCard({ game: g, id: 90, paper: mkCreaturePaperWithSVars("Anthem", svars), seat: 0 });
    const mine = mintCard({ game: g, id: 91, paper: mkBear("Mine"), seat: 0 });
    const payload = buildAndPush(g, ast, 90);
    expect(g.layerEngine.computeCharacteristics(mine.id).power).toBe(3);
    removeLayerPayload(g, payload);
    g.layerEngine.bumpEpoch("test-remove");
    expect(g.layerEngine.computeCharacteristics(mine.id).power).toBe(2);
  });
});

// ── 3. AddReplacement$ — granted "if this would die, exile it instead" ──────
describe("Wave 60.B — AddReplacement$ grants a replacement per matched card", () => {
  const replacementSVar: SVarAst = {
    kind: "value",
    raw: "Event$ Moved | Origin$ Battlefield | Destination$ Graveyard | ValidCard$ Card.Self | ReplaceWith$ DBExile | Description$ If this creature would die, exile it instead.",
  };
  const svars = new Map<string, SVarAst>([["DieExile", replacementSVar]]);

  const ast: StaticAst = {
    mode: "Continuous",
    params: {
      Mode: { kind: "literal", raw: "Continuous" },
      Affected: { kind: "literal", raw: "Creature.YouCtrl" },
      AddReplacement: { kind: "literal", raw: "DieExile" },
    },
    activeInZones: [],
  };

  it("registers a granted replacement for each matched creature", () => {
    const g = mkGame();
    mintCard({ game: g, id: 100, paper: mkCreaturePaperWithSVars("Anthem", svars), seat: 0 });
    const mine = mintCard({ game: g, id: 101, paper: mkBear("Mine"), seat: 0 });
    mintCard({ game: g, id: 102, paper: mkBear("Theirs"), seat: 1 });

    const before = g.replacementRegistry.size();
    buildAndPush(g, ast, 100);
    const after = g.replacementRegistry.size();
    expect(after - before).toBe(1);

    // Probe gatherApplicable with a Mine-dies intent — the granted
    // replacement should match.
    const intent = {
      kind: "moveTo" as const,
      cardId: mine.id,
      fromZone: ZoneType.Battlefield,
      toZone: ZoneType.Graveyard,
    };
    const applicable = g.replacementRegistry.gatherApplicable(intent as never, new Set());
    expect(applicable.length).toBeGreaterThanOrEqual(1);
    // The granted replacement redirects Graveyard → Exile.
    const granted = applicable.find(
      (r) => (r as unknown as { grantedBy?: { staticId: unknown } }).grantedBy !== undefined,
    );
    expect(granted).toBeDefined();
    if (!granted) return;
    const result = granted.apply(intent as never, g);
    expect(result).not.toBeNull();
    if (!result) return;
    expect((result as unknown as { toZone: ZoneType }).toZone).toBe(ZoneType.Exile);
  });

  it("removeLayerPayload tears down the granted replacement", () => {
    const g = mkGame();
    mintCard({ game: g, id: 110, paper: mkCreaturePaperWithSVars("Anthem", svars), seat: 0 });
    mintCard({ game: g, id: 111, paper: mkBear("Mine"), seat: 0 });
    const before = g.replacementRegistry.size();
    const payload = buildAndPush(g, ast, 110);
    expect(g.replacementRegistry.size()).toBe(before + 1);
    removeLayerPayload(g, payload);
    expect(g.replacementRegistry.size()).toBe(before);
  });
});
