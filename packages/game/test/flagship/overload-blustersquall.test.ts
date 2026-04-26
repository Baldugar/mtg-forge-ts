// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 10 — Overload flagship test ("Blustersquall").
//
// Overload (CR 702.96): a card with "Overload [cost]" may be cast paying
// the overload cost instead of its normal cost. When overloaded, the
// spell's text replaces "target" with "each", and the spell becomes
// targetless — the effect applies to EVERY object matching the spell's
// ValidTgts$ filter at resolve time.
//
// Card definition (real Forge text):
//   Name:Blustersquall
//   ManaCost:U
//   Types:Instant
//   A:SP$ Tap | ValidTgts$ Creature.YouDontCtrl | ...
//   K:Overload:3 U
//
// Test scenario:
//   1. Three "Bear" creatures (2/2) on Bob's battlefield.
//   2. Blustersquall in Alice's hand.
//   3. Alice seeds {3}{U} into her pool.
//   4. Cast Blustersquall with altCostKey="Overload":
//      - No chooseCastTargets decision (the spell is targetless).
//      - Cost paid in full ({3}{U}).
//      - SpellCast emitted; provenance.altCostUsed === "Overload".
//   5. Resolve: ALL three of Bob's Bears tap.
//   6. Blustersquall lands in Alice's graveyard.
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

const blustersquallSrc = `${[
  "Name:Blustersquall",
  "ManaCost:U",
  "Types:Instant",
  "A:SP$ Tap | ValidTgts$ Creature.YouDontCtrl | TgtPrompt$ Select target creature you don't control | SpellDescription$ Tap target creature you don't control.",
  "K:Overload:3 U",
].join("\n")}\n`;

// Bear cub — 2/2 vanilla creature for the targets.
const bearCubSrc = `${["Name:Bear Cub", "ManaCost:1 G", "Types:Creature Bear", "PT:2/2"].join("\n")}\n`;

// "Cigar Burn" — instant with flashback (NOT overload).
const cigarBurnSrc = `${[
  "Name:Cigar Burn",
  "ManaCost:R",
  "Types:Instant",
  "A:SP$ DealDamage | Cost$ R | NumDmg$ 1 | ValidTgts$ Any",
  "K:Flashback:2 R",
].join("\n")}\n`;

function makeGame(): Game {
  return new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(11n) });
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

