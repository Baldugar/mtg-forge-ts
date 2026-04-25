// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 7 — Madness flagship test ("Fiery Temper").
//
// Madness: when a card with "Madness [cost]" is discarded, exile it instead
// of putting it into the graveyard, then the owner may cast it for its
// madness cost (CR 702.34). The spell, on resolution, goes to its owner's
// graveyard (CR 608.2g — non-permanent spell goes to graveyard).
//
// Card definition (real Forge text, abridged):
//   Name:Fiery Temper
//   ManaCost:1 R R
//   Types:Instant
//   A:SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3
//   K:Madness:R
//
// Test scenario (end-to-end):
//   1. Parse Fiery Temper + place a Card in the shared Exile zone (simulating
//      the post-discard state — the discard-trigger / Hand→Exile redirect is
//      out of scope for this handler; tested upstream once those land).
//   2. altCostRegistry has Madness registered (via barrel side-effect import);
//      cast with altCostKey="Madness" from ZoneType.Exile, paying the madness
//      cost ({R}) not the base ({1}{R}{R}).
//   3. After cast: CostPaid + SpellCast emitted, pool drained, stack has the
//      spell, provenance.altCostUsed = "Madness", alternativeZoneDestination
//      = Graveyard (NOT Exile; the alt-cost handler overrides the Exile-
//      origin default that stepChooseZoneOverride pre-set).
//   4. Resolve the stack item:
//      a. DamageDealt fires (3 damage to Bob).
//      b. StackItemResolved fires (fizzled=false).
//      c. Card moved to Alice's Graveyard (NOT Exile) — the binary
//         correctness assertion for Madness.
//   5. Final assertions:
//      - card.zone === ZoneType.Graveyard
//      - Exile no longer contains the card
//      - Bob life 20 → 17
//      - Stack is empty
//      - Mana pool drained
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
// AltCost handlers — registers Flashback + Madness into altCostRegistry
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
  cardDataSyncedAt: "2026-04-26T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "7",
};

// "Fiery Temper" — instant with DealDamage 3 to any target, madness R.
// Real Forge card text. ValidTgts$ Any → engine enumerates players (+ bf
// permanents) as legal targets; drainCast picks the last (opponent seat).
const fieryTemperSrc = `${[
  "Name:Fiery Temper",
  "ManaCost:1 R R",
  "Types:Instant",
  "A:SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3 | SpellDescription$ CARDNAME deals 3 damage to any target.",
  "K:Madness:R",
  "DeckHints:Ability$Discard",
  "Oracle:Fiery Temper deals 3 damage to any target.\\nMadness {R} (If you discard this card, discard it into exile. When you do, cast it for its madness cost or put it into your graveyard.)",
].join("\n")}\n`;

// "Cigar Burn" — instant with flashback (NOT madness). Used to verify
// Madness.isAvailable returns false for non-madness cards in exile.
const cigarBurnSrc = `${[
  "Name:Cigar Burn",
  "ManaCost:R",
  "Types:Instant",
  "A:SP$ DealDamage | Cost$ R | NumDmg$ 1 | ValidTgts$ Any | SpellDescription$ CARDNAME deals 1 damage to any target.",
  "K:Flashback:2 R",
].join("\n")}\n`;

function makeGame(): Game {
  return new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(7n) });
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

