// SPDX-License-Identifier: GPL-3.0-or-later
// Plot flagship test (Bloomburrow / CR 718).
//
// Plot — During controller's main phase at sorcery speed, the controller may
// pay the plot cost and exile this card from hand face-up. On a LATER turn
// they may cast it for free.
//
// Test card (synthetic — Forge cardsfolder is not in this repo):
//   Name:Test Plot Creature
//   ManaCost:3 R
//   Types:Creature Bunny
//   PT:2/2
//   K:Plot:1 R
//
// Scenarios covered:
//   1. Plot the card: activate the synthesized hand-zone activated ability
//      on turn 1. Verify card moves Hand → Exile, plotted=true,
//      plottedOnTurn=1, CardPlotted event emitted.
//   2. SAME turn cast attempt: altCostKey="Plot" must NOT be available
//      because plottedOnTurn === game.turn (CR 718 "later turn" gate).
//   3. Advance to turn 2. altCostKey="Plot" succeeds; cost paid is FREE
//      (zero mana drained); card resolves and enters battlefield as a
//      creature. Provenance.altCostUsed === "Plot",
//      provenance.alternativeZoneDestination === Battlefield.
import { parseCard } from "@mtg-forge-ts/cards";
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  Color,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaProduced,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../src/card.js";
import type { CastProposal } from "../../src/cast/cast-pipeline.js";
import type { GameMeta } from "../../src/game-meta.js";
import type { GameRules } from "../../src/game-rules.js";
import { Game } from "../../src/game.js";
import { ManaPool } from "../../src/mana/mana-pool.js";
import { altCostRegistry } from "../../src/registries/alt-cost-registry.js";
import { resolveStackItem } from "../../src/resolve/effect-resolve.js";
import type { StackItem } from "../../src/stack/stack-item.js";
import { Battlefield } from "../../src/zone/zones/battlefield.js";
import { Exile } from "../../src/zone/zones/exile.js";
import { Graveyard } from "../../src/zone/zones/graveyard.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

// --- Bootstrap registries ---
import "../../src/ability/effects/index.js";
import "../../src/cost/parts/index.js";
import "../../src/svar/selectors/number.js";
import "../../src/altcost/index.js";
import "../../src/keyword/handlers/index.js";

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
  cardDataSyncedAt: "2026-04-26T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "718",
};

// Synthetic Bloomburrow plot creature. Real Forge plot cards live in
// cardsfolder/ but that directory isn't checked into this repo; this
// minimal definition is sufficient to drive the keyword + alt-cost paths.
const plotCreatureSrc = `${[
  "Name:Test Plot Creature",
  "ManaCost:3 R",
  "Types:Creature Bunny",
  "PT:2/2",
  "K:Plot:1 R",
].join("\n")}\n`;

function makeGame(): Game {
  return new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(718n) });
}

function setupZones(game: Game, seat: PlayerSeat): void {
  const player = game.getPlayer(seat);
  player.zones.set(ZoneType.Library, new Library(ZoneType.Library, seat));
  player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, seat));
  player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, seat));
  player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, seat));
  player.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, seat));
}

function makePaper(name: string, src: string, srcFile: string): PaperCard {
  const def = parseCard(src, srcFile);
  return {
    name,
    edition: "BLB",
    collectorNumber: "1",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition: def,
  };
}

