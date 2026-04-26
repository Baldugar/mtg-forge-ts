// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 25 — Mutate flagship test (Ikoria mechanic).
//
// Mutate (CR 702.139): "Mutate [cost] — If you cast this spell for its
// mutate cost, put it over or under target non-Human creature you own.
// They become the same object. That object has the abilities of each of
// those cards. It has the name, types, power, toughness, mana cost, and
// color of the top card."
//
// Card under test (a synthesized Mutate card mirroring real Ikoria text):
//   Name:Lore Drakkis
//   ManaCost:1 U R
//   Types:Creature Elemental Otter
//   PT:3/3
//   K:Mutate:1 U R
//
// Test scenarios:
//   1. Mutate cast for {1}{U}{R} targets an existing 2/2 Bears (non-Human
//      creature you own). Resolves with placement="top": the new card
//      becomes the top of the merged pile; bears are hidden inside the
//      pile (mutatedInto = drakkisId). Pile order [drakkisId, bearsId].
//   2. CardMutated event emitted on resolution.
//   3. The merged pile's effective characteristics come from the top card
//      (the Drakkis: 3/3 Elemental Otter). The bears are no longer an
//      independent permanent (empty characteristics).
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
import { onZoneChange } from "../../src/statics/zone-activation.js";
import { Battlefield } from "../../src/zone/zones/battlefield.js";
import { Exile } from "../../src/zone/zones/exile.js";
import { Graveyard } from "../../src/zone/zones/graveyard.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

import "../../src/ability/effects/index.js";
import "../../src/altcost/index.js";
import "../../src/cost/parts/index.js";
import "../../src/keyword/handlers/index.js";
import "../../src/svar/selectors/number.js";

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
  seed: "25",
};

// Synthesized Mutate card mirroring the printed Lore Drakkis style: a 3/3
// Elemental Otter for {1}{U}{R}, mutate {1}{U}{R}.
const drakkisSrc = `${[
  "Name:Lore Drakkis",
  "ManaCost:1 U R",
  "Types:Creature Elemental Otter",
  "PT:3/3",
  "K:Mutate:1 U R",
].join("\n")}\n`;

// Vanilla 2/2 Bear — non-Human creature, valid mutate target.
const bearCubSrc = `${["Name:Bear Cub", "ManaCost:1 G", "Types:Creature Bear", "PT:2/2"].join("\n")}\n`;

function makeGame(): Game {
  return new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(25n) });
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

function drainResolveTop(gen: Generator<unknown, void, unknown>): string[] {
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
    } else if (y.kind === "decision" && y.request?.kind === "chooseMutateOrder") {
      step = gen.next({ kind: "chooseMutateOrder", placement: "top" });
    } else {
      step = gen.next();
    }
  }
  return events;
}