// Place a card directly into the SHARED exile zone (simulating post-discard
// state). The card is registered in game.cards so the cast pipeline can look
// it up by EntityId.
function addCardToExile(game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card {
  const card = new Card(id, paper, seat, seat, ZoneType.Exile);
  game.cards.set(id, card);
  game.sharedZones.exile.add(id);
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

describe("Flagship: Madness — Fiery Temper end-to-end", () => {
  it("cast from exile with Madness pays R, deals 3 damage, card ends in Graveyard", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0); // caster (Alice)
    const seat1 = mkPlayerSeat(1); // target (Bob)
    setupZones(game, seat0);
    setupZones(game, seat1);

    const cardId = mkEntityId(7000);

    // 1. Parse definition and place in shared Exile (post-discard state).
    const paper = makePaper("Fiery Temper", fieryTemperSrc, "fiery-temper.txt");
    const card = addCardToExile(game, paper, seat0, cardId);
    card.activateAbilitiesFromDefinition();
    card.activateKeywordsFromDefinition(game);

    // Verify card is in the shared exile zone.
    expect(card.zone).toBe(ZoneType.Exile);
    expect(game.sharedZones.exile.contains(cardId)).toBe(true);

    // 2. Seed exactly {R} mana — confirms only the madness cost (R) is paid,
    // not the base {1}{R}{R}.
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Red));
    game.getPlayer(seat0).manaPool = pool;
    expect(pool.size()).toBe(1);

    // Verify initial life totals.
    expect(game.getPlayer(seat1).life).toBe(20);

    // 3. Cast with altCostKey="Madness" from Exile.
    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: cardId,
      originZone: ZoneType.Exile,
      asSpecialAction: false,
      altCostKey: "Madness",
    };

    const { events: castEvents, result: stackItem } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );

    // 4. Cast pipeline assertions.
    expect(stackItem).not.toBeNull();
    expect(castEvents).toContain("CostPaid");
    expect(castEvents).toContain("SpellCast");
    // Madness cost is R (1 mana), pool should be drained.
    expect(pool.size()).toBe(0);

    // Provenance should record alt cost and the Graveyard override.
    const si = stackItem as StackItem;
    expect(si.provenance.altCostUsed).toBe("Madness");
    expect(si.provenance.alternativeZoneDestination).toBe(ZoneType.Graveyard);
    expect(si.provenance.originZone).toBe(ZoneType.Exile);

    // Stack should have 1 item.
    expect(game.sharedZones.stack.size).toBe(1);

    // 5. Resolve the stack item.
    const resolveEvents = drainResolve(resolveStackItem(game, si) as Generator<unknown, void, unknown>);

    // 6. Post-resolution assertions.

    // Damage dealt to Bob (seat1): 20 → 17.
    expect(game.getPlayer(seat1).life).toBe(17);

    // DamageDealt event emitted.
    expect(resolveEvents).toContain("DamageDealt");

    // StackItemResolved emitted (not fizzled).
    expect(resolveEvents).toContain("StackItemResolved");

    // Stack is empty.
    expect(game.sharedZones.stack.size).toBe(0);

    // Card is in Alice's Graveyard (NOT exile) — the binary Madness assertion.
    // moveTo(Graveyard) routes to the OWNER's graveyard (CR 400.7).
    expect(card.zone).toBe(ZoneType.Graveyard);
    expect(game.sharedZones.exile.contains(cardId)).toBe(false);
    const aliceGy = game.getPlayer(seat0).zones.get(ZoneType.Graveyard);
    if (!aliceGy) throw new Error("test: missing graveyard zone");
    expect(aliceGy.contains(cardId)).toBe(true);
  });

  it("Madness isAvailable: false when card is in Hand (only Exile is acceptable)", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    setupZones(game, seat0);

    const cardId = mkEntityId(7100);
    const paper = makePaper("Fiery Temper", fieryTemperSrc, "fiery-temper.txt");
    // Place in Hand — Madness should NOT be available.
    const card = new Card(cardId, paper, seat0, seat0, ZoneType.Hand);
    game.cards.set(cardId, card);
    const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
    if (!hand) throw new Error("test: missing hand zone");
    hand.add(cardId);

    const available = altCostRegistry.available(card, game);
    const madnessAvail = available.find((a) => a.handlerKey === "Madness");
    expect(madnessAvail).toBeUndefined();
  });

  it("Madness isAvailable: false for a card in Exile that lacks the madness keyword", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    setupZones(game, seat0);

    const cardId = mkEntityId(7200);
    // Cigar Burn has Flashback — NOT Madness.
    const paper = makePaper("Cigar Burn", cigarBurnSrc, "cigar-burn.txt");
    const card = addCardToExile(game, paper, seat0, cardId);

    const available = altCostRegistry.available(card, game);
    const madnessAvail = available.find((a) => a.handlerKey === "Madness");
    expect(madnessAvail).toBeUndefined();
  });

  it("Madness isAvailable: true for a Madness card in Exile", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    setupZones(game, seat0);

    const cardId = mkEntityId(7300);
    const paper = makePaper("Fiery Temper", fieryTemperSrc, "fiery-temper.txt");
    const card = addCardToExile(game, paper, seat0, cardId);

    const available = altCostRegistry.available(card, game);
    const madnessAvail = available.find((a) => a.handlerKey === "Madness");
    expect(madnessAvail).toBeDefined();
    expect(madnessAvail?.handlerKey).toBe("Madness");
  });
});
