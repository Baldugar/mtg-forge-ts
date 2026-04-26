// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 10 — Foretell flagship test ("Augury Raven").
//
// Foretell: a card with "Foretell [cost]" can, on owner's turn at sorcery
// speed, be exiled face-down for {2} via the foretell special action; on a
// later turn the owner may cast it from exile paying the foretell cost
// (CR 702.143).
//
// This test focuses on the alt-cost arm only — i.e. the cast-from-exile
// path. The foretell special action (Hand → Exile face-down for {2}) is a
// separate mechanism not yet wired; we simulate the post-foretell-action
// state by placing the card directly in shared exile.
//
// Card definition (real Forge text):
//   Name:Augury Raven
//   ManaCost:3 U
//   Types:Creature Bird
//   PT:3/3
//   K:Flying
//   K:Foretell:1 U
//
// Test scenario:
//   1. Place Augury Raven in shared Exile (post-foretell-action state).
//   2. Cast with altCostKey="Foretell" from Exile, paying {1}{U} (NOT {3}{U}).
//   3. Resolve: card enters Alice's battlefield as a 3/3 creature with
//      flying. Provenance.altCostUsed === "Foretell";
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
  seed: "10",
};

const auguryRavenSrc = `${[
  "Name:Augury Raven",
  "ManaCost:3 U",
  "Types:Creature Bird",
  "PT:3/3",
  "K:Flying",
  "K:Foretell:1 U",
].join("\n")}\n`;

// "Cigar Burn" — instant with flashback (NOT foretell). Used to verify
// Foretell.isAvailable returns false for non-foretell cards.
const cigarBurnSrc = `${[
  "Name:Cigar Burn",
  "ManaCost:R",
  "Types:Instant",
  "A:SP$ DealDamage | Cost$ R | NumDmg$ 1 | ValidTgts$ Any",
  "K:Flashback:2 R",
].join("\n")}\n`;

function makeGame(): Game {
  return new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(10n) });
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
    edition: "TEST",
    collectorNumber: "1",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition: def,
  };
}

function addCardToExile(game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card {
  const card = new Card(id, paper, seat, seat, ZoneType.Exile);
  game.cards.set(id, card);
  game.sharedZones.exile.add(id);
  return card;
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

function drainResolve(gen: Generator<unknown, void, unknown>): string[] {
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
    } else {
      step = gen.next();
    }
  }
  return events;
}

describe("Flagship: Foretell — Augury Raven end-to-end", () => {
  it("cast from exile with Foretell pays {1}{U}, raven enters battlefield as creature with flying", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    setupZones(game, seat0);
    setupZones(game, seat1);

    const cardId = mkEntityId(8000);
    const paper = makePaper("Augury Raven", auguryRavenSrc, "augury-raven.txt");
    const card = addCardToExile(game, paper, seat0, cardId);
    card.activateAbilitiesFromDefinition();
    card.activateKeywordsFromDefinition(game);

    expect(card.zone).toBe(ZoneType.Exile);
    expect(game.sharedZones.exile.contains(cardId)).toBe(true);

    // Seed exactly {1}{U} — confirms only the foretell cost is paid, not {3}{U}.
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Blue));
    game.getPlayer(seat0).manaPool = pool;
    expect(pool.size()).toBe(2);

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: cardId,
      originZone: ZoneType.Exile,
      asSpecialAction: false,
      altCostKey: "Foretell",
    };

    const { events: castEvents, result: stackItem } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );

    expect(stackItem).not.toBeNull();
    expect(castEvents).toContain("CostPaid");
    expect(castEvents).toContain("SpellCast");
    expect(pool.size()).toBe(0);

    const si = stackItem as StackItem;
    expect(si.provenance.altCostUsed).toBe("Foretell");
    // Permanent → Battlefield destination.
    expect(si.provenance.alternativeZoneDestination).toBe(ZoneType.Battlefield);
    expect(si.provenance.originZone).toBe(ZoneType.Exile);

    expect(game.sharedZones.stack.size).toBe(1);

    drainResolve(resolveStackItem(game, si) as Generator<unknown, void, unknown>);

    // Raven entered Alice's battlefield (NOT graveyard, NOT exile).
    expect(card.zone).toBe(ZoneType.Battlefield);
    expect(game.sharedZones.exile.contains(cardId)).toBe(false);
    const aliceBf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);
    if (!aliceBf) throw new Error("test: missing battlefield zone");
    expect(aliceBf.contains(cardId)).toBe(true);

    // Has flying (keyword activation runs at parse time; once on battlefield
    // it should still carry the keyword set).
    expect(card.keywords?.has("flying")).toBe(true);

    expect(game.sharedZones.stack.size).toBe(0);
  });

  it("Foretell isAvailable: false when card is in Hand (only Exile is acceptable)", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    setupZones(game, seat0);

    const cardId = mkEntityId(8100);
    const paper = makePaper("Augury Raven", auguryRavenSrc, "augury-raven.txt");
    const card = new Card(cardId, paper, seat0, seat0, ZoneType.Hand);
    game.cards.set(cardId, card);
    const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
    if (!hand) throw new Error("test: missing hand zone");
    hand.add(cardId);

    const available = altCostRegistry.available(card, game);
    const foretellAvail = available.find((a) => a.handlerKey === "Foretell");
    expect(foretellAvail).toBeUndefined();
  });

  it("Foretell isAvailable: false for a card in Exile that lacks the foretell keyword", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    setupZones(game, seat0);

    const cardId = mkEntityId(8200);
    const paper = makePaper("Cigar Burn", cigarBurnSrc, "cigar-burn.txt");
    const card = addCardToExile(game, paper, seat0, cardId);

    const available = altCostRegistry.available(card, game);
    const foretellAvail = available.find((a) => a.handlerKey === "Foretell");
    expect(foretellAvail).toBeUndefined();
  });

  it("Foretell isAvailable: true for a Foretell card in Exile", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    setupZones(game, seat0);

    const cardId = mkEntityId(8300);
    const paper = makePaper("Augury Raven", auguryRavenSrc, "augury-raven.txt");
    const card = addCardToExile(game, paper, seat0, cardId);

    const available = altCostRegistry.available(card, game);
    const foretellAvail = available.find((a) => a.handlerKey === "Foretell");
    expect(foretellAvail).toBeDefined();
    expect(foretellAvail?.handlerKey).toBe("Foretell");
  });
});