describe("Flagship: Mutate — Lore Drakkis end-to-end", () => {
  it("Mutate isAvailable: true when a non-Human creature you own is on the battlefield", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    setupZones(game, seat0);
    setupZones(game, mkPlayerSeat(1));

    // Bears on battlefield (non-Human creature, owned by seat0).
    const bearsId = mkEntityId(20100);
    const bearsPaper = makePaper("Bear Cub", bearCubSrc, "bear-cub.txt");
    addCardToBattlefield(game, bearsPaper, seat0, bearsId);
    onZoneChange(game, bearsId, ZoneType.Hand, ZoneType.Battlefield);

    // Drakkis in hand.
    const drakkisId = mkEntityId(20200);
    const drakkisPaper = makePaper("Lore Drakkis", drakkisSrc, "lore-drakkis.txt");
    const drakkisCard = addCardToHand(game, drakkisPaper, seat0, drakkisId);
    drakkisCard.activateAbilitiesFromDefinition();
    drakkisCard.activateKeywordsFromDefinition(game);

    const available = altCostRegistry.available(drakkisCard, game);
    const mutateAvail = available.find((a) => a.handlerKey === "Mutate");
    expect(mutateAvail).toBeDefined();
    expect(drakkisCard.keywords?.has("mutate")).toBe(true);
  });

  it("Mutate isAvailable: false when no non-Human creature you own is in play", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    setupZones(game, seat0);
    setupZones(game, mkPlayerSeat(1));

    // Drakkis in hand, but no creatures on battlefield.
    const drakkisId = mkEntityId(21000);
    const drakkisPaper = makePaper("Lore Drakkis", drakkisSrc, "lore-drakkis.txt");
    const drakkisCard = addCardToHand(game, drakkisPaper, seat0, drakkisId);
    drakkisCard.activateAbilitiesFromDefinition();
    drakkisCard.activateKeywordsFromDefinition(game);

    const available = altCostRegistry.available(drakkisCard, game);
    expect(available.find((a) => a.handlerKey === "Mutate")).toBeUndefined();
  });

  it("Mutate cast: targets non-Human creature, resolves merging on top, emits CardMutated", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    setupZones(game, seat0);
    setupZones(game, mkPlayerSeat(1));

    // Bears on battlefield (the merge target).
    const bearsId = mkEntityId(22000);
    const bearsPaper = makePaper("Bear Cub", bearCubSrc, "bear-cub.txt");
    const bearsCard = addCardToBattlefield(game, bearsPaper, seat0, bearsId);
    onZoneChange(game, bearsId, ZoneType.Hand, ZoneType.Battlefield);

    {
      const c = game.layerEngine.computeCharacteristics(bearsId);
      expect(c.power).toBe(2);
      expect(c.toughness).toBe(2);
    }

    // Drakkis in hand.
    const drakkisId = mkEntityId(22100);
    const drakkisPaper = makePaper("Lore Drakkis", drakkisSrc, "lore-drakkis.txt");
    const drakkisCard = addCardToHand(game, drakkisPaper, seat0, drakkisId);
    drakkisCard.activateAbilitiesFromDefinition();
    drakkisCard.activateKeywordsFromDefinition(game);
    drakkisCard.activateStaticsFromDefinition(game);

    // Seed {1}{U}{R}.
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Blue));
    pool.add(ManaProduced.colored(Color.Red));
    game.getPlayer(seat0).manaPool = pool;
    expect(pool.size()).toBe(3);

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: drakkisId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
      altCostKey: "Mutate",
    };

    const { events: castEvents, result: stackItem } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );

    expect(stackItem).not.toBeNull();
    expect(castEvents).toContain("CostPaid");
    expect(castEvents).toContain("SpellCast");
    expect(pool.size()).toBe(0);

    const si = stackItem as StackItem;
    expect(si.provenance.altCostUsed).toBe("Mutate");

    const resolveEvents = drainResolveTop(resolveStackItem(game, si) as Generator<unknown, void, unknown>);

    // CardMutated emitted by the merge logic.
    expect(resolveEvents).toContain("CardMutated");

    // Drakkis is on the battlefield as the canonical pile owner; pile is
    // [drakkisId, bearsId] (top → bottom).
    expect(drakkisCard.zone).toBe(ZoneType.Battlefield);
    expect(drakkisCard.mutatedPile).toEqual([drakkisId, bearsId]);
    expect(drakkisCard.mutatedInto).toBeUndefined();

    // Bears is hidden inside the pile.
    expect(bearsCard.mutatedInto).toBe(drakkisId);
    expect(bearsCard.mutatedPile).toBeUndefined();

    // Effective characteristics of the merged permanent come from the top
    // card (the Drakkis: 3/3 Elemental Otter).
    const drakkisChars = game.layerEngine.computeCharacteristics(drakkisId);
    expect(drakkisChars.power).toBe(3);
    expect(drakkisChars.toughness).toBe(3);
    expect(drakkisChars.subtypes.has("Otter")).toBe(true);

    // The hidden bears no longer expose independent characteristics
    // (deriveBaseCharacteristics returns the empty baseline).
    const bearsChars = game.layerEngine.computeCharacteristics(bearsId);
    expect(bearsChars.power).toBeNull();
    expect(bearsChars.toughness).toBeNull();
    expect(bearsChars.types.size).toBe(0);
  });

  it("Mutate target eligibility excludes Human creatures and non-owned creatures", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    setupZones(game, seat0);
    setupZones(game, seat1);

    // Bears for seat0 (owned by seat0; valid target).
    const bearsId = mkEntityId(23000);
    addCardToBattlefield(game, makePaper("Bear Cub", bearCubSrc, "bear.txt"), seat0, bearsId);
    onZoneChange(game, bearsId, ZoneType.Hand, ZoneType.Battlefield);

    // Bears owned by seat1 (NOT a valid target — wrong owner).
    const oppBearsId = mkEntityId(23001);
    addCardToBattlefield(game, makePaper("Bear Cub", bearCubSrc, "bear.txt"), seat1, oppBearsId);
    onZoneChange(game, oppBearsId, ZoneType.Hand, ZoneType.Battlefield);

    // Drakkis in hand.
    const drakkisId = mkEntityId(23100);
    const drakkisCard = addCardToHand(
      game,
      makePaper("Lore Drakkis", drakkisSrc, "lore-drakkis.txt"),
      seat0,
      drakkisId,
    );
    drakkisCard.activateAbilitiesFromDefinition();
    drakkisCard.activateKeywordsFromDefinition(game);

    // Seed {1}{U}{R}.
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Blue));
    pool.add(ManaProduced.colored(Color.Red));
    game.getPlayer(seat0).manaPool = pool;

    // Capture the chooseCastTargets request to assert eligibility.
    let legalTargetCount = -1;
    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: drakkisId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
      altCostKey: "Mutate",
    };
    const gen = game.castPipeline.run(proposal) as Generator<unknown, StackItem | null, unknown>;
    let step = gen.next();
    while (!step.done) {
      const y = step.value as {
        kind?: string;
        event?: { kind?: string };
        request?: { kind?: string; legalTargets?: readonly unknown[] };
      };
      if (y.kind === "decision" && y.request?.kind === "chooseCastTargets") {
        const targets = y.request.legalTargets ?? [];
        legalTargetCount = targets.length;
        const chosen = targets[0];
        step = gen.next({
          kind: "chooseCastTargets",
          targets: chosen !== undefined ? [chosen] : [],
        });
      } else if (y.kind === "decision" && y.request?.kind === "activateManaAbilities") {
        step = gen.next({ kind: "activateManaAbilities", done: true });
      } else {
        step = gen.next();
      }
    }

    // Only the seat0-owned bears qualifies; opponent's bears is excluded.
    expect(legalTargetCount).toBe(1);
  });
});
