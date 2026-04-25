// SPDX-License-Identifier: GPL-3.0-or-later
// F14 — Flashback flagship test ("Cigar Burn").
//
// Flashback: cast a card from the graveyard for its flashback cost; it exiles
// instead of going back to the graveyard (CR 702.34).
//
// Synthetic card definition:
//   Name:Cigar Burn
//   ManaCost:R
//   Types:Instant
//   A:SP$ DealDamage | Cost$ R | NumDmg$ 1 | ValidTgts$ AnyPlayer
//   K:Flashback:2 R
//
// Test scenario (end-to-end):
//   1. Parse Cigar Burn + build a Card in the owner's graveyard.
//   2. altCostRegistry has Flashback registered; cast with altCostKey="Flashback"
//      from ZoneType.Graveyard, paying the flashback cost (2 R) not the base (R).
//   3. Respond to activateManaAbilities decision (pool already seeded).
//   4. After the cast pipeline: CostPaid + SpellCast emitted, pool empty.
//   5. Resolve the stack item:
//      a. DamageDealt fires (1 damage to target player).
//      b. StackItemResolved fires (fizzled=false).
//      c. Card moved to Exile (not Graveyard) by alternativeZoneDestination.
//   6. Assert:
//      - card.zone === ZoneType.Exile
//      - Graveyard no longer contains the card
//      - Target opponent life 20 → 19
//      - Stack is empty
//      - Mana pool is drained
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
// Effects: DealDamageEffect, etc.
import "../../src/ability/effects/index.js";
// Cost parts: CostMana, etc.
import "../../src/cost/parts/index.js";
// SVar number selectors
import "../../src/svar/selectors/number.js";
// AltCost handlers — registers Flashback into altCostRegistry
import "../../src/altcost/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
  cardDataSyncedAt: "2026-04-24T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "14",
};

// "Cigar Burn" — instant with DealDamage 1 to any player, flashback 2R.
// ValidTgts$ Any so the engine enumerates players (+ battlefield permanents)
// as legal targets; we pick the opponent seat automatically in drainCast.
const cigarBurnSrc = `${[
  "Name:Cigar Burn",
  "ManaCost:R",
  "Types:Instant",
  "A:SP$ DealDamage | Cost$ R | NumDmg$ 1 | ValidTgts$ Any | SpellDescription$ CARDNAME deals 1 damage to any target.",
  "K:Flashback:2 R",
  "Oracle:Cigar Burn deals 1 damage to any target. Flashback {2}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
].join("\n")}\n`;

function makeGame(): Game {
  return new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(14n) });
}

function setupZones(game: Game, seat: PlayerSeat): void {
  const player = game.getPlayer(seat);
  player.zones.set(ZoneType.Library, new Library(ZoneType.Library, seat));
  player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, seat));
  player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, seat));
  player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, seat));
  player.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, seat));
}