function addCardToHand(game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card {
  const card = new Card(id, paper, seat, seat, ZoneType.Hand);
  game.cards.set(id, card);
  const hand = game.getPlayer(seat).zones.get(ZoneType.Hand);
  if (!hand) throw new Error("test: missing hand zone");
  hand.add(id);
  return card;
}

// Drive a generator, automatically responding to decisions/replacements.
function driveGen(gen: Generator<unknown, unknown, unknown>): { events: string[] } {
  const events: string[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value as {
      kind?: string;
      event?: { kind?: string };
      request?: { kind?: string; replacementIds?: number[] };
    };
    if (y.kind === "event" && y.event?.kind) {
      events.push(y.event.kind);
      step = gen.next();
    } else if (y.kind === "decision" && y.request?.kind === "orderReplacements") {
      step = gen.next({ order: [...(y.request.replacementIds ?? [])] });
    } else if (y.kind === "decision" && y.request?.kind === "activateManaAbilities") {
      step = gen.next({ kind: "activateManaAbilities", done: true });
    } else {
      step = gen.next();
    }
  }
  return { events };
}

function drainCast(gen: Generator<{ kind: string }, StackItem | null, unknown>): {
  events: string[];
  result: StackItem | null;
} {
  const events: string[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value as {
      kind: string;
      event?: { kind?: string };
      request?: { kind?: string; legalTargets?: readonly unknown[] };
    };
    if (y.kind === "event" && y.event?.kind) {
      events.push(y.event.kind);
      step = gen.next();
    } else if (y.kind === "decision" && y.request?.kind === "activateManaAbilities") {
      step = gen.next({ kind: "activateManaAbilities", done: true });
    } else if (y.kind === "decision" && y.request?.kind === "chooseCastTargets") {
      const targets = y.request.legalTargets ?? [];
      const chosen = targets[targets.length - 1];
      step = gen.next({
        kind: "chooseCastTargets",
        targets: chosen !== undefined ? [chosen] : [],
      });
    } else {
      step = gen.next();
    }
  }
  return { events, result: step.value };
}

describe("Flagship: Plot — Bloomburrow end-to-end", () => {
  it("plot a card from hand on turn 1, then cast for free on turn 2", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    setupZones(game, seat0);
    setupZones(game, seat1);
    game.turn = 1;

    const cardId = mkEntityId(9000);
    const paper = makePaper("Test Plot Creature", plotCreatureSrc, "test-plot.txt");
    const card = addCardToHand(game, paper, seat0, cardId);
    card.activateKeywordsFromDefinition(game);

    expect(card.zone).toBe(ZoneType.Hand);
    expect(card.keywords?.has("plot")).toBe(true);

    // PlotKeywordHandler should have synthesized a Hand-zone activated ability
    // tagged "plot"+"sorcery-speed".
    const plotIndex = card.spellAbilities.findIndex(
      (sa) => sa.activeInZones.has(ZoneType.Hand) && sa.tags.has("plot"),
    );
    expect(plotIndex).toBeGreaterThanOrEqual(0);
    const plotSa = card.spellAbilities[plotIndex];
    if (!plotSa) throw new Error("test: plot SA not found");
    expect(plotSa.handlerKey).toBe("Plot");
    expect(plotSa.tags.has("sorcery-speed")).toBe(true);
    // Cost is the plot cost ({1}{R}), NOT the card's full mana cost ({3}{R}).
    expect(plotSa.ast.cost.raw).toBe("1 R");

    // --- Activate the plot ability: pays {1}{R}, exiles self, sets plotted ---
    // Seed exactly {1}{R}.
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Red));
    game.getPlayer(seat0).manaPool = pool;
    expect(pool.size()).toBe(2);

    const { events: activateEvents } = driveGen(
      game.action.activateAbility(cardId, plotIndex, seat0) as Generator<unknown, unknown, unknown>,
    );

    // Mana drained.
    expect(pool.size()).toBe(0);
    expect(activateEvents).toContain("AbilityActivated");

    // Stack has the Plot resolution item — resolve it.
    expect(game.sharedZones.stack.size).toBe(1);
    const stackItem = game.sharedZones.stack.top();
    if (!stackItem) throw new Error("test: stack empty after activateAbility");
    const { events: resolveEvents } = driveGen(
      resolveStackItem(game, stackItem) as Generator<unknown, unknown, unknown>,
    );

    // PlotEffect emits CardPlotted; resolve emits StackItemResolved.
    expect(resolveEvents).toContain("CardPlotted");
    expect(resolveEvents).toContain("StackItemResolved");

    // Card moved Hand → Exile (face-up).
    expect(card.zone).toBe(ZoneType.Exile);
    expect(game.sharedZones.exile.contains(cardId)).toBe(true);
    expect(card.plotted).toBe(true);
    expect(card.plottedOnTurn).toBe(1);

    // --- Same turn: Plot alt-cost is NOT available (later-turn rule) ---
    let available = altCostRegistry.available(card, game);
    expect(available.find((a) => a.handlerKey === "Plot")).toBeUndefined();

    // --- Advance to turn 2 ---
    game.turn = 2;

    // Now Plot should be available.
    available = altCostRegistry.available(card, game);
    const plotAvail = available.find((a) => a.handlerKey === "Plot");
    expect(plotAvail).toBeDefined();

    // --- Cast for free via Plot alt-cost ---
    // Empty pool — proves the cast pays NO mana.
    game.getPlayer(seat0).manaPool = new ManaPool();
    expect((game.getPlayer(seat0).manaPool as ManaPool).size()).toBe(0);

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: cardId,
      originZone: ZoneType.Exile,
      asSpecialAction: false,
      altCostKey: "Plot",
    };

    const { events: castEvents, result: castStackItem } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );

    expect(castStackItem).not.toBeNull();
    expect(castEvents).toContain("SpellCast");
    // Pool still empty — no mana paid for the cast.
    expect((game.getPlayer(seat0).manaPool as ManaPool).size()).toBe(0);

    const si = castStackItem as StackItem;
    expect(si.provenance.altCostUsed).toBe("Plot");
    expect(si.provenance.alternativeZoneDestination).toBe(ZoneType.Battlefield);
    expect(si.provenance.originZone).toBe(ZoneType.Exile);

    expect(game.sharedZones.stack.size).toBe(1);

    driveGen(resolveStackItem(game, si) as Generator<unknown, unknown, unknown>);

    // Card entered Alice's battlefield (NOT graveyard).
    expect(card.zone).toBe(ZoneType.Battlefield);
    expect(game.sharedZones.exile.contains(cardId)).toBe(false);
    const aliceBf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);
    if (!aliceBf) throw new Error("test: missing battlefield zone");
    expect(aliceBf.contains(cardId)).toBe(true);

    expect(game.sharedZones.stack.size).toBe(0);
  });

  it("Plot isAvailable: false when card is in Hand (only Exile is acceptable)", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    setupZones(game, seat0);
    game.turn = 1;

    const cardId = mkEntityId(9100);
    const paper = makePaper("Test Plot Creature", plotCreatureSrc, "test-plot.txt");
    const card = addCardToHand(game, paper, seat0, cardId);

    // No plot stamp → isAvailable false.
    expect(altCostRegistry.available(card, game).find((a) => a.handlerKey === "Plot")).toBeUndefined();
  });

  it("Plot isAvailable: false in Exile without plotted=true (defensive)", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    setupZones(game, seat0);
    game.turn = 5;

    const cardId = mkEntityId(9200);
    const paper = makePaper("Test Plot Creature", plotCreatureSrc, "test-plot.txt");
    const card = new Card(cardId, paper, seat0, seat0, ZoneType.Exile);
    game.cards.set(cardId, card);
    game.sharedZones.exile.add(cardId);

    // In exile, but plotted flag was never set.
    expect(altCostRegistry.available(card, game).find((a) => a.handlerKey === "Plot")).toBeUndefined();

    // Stamp it as if plotted on a previous turn.
    card.plotted = true;
    card.plottedOnTurn = 2;
    expect(altCostRegistry.available(card, game).find((a) => a.handlerKey === "Plot")).toBeDefined();
  });
});
