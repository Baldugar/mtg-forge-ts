// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 10 — Bestow flagship test ("Boon Satyr").
//
// Bestow (CR 702.103): a card with "Bestow [cost]" may be cast for its
// bestow cost; if so, it's an Aura spell with enchant creature. While
// attached, it is an Aura (NOT a creature). When it becomes unattached,
// it stops being an Aura and becomes a creature again on the battlefield.
//
// Card definition (real Forge text):
//   Name:Boon Satyr
//   ManaCost:1 G G
//   Types:Enchantment Creature Satyr
//   PT:4/2
//   K:Bestow:3 G G
//   K:Flash
//   S:Mode$ Continuous | Affected$ Card.EnchantedBy | AddPower$ 4 | AddToughness$ 2
//
// Two scenarios:
//   1. Hard cast (no bestow): pays {1}{G}{G}, enters as a 4/2 creature.
//   2. Bestow cast: pays {3}{G}{G}, targets a creature (Bears 2/2),
//      resolves attached. Boon Satyr is an Aura (NOT a creature) and the
//      Bears are 6/4 (2/2 + 4/2 from the static). Then the Bears die →
//      Boon Satyr stays on the battlefield, reverts to its creature form
//      (Enchantment Creature Satyr), and is no longer attached.
import { parseCard } from "@mtg-forge-ts/cards";
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  CardType,
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
import { onZoneChange } from "../../src/statics/zone-activation.js";
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
  seed: "12",
};

const boonSatyrSrc = `${[
  "Name:Boon Satyr",
  "ManaCost:1 G G",
  "Types:Enchantment Creature Satyr",
  "PT:4/2",
  "K:Bestow:3 G G",
  "K:Flash",
  "S:Mode$ Continuous | Affected$ Card.EnchantedBy | AddPower$ 4 | AddToughness$ 2 | Description$ Enchanted creature gets +4/+2.",
].join("\n")}\n`;

const bearCubSrc = `${["Name:Bear Cub", "ManaCost:1 G", "Types:Creature Bear", "PT:2/2"].join("\n")}\n`;

function makeGame(): Game {
  return new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(12n) });
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
      // Pick the first eligible target — we have a single bear so [0] is fine.
      const chosen = targets[0];
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