function addCardToGraveyard(game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card {
  const card = new Card(id, paper, seat, seat, ZoneType.Graveyard);
  game.cards.set(id, card);
  const gy = game.getPlayer(seat).zones.get(ZoneType.Graveyard);
  if (!gy) throw new Error("test: missing graveyard zone");
  gy.add(id);
  return card;
}

/**
 * Drive the cast generator, returning final StackItem (or null) and all
 * event kinds emitted. Responds automatically to:
 *   - activateManaAbilities  →  done: true  (pool was pre-seeded)
 *   - chooseCastTargets      →  last legal target (picks the opponent when
 *                               players are enumerated seat0 first, seat1 last)
 */
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
      // Pick the last target: players are enumerated seat0, seat1 so the last
      // entry is seat1 (Bob, the opponent). Picking "last" avoids self-targeting.
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

/**
 * Drive the resolve generator, responding to orderReplacements automatically.
 */
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Flagship: Flashback — Cigar Burn end-to-end", () => {
  it("cast from graveyard with Flashback pays 2R, deals 1 damage, card ends in Exile", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0); // caster (Alice)
    const seat1 = mkPlayerSeat(1); // target (Bob)
    setupZones(game, seat0);
    setupZones(game, seat1);

    const cardId = mkEntityId(14000);

    // 1. Parse definition and place in caster's graveyard.
    const def = parseCard(cigarBurnSrc, "cigar-burn.txt");
    const paper: PaperCard = {
      name: "Cigar Burn",
      edition: "TEST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const card = addCardToGraveyard(game, paper, seat0, cardId);
    card.activateAbilitiesFromDefinition();
    card.activateKeywordsFromDefinition(game);

    // Verify card is in the graveyard.
    expect(card.zone).toBe(ZoneType.Graveyard);
    const gy = game.getPlayer(seat0).zones.get(ZoneType.Graveyard);
    if (!gy) throw new Error("test: missing graveyard zone");
    expect(gy.contains(cardId)).toBe(true);

    // 2. Seed 2R mana for the flashback cost (flashback cost is "2 R" → {2}{R}).
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Red));
    game.getPlayer(seat0).manaPool = pool;
    expect(pool.size()).toBe(3);

    // Verify initial life totals.
    expect(game.getPlayer(seat1).life).toBe(20);

    // 3. Cast with altCostKey="Flashback" from Graveyard.
    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: cardId,
      originZone: ZoneType.Graveyard,
      asSpecialAction: false,
      altCostKey: "Flashback",
    };

    const { events: castEvents, result: stackItem } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );

    // 4. Cast pipeline assertions.
    expect(stackItem).not.toBeNull();
    expect(castEvents).toContain("CostPaid");
    expect(castEvents).toContain("SpellCast");
    // Flashback cost is 2R (3 mana), pool should be drained.
    expect(pool.size()).toBe(0);

    // Provenance should record alt cost and alternative destination.
    const si = stackItem as StackItem;
    expect(si.provenance.altCostUsed).toBe("Flashback");
    expect(si.provenance.alternativeZoneDestination).toBe(ZoneType.Exile);

    // Stack should have 1 item.
    expect(game.sharedZones.stack.size).toBe(1);

    // 5. Resolve the stack item.
    const resolveEvents = drainResolve(resolveStackItem(game, si) as Generator<unknown, void, unknown>);

    // 6. Post-resolution assertions.

    // Damage dealt to Bob (seat1): 20 → 19.
    expect(game.getPlayer(seat1).life).toBe(19);

    // DamageDealt event emitted.
    expect(resolveEvents).toContain("DamageDealt");

    // StackItemResolved emitted (not fizzled).
    expect(resolveEvents).toContain("StackItemResolved");

    // Stack is empty.
    expect(game.sharedZones.stack.size).toBe(0);

    // Card is in Exile (NOT graveyard) — the key Flashback assertion.
    // moveTo(Exile) routes to game.sharedZones.exile (the shared exile zone,
    // owner=null), not the per-player personal exile zone.
    expect(card.zone).toBe(ZoneType.Exile);
    expect(gy.contains(cardId)).toBe(false);
    expect(game.sharedZones.exile.contains(cardId)).toBe(true);
  });

  it("provenance.altCostUsed = 'Flashback' on the stack item", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    setupZones(game, seat0);
    setupZones(game, seat1);

    const cardId = mkEntityId(14100);
    const def = parseCard(cigarBurnSrc, "cigar-burn.txt");
    const paper: PaperCard = {
      name: "Cigar Burn",
      edition: "TEST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const card = addCardToGraveyard(game, paper, seat0, cardId);
    card.activateAbilitiesFromDefinition();
    card.activateKeywordsFromDefinition(game);

    // Seed 2R for flashback cost.
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.Red));
    game.getPlayer(seat0).manaPool = pool;

    const { result } = drainCast(
      game.castPipeline.run({
        castingPlayer: seat0,
        sourceCardId: cardId,
        originZone: ZoneType.Graveyard,
        asSpecialAction: false,
        altCostKey: "Flashback",
      }) as Generator<{ kind: string }, StackItem | null, unknown>,
    );

    expect(result).not.toBeNull();
    const si = result as StackItem;
    expect(si.provenance.altCostUsed).toBe("Flashback");
    expect(si.provenance.alternativeZoneDestination).toBe(ZoneType.Exile);
    expect(si.provenance.originZone).toBe(ZoneType.Graveyard);
  });

  it("Flashback isAvailable: false when card is in Hand (not Graveyard)", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    setupZones(game, seat0);

    const cardId = mkEntityId(14200);
    const def = parseCard(cigarBurnSrc, "cigar-burn.txt");
    const paper: PaperCard = {
      name: "Cigar Burn",
      edition: "TEST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    // Place in Hand — Flashback should NOT be available.
    const card = new Card(cardId, paper, seat0, seat0, ZoneType.Hand);
    game.cards.set(cardId, card);
    const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
    if (!hand) throw new Error("test: missing hand zone");
    hand.add(cardId);

    const available = altCostRegistry.available(card, game);
    const flashbackAvail = available.find((a) => a.handlerKey === "Flashback");
    expect(flashbackAvail).toBeUndefined();
  });

  it("Flashback isAvailable: true when card is in Graveyard", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    setupZones(game, seat0);

    const cardId = mkEntityId(14300);
    const def = parseCard(cigarBurnSrc, "cigar-burn.txt");
    const paper: PaperCard = {
      name: "Cigar Burn",
      edition: "TEST",
      collectorNumber: "1",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const card = addCardToGraveyard(game, paper, seat0, cardId);

    const available = altCostRegistry.available(card, game);
    const flashbackAvail = available.find((a) => a.handlerKey === "Flashback");
    expect(flashbackAvail).toBeDefined();
    expect(flashbackAvail?.handlerKey).toBe("Flashback");
  });
});
