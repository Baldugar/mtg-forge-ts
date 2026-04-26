// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 26 flagship smoke tests — one assertion per keyword runtime.
//
// Covers Suspend, Conspire, Champion, Echo, Cumulative Upkeep at the
// activation-side surface (synth + flag stamping + altcost availability)
// rather than the full end-to-end resolution. Full resolution paths are
// pinned by the trigger/altcost-level tests in their respective directories
// once SP4's priority orchestrator is wired.
import { parseCard } from "@mtg-forge-ts/cards";
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../src/card.js";
import type { GameMeta } from "../../src/game-meta.js";
import type { GameRules } from "../../src/game-rules.js";
import { Game } from "../../src/game.js";
import { tickSuspendedCards } from "../../src/keyword/suspend-tick.js";
import { altCostRegistry } from "../../src/registries/alt-cost-registry.js";
import { Battlefield } from "../../src/zone/zones/battlefield.js";
import { Exile } from "../../src/zone/zones/exile.js";
import { Graveyard } from "../../src/zone/zones/graveyard.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

// --- Bootstrap registries ---
import "../../src/cost/parts/index.js";
import "../../src/ability/effects/index.js";
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
  forgeSha: "wave26",
  cardDataSyncedAt: "2026-04-26T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "26",
};

const makeGame = (): Game => new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(26n) });

function setupZones(game: Game, seat: PlayerSeat): void {
  const player = game.getPlayer(seat);
  player.zones.set(ZoneType.Library, new Library(ZoneType.Library, seat));
  player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, seat));
  player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, seat));
  player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, seat));
  player.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, seat));
}

function makePaper(name: string, src: string, file: string): PaperCard {
  const def = parseCard(src, file);
  return {
    name,
    edition: "TST",
    collectorNumber: "1",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition: def,
  };
}

function addToHand(game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card {
  const card = new Card(id, paper, seat, seat, ZoneType.Hand);
  game.cards.set(id, card);
  const h = game.getPlayer(seat).zones.get(ZoneType.Hand);
  if (!h) throw new Error("test: missing hand zone");
  h.add(id);
  return card;
}

function addToBattlefield(game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card {
  const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
  game.cards.set(id, card);
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  if (!bf) throw new Error("test: missing battlefield zone");
  bf.add(id);
  return card;
}

describe("Flagship: Wave 26 keyword runtimes", () => {
  it("Suspend: keyword handler synthesizes Hand-zone activated ability with the suspend cost", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    setupZones(game, seat);
    game.turn = 1;

    const src = "Name:Test Suspend\nManaCost:5 R\nTypes:Sorcery\nK:Suspend:3:1 R\n";
    const paper = makePaper("Test Suspend", src, "test-suspend.txt");
    const id = mkEntityId(26001);
    const card = addToHand(game, paper, seat, id);
    card.activateKeywordsFromDefinition(game);

    expect(card.keywords?.has("suspend")).toBe(true);
    const sa = card.spellAbilities.find((s) => s.tags.has("suspend"));
    expect(sa).toBeDefined();
    if (!sa) throw new Error("test: suspend SA missing");
    expect(sa.handlerKey).toBe("Suspend");
    expect(sa.activeInZones.has(ZoneType.Hand)).toBe(true);
    expect(sa.tags.has("sorcery-speed")).toBe(true);
    expect(sa.ast.cost.raw).toBe("1 R");

    // Suspend AltCost is NOT yet available (card still in hand).
    expect(altCostRegistry.available(card, game).find((a) => a.handlerKey === "Suspend")).toBeUndefined();

    // Simulate post-suspend state: card in exile with N=3 counters.
    card.zone = ZoneType.Exile;
    card.suspendedCounters = 3;
    expect(altCostRegistry.available(card, game).find((a) => a.handlerKey === "Suspend")).toBeUndefined();

    // Tick three upkeeps — counter drains to 0.
    for (let i = 0; i < 3; i++) tickSuspendedCards(game, seat);
    expect(card.suspendedCounters).toBe(0);
    // Now Suspend AltCost is available.
    expect(altCostRegistry.available(card, game).find((a) => a.handlerKey === "Suspend")).toBeDefined();
  });

  it("Conspire: keyword handler stamps the conspire flag on the card", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    setupZones(game, seat);

    const src = "Name:Test Conspire\nManaCost:2 R\nTypes:Instant\nK:Conspire\n";
    const paper = makePaper("Test Conspire", src, "test-conspire.txt");
    const id = mkEntityId(26002);
    const card = addToHand(game, paper, seat, id);
    card.activateKeywordsFromDefinition(game);

    expect(card.keywords?.has("conspire")).toBe(true);
  });

  it("Champion: keyword handler stamps champion flag and registers ETB+LTB triggers", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    setupZones(game, seat);

    const src = "Name:Test Champion\nManaCost:1 W\nTypes:Creature Avatar\nPT:2/2\nK:Champion:Goblin\n";
    const paper = makePaper("Test Champion", src, "test-champion.txt");
    const id = mkEntityId(26003);
    const card = addToBattlefield(game, paper, seat, id);
    card.activateKeywordsFromDefinition(game);

    expect(card.keywords?.has("champion")).toBe(true);
    // ETB + LTB = 2 triggered abilities synthesized.
    expect(card.triggeredAbilities.length).toBeGreaterThanOrEqual(2);
  });

  it("Echo: keyword handler stamps echoOwedCost and registers an upkeep trigger", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    setupZones(game, seat);

    const src = "Name:Test Echo\nManaCost:2\nTypes:Creature Beast\nPT:3/3\nK:Echo:1 R\n";
    const paper = makePaper("Test Echo", src, "test-echo.txt");
    const id = mkEntityId(26004);
    const card = addToBattlefield(game, paper, seat, id);
    card.activateKeywordsFromDefinition(game);

    expect(card.keywords?.has("echo")).toBe(true);
    expect(card.echoOwedCost).toBe("1 R");
    expect(card.triggeredAbilities.length).toBeGreaterThanOrEqual(1);
  });

  it("Cumulative Upkeep: keyword handler initializes ageCounters to 0 and registers a trigger", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    setupZones(game, seat);

    const src = "Name:Test CU\nManaCost:1 G\nTypes:Enchantment\nK:CumulativeUpkeep:1\n";
    const paper = makePaper("Test CU", src, "test-cu.txt");
    const id = mkEntityId(26005);
    const card = addToBattlefield(game, paper, seat, id);
    card.activateKeywordsFromDefinition(game);

    expect(card.keywords?.has("cumulative_upkeep")).toBe(true);
    expect(card.ageCounters).toBe(0);
    expect(card.triggeredAbilities.length).toBeGreaterThanOrEqual(1);
  });
});