describe("Flagship: Bestow — Boon Satyr end-to-end", () => {
  it("hard cast (no bestow) for {1}{G}{G} enters as a 4/2 creature", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    setupZones(game, seat0);
    setupZones(game, mkPlayerSeat(1));

    const cardId = mkEntityId(10000);
    const paper = makePaper("Boon Satyr", boonSatyrSrc, "boon-satyr.txt");
    const card = addCardToHand(game, paper, seat0, cardId);
    card.activateAbilitiesFromDefinition();
    card.activateKeywordsFromDefinition(game);
    card.activateStaticsFromDefinition(game);

    // Seed {1}{G}{G}.
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Green));
    pool.add(ManaProduced.colored(Color.Green));
    game.getPlayer(seat0).manaPool = pool;
    expect(pool.size()).toBe(3);

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: cardId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };

    const { events: castEvents, result: stackItem } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );

    expect(stackItem).not.toBeNull();
    expect(castEvents).toContain("CostPaid");
    expect(castEvents).toContain("SpellCast");
    expect(pool.size()).toBe(0);

    const si = stackItem as StackItem;
    expect(si.provenance.altCostUsed).toBeNull();

    drainResolve(resolveStackItem(game, si) as Generator<unknown, void, unknown>);

    // Boon Satyr is on Alice's battlefield as a creature.
    expect(card.zone).toBe(ZoneType.Battlefield);
    expect(card.bestowed).toBe(false);
    expect(card.attachedTo).toBeNull();

    // Layer engine sees Creature in its types; P/T 4/2.
    const chars = game.layerEngine.computeCharacteristics(cardId);
    expect(chars.types.has(CardType.Creature)).toBe(true);
    expect(chars.types.has(CardType.Enchantment)).toBe(true);
    expect(chars.power).toBe(4);
    expect(chars.toughness).toBe(2);
  });

  it("bestow cast for {3}{G}{G} attaches to Bears, becomes Aura, Bears get +4/+2", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    setupZones(game, seat0);
    setupZones(game, mkPlayerSeat(1));

    // Alice's bears (target).
    const bearsId = mkEntityId(11000);
    const bearsPaper = makePaper("Bear Cub", bearCubSrc, "bear-cub.txt");
    const bearsCard = addCardToBattlefield(game, bearsPaper, seat0, bearsId);
    // Trigger zone-activation for bears (pre-existing battlefield card).
    onZoneChange(game, bearsId, ZoneType.Hand, ZoneType.Battlefield);

    {
      const c = game.layerEngine.computeCharacteristics(bearsId);
      expect(c.power).toBe(2);
      expect(c.toughness).toBe(2);
    }

    // Boon Satyr in Alice's hand.
    const satyrId = mkEntityId(11100);
    const satyrPaper = makePaper("Boon Satyr", boonSatyrSrc, "boon-satyr.txt");
    const satyrCard = addCardToHand(game, satyrPaper, seat0, satyrId);
    satyrCard.activateAbilitiesFromDefinition();
    satyrCard.activateKeywordsFromDefinition(game);
    satyrCard.activateStaticsFromDefinition(game);

    // Seed {3}{G}{G}.
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Green));
    pool.add(ManaProduced.colored(Color.Green));
    game.getPlayer(seat0).manaPool = pool;
    expect(pool.size()).toBe(5);

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: satyrId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
      altCostKey: "Bestow",
    };

    const { events: castEvents, result: stackItem } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );

    expect(stackItem).not.toBeNull();
    expect(castEvents).toContain("CostPaid");
    expect(castEvents).toContain("SpellCast");
    expect(pool.size()).toBe(0);

    const si = stackItem as StackItem;
    expect(si.provenance.altCostUsed).toBe("Bestow");

    drainResolve(resolveStackItem(game, si) as Generator<unknown, void, unknown>);

    // Boon Satyr on Alice's battlefield, attached to Bears, in Aura form.
    expect(satyrCard.zone).toBe(ZoneType.Battlefield);
    expect(satyrCard.bestowed).toBe(true);
    expect(satyrCard.attachedTo).toBe(bearsId);
    expect(bearsCard.attachments).toContain(satyrId);

    const satyrChars = game.layerEngine.computeCharacteristics(satyrId);
    expect(satyrChars.types.has(CardType.Creature)).toBe(false);
    expect(satyrChars.types.has(CardType.Enchantment)).toBe(true);
    expect(satyrChars.subtypes.has("Aura")).toBe(true);
    // Aura has no P/T.
    expect(satyrChars.power).toBeNull();
    expect(satyrChars.toughness).toBeNull();

    // Bears get +4/+2 from Boon Satyr's continuous static.
    const bearsChars = game.layerEngine.computeCharacteristics(bearsId);
    expect(bearsChars.power).toBe(6);
    expect(bearsChars.toughness).toBe(4);

    // Now: Bears die. Trigger zone change to graveyard via game.action.moveTo.
    const moveGen = game.action.moveTo(bearsId, ZoneType.Graveyard);
    let s = moveGen.next();
    while (!s.done) {
      const y = s.value as {
        kind?: string;
        event?: { kind?: string };
        request?: { kind?: string; replacementIds?: number[] };
      };
      if (y.kind === "decision" && y.request?.kind === "orderReplacements") {
        s = moveGen.next({ order: [...(y.request.replacementIds ?? [])] });
      } else {
        s = moveGen.next();
      }
    }
    expect(bearsCard.zone).toBe(ZoneType.Graveyard);

    // Run SBA sweep — bestowed Aura whose target is gone reverts to creature.
    const sweepGen = game.sbaEngine.sweep();
    let ss = sweepGen.next();
    while (!ss.done) {
      const y = ss.value as {
        kind?: string;
        event?: { kind?: string };
        request?: { kind?: string };
      };
      if (y.kind === "decision") {
        // No interactive SBA decisions in this scenario.
        ss = sweepGen.next({ kind: y.request?.kind ?? "noop" });
      } else {
        ss = sweepGen.next();
      }
    }

    // Boon Satyr stays on the battlefield, no longer bestowed, no longer attached.
    expect(satyrCard.zone).toBe(ZoneType.Battlefield);
    expect(satyrCard.bestowed).toBe(false);
    expect(satyrCard.attachedTo).toBeNull();

    const finalChars = game.layerEngine.computeCharacteristics(satyrId);
    expect(finalChars.types.has(CardType.Creature)).toBe(true);
    expect(finalChars.types.has(CardType.Enchantment)).toBe(true);
    expect(finalChars.power).toBe(4);
    expect(finalChars.toughness).toBe(2);
  });

  it("Bestow isAvailable: false when card is in Exile (only Hand is acceptable)", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    setupZones(game, seat0);

    const cardId = mkEntityId(12000);
    const paper = makePaper("Boon Satyr", boonSatyrSrc, "boon-satyr.txt");
    const card = new Card(cardId, paper, seat0, seat0, ZoneType.Exile);
    game.cards.set(cardId, card);
    game.sharedZones.exile.add(cardId);

    const available = altCostRegistry.available(card, game);
    const bestowAvail = available.find((a) => a.handlerKey === "Bestow");
    expect(bestowAvail).toBeUndefined();
  });

  it("Bestow isAvailable: true for a Bestow card in Hand", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    setupZones(game, seat0);

    const cardId = mkEntityId(12100);
    const paper = makePaper("Boon Satyr", boonSatyrSrc, "boon-satyr.txt");
    addCardToHand(game, paper, seat0, cardId);
    const card = game.cards.get(cardId);
    if (!card) throw new Error("test: missing card");

    const available = altCostRegistry.available(card, game);
    const bestowAvail = available.find((a) => a.handlerKey === "Bestow");
    expect(bestowAvail).toBeDefined();
    expect(bestowAvail?.handlerKey).toBe("Bestow");
  });
});