function addCardToHand(game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card {
  const card = new Card(id, paper, seat, seat, ZoneType.Hand);
  game.cards.set(id, card);
  const hand = game.getPlayer(seat).zones.get(ZoneType.Hand);
  if (!hand) throw new Error("test: missing hand zone");
  hand.add(id);
  return card;
}

function addCardToBattlefield(game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card {
  const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
  game.cards.set(id, card);
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  if (!bf) throw new Error("test: missing battlefield zone");
  bf.add(id);
  return card;
}

function drainCast(gen: Generator<{ kind: string }, StackItem | null, unknown>): {
  events: string[];
  decisions: string[];
  result: StackItem | null;
} {
  const events: string[] = [];
  const decisions: string[] = [];
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
      decisions.push("activateManaAbilities");
      step = gen.next({ kind: "activateManaAbilities", done: true });
    } else if (y.kind === "decision" && y.request?.kind === "chooseCastTargets") {
      decisions.push("chooseCastTargets");
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
  return { events, decisions, result: step.value };
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

describe("Flagship: Overload — Blustersquall end-to-end", () => {
  it("cast from hand with Overload pays {3}{U}, taps each of Bob's creatures, no target prompt", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0); // Alice (caster)
    const seat1 = mkPlayerSeat(1); // Bob (creature controller)
    setupZones(game, seat0);
    setupZones(game, seat1);

    // Three of Bob's bears.
    const bear1 = addCardToBattlefield(
      game,
      makePaper("Bear Cub", bearCubSrc, "bear-cub.txt"),
      seat1,
      mkEntityId(9001),
    );
    const bear2 = addCardToBattlefield(
      game,
      makePaper("Bear Cub", bearCubSrc, "bear-cub.txt"),
      seat1,
      mkEntityId(9002),
    );
    const bear3 = addCardToBattlefield(
      game,
      makePaper("Bear Cub", bearCubSrc, "bear-cub.txt"),
      seat1,
      mkEntityId(9003),
    );
    expect(bear1.tapped).toBe(false);
    expect(bear2.tapped).toBe(false);
    expect(bear3.tapped).toBe(false);

    // Blustersquall in Alice's hand.
    const blusterId = mkEntityId(9100);
    const blusterPaper = makePaper("Blustersquall", blustersquallSrc, "blustersquall.txt");
    const blusterCard = addCardToHand(game, blusterPaper, seat0, blusterId);
    blusterCard.activateAbilitiesFromDefinition();
    blusterCard.activateKeywordsFromDefinition(game);

    // Seed {3}{U}.
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Blue));
    game.getPlayer(seat0).manaPool = pool;
    expect(pool.size()).toBe(4);

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: blusterId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
      altCostKey: "Overload",
    };

    const {
      events: castEvents,
      decisions,
      result: stackItem,
    } = drainCast(game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>);

    expect(stackItem).not.toBeNull();
    expect(castEvents).toContain("CostPaid");
    expect(castEvents).toContain("SpellCast");
    // Pool drained: {3}{U} = 4 mana.
    expect(pool.size()).toBe(0);

    // CRITICAL: an overloaded spell is targetless — no chooseCastTargets decision.
    expect(decisions).not.toContain("chooseCastTargets");

    const si = stackItem as StackItem;
    expect(si.provenance.altCostUsed).toBe("Overload");
    expect(si.provenance.originZone).toBe(ZoneType.Hand);

    expect(game.sharedZones.stack.size).toBe(1);

    drainResolve(resolveStackItem(game, si) as Generator<unknown, void, unknown>);

    // ALL three Bears tapped.
    expect(bear1.tapped).toBe(true);
    expect(bear2.tapped).toBe(true);
    expect(bear3.tapped).toBe(true);

    // Blustersquall ends in Alice's graveyard.
    expect(blusterCard.zone).toBe(ZoneType.Graveyard);
    const aliceGy = game.getPlayer(seat0).zones.get(ZoneType.Graveyard);
    if (!aliceGy) throw new Error("test: missing graveyard zone");
    expect(aliceGy.contains(blusterId)).toBe(true);

    expect(game.sharedZones.stack.size).toBe(0);
  });

  it("Overload isAvailable: false when card is in Exile (only Hand is acceptable)", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    setupZones(game, seat0);

    const cardId = mkEntityId(9200);
    const paper = makePaper("Blustersquall", blustersquallSrc, "blustersquall.txt");
    const card = new Card(cardId, paper, seat0, seat0, ZoneType.Exile);
    game.cards.set(cardId, card);
    game.sharedZones.exile.add(cardId);

    const available = altCostRegistry.available(card, game);
    const overloadAvail = available.find((a) => a.handlerKey === "Overload");
    expect(overloadAvail).toBeUndefined();
  });

  it("Overload isAvailable: false for a Hand card that lacks the overload keyword", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    setupZones(game, seat0);

    const cardId = mkEntityId(9300);
    const paper = makePaper("Cigar Burn", cigarBurnSrc, "cigar-burn.txt");
    addCardToHand(game, paper, seat0, cardId);
    const card = game.cards.get(cardId);
    if (!card) throw new Error("test: missing card");

    const available = altCostRegistry.available(card, game);
    const overloadAvail = available.find((a) => a.handlerKey === "Overload");
    expect(overloadAvail).toBeUndefined();
  });

  it("Overload isAvailable: true for an Overload card in Hand", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    setupZones(game, seat0);

    const cardId = mkEntityId(9400);
    const paper = makePaper("Blustersquall", blustersquallSrc, "blustersquall.txt");
    addCardToHand(game, paper, seat0, cardId);
    const card = game.cards.get(cardId);
    if (!card) throw new Error("test: missing card");

    const available = altCostRegistry.available(card, game);
    const overloadAvail = available.find((a) => a.handlerKey === "Overload");
    expect(overloadAvail).toBeDefined();
    expect(overloadAvail?.handlerKey).toBe("Overload");
  });
});
