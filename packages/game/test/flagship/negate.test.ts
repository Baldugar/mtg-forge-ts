// SPDX-License-Identifier: GPL-3.0-or-later
// F10 — Negate flagship integration test.
// Counter target noncreature spell. ValidTgts$ Card.nonCreature is not
// runtime-enforced by the current pipeline; for test purposes we target
// a Lightning Bolt (a non-creature spell), identical in structure to the
// Counterspell flagship test (F5) but using Negate (U U → counter noncreature).
//
// Scenario: opponent casts Lightning Bolt; while bolt is on the stack,
// controller responds with Negate targeting bolt. Counterspell resolves
// first (LIFO), removes bolt from stack, moves bolt to graveyard.
// Negate itself goes to graveyard. Stack ends empty.
//
// This validates the CounterSpellEffect works for a second counter spell
// archetype (proves the framework handles the pattern across cards).
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
import { SpellAbility } from "../../src/ability/spell-ability.js";
import { Card } from "../../src/card.js";
import type { CastProposal } from "../../src/cast/cast-pipeline.js";
import type { GameMeta } from "../../src/game-meta.js";
import type { GameRules } from "../../src/game-rules.js";
import { Game } from "../../src/game.js";
import { ManaPool } from "../../src/mana/mana-pool.js";
import { resolveStackItem } from "../../src/resolve/effect-resolve.js";
import type { StackItem } from "../../src/stack/stack-item.js";
import { Battlefield } from "../../src/zone/zones/battlefield.js";
import { Graveyard } from "../../src/zone/zones/graveyard.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

// Self-register all effects
import "../../src/ability/effects/index.js";
// Register cost parts
import "../../src/cost/parts/index.js";
// SVar number selectors
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
  cardDataSyncedAt: "2026-04-24T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

// Negate: U U instant — counter target noncreature spell.
// ValidTgts$ Card.nonCreature not runtime-enforced at MVP; we target a bolt.
const negateSrc = `${[
  "Name:Negate",
  "ManaCost:U U",
  "Types:Instant",
  "A:SP$ Counter | Cost$ U U | ValidTgts$ Card.nonCreature | TgtPrompt$ Select target noncreature spell | SpellDescription$ Counter target noncreature spell.",
  "Oracle:Counter target noncreature spell.",
].join("\n")}\n`;

const boltSrc = `${[
  "Name:Lightning Bolt",
  "ManaCost:R",
  "Types:Instant",
  "A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ CARDNAME deals 3 damage to any target.",
  "Oracle:Lightning Bolt deals 3 damage to any target.",
].join("\n")}\n`;

const makeGame = () => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return game;
};

const addCardToHand = (game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, ZoneType.Hand);
  game.cards.set(id, card);
  const hand = game.getPlayer(seat).zones.get(ZoneType.Hand);
  if (!hand) throw new Error("test: missing hand zone");
  hand.add(id);
  return card;
};

const drainCast = (
  gen: Generator<{ kind: string }, StackItem | null, unknown>,
): { events: string[]; result: StackItem | null } => {
  const events: string[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value as { kind: string; event?: { kind?: string }; request?: { kind?: string } };
    if (y.kind === "event" && y.event?.kind) {
      events.push(y.event.kind);
      step = gen.next();
    } else if (y.kind === "decision" && y.request?.kind === "activateManaAbilities") {
      step = gen.next({ kind: "activateManaAbilities", done: true });
    } else if (y.kind === "decision" && y.request?.kind === "chooseCastTargets") {
      const req = y.request as { legalTargets?: readonly unknown[] };
      const first = req.legalTargets?.[0];
      step = gen.next({ kind: "chooseCastTargets", targets: first !== undefined ? [first] : [] });
    } else {
      step = gen.next();
    }
  }
  return { events, result: step.value };
};

const drainResolver = (gen: Generator<unknown, void, unknown>): string[] => {
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
};

describe("Flagship: Negate end-to-end integration", () => {
  it("counters a noncreature spell — bolt removed from stack, Negate in graveyard", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0); // Negate caster
    const seat1 = mkPlayerSeat(1); // Bolt caster

    const negateId = mkEntityId(21000);
    const boltId = mkEntityId(21001);

    // 1. Parse both cards
    const negateDef = parseCard(negateSrc, "negate.txt");
    const negatePaper: PaperCard = {
      name: "Negate",
      edition: "M10",
      collectorNumber: "53",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: negateDef,
    };

    const boltDef = parseCard(boltSrc, "lightning_bolt.txt");
    const boltPaper: PaperCard = {
      name: "Lightning Bolt",
      edition: "LEA",
      collectorNumber: "161",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: boltDef,
    };

    // 2. Add cards to respective hands
    const negateCard = addCardToHand(game, negatePaper, seat0, negateId);
    negateCard.activateAbilitiesFromDefinition();

    const boltCard = addCardToHand(game, boltPaper, seat1, boltId);
    boltCard.activateAbilitiesFromDefinition();

    // 3. seat1 casts the Bolt
    const boltPool = new ManaPool();
    boltPool.add(ManaProduced.colored(Color.Red));
    game.getPlayer(seat1).manaPool = boltPool;

    const boltProposal: CastProposal = {
      castingPlayer: seat1,
      sourceCardId: boltId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { result: boltStackItem } = drainCast(
      game.castPipeline.run(boltProposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(boltStackItem).not.toBeNull();
    const boltItem = boltStackItem as StackItem;

    // Stack now has Bolt
    expect(game.sharedZones.stack.size).toBe(1);
    expect(game.sharedZones.stack.top()?.id).toBe(boltItem.id);

    // 4. seat0 responds with Negate — seeds 2 blue mana
    const negatePool = new ManaPool();
    negatePool.add(ManaProduced.colored(Color.Blue));
    negatePool.add(ManaProduced.colored(Color.Blue));
    game.getPlayer(seat0).manaPool = negatePool;

    const negateProposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: negateId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { events: castEvents, result: negateStackItem } = drainCast(
      game.castPipeline.run(negateProposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(negateStackItem).not.toBeNull();
    expect(castEvents).toContain("CostPaid");
    expect(castEvents).toContain("SpellCast");
    expect(negatePool.size()).toBe(0);

    // Stack now has 2 items: Bolt (bottom), Negate (top — LIFO)
    expect(game.sharedZones.stack.size).toBe(2);

    // 5. Patch Negate with Bolt's stack item id as target
    const saTemplate = negateCard.spellAbilities[0];
    if (!saTemplate) throw new Error("test: card has no spellAbilities");
    const boundSa = new SpellAbility(
      saTemplate.ast,
      saTemplate.sourceCardId,
      saTemplate.controllerSeat,
      saTemplate.svars,
      [boltItem.id], // targeting the bolt stack item by EntityId
    );
    const patchedNegateItem: StackItem = {
      ...(negateStackItem as StackItem),
      resolver: boundSa.makeResolver(),
    };
    game.sharedZones.stack.pop(); // remove old Negate item
    game.sharedZones.stack.push(patchedNegateItem);

    // 6. Resolve Negate (LIFO — it's on top)
    const resolveEvents = drainResolver(
      resolveStackItem(game, patchedNegateItem) as Generator<unknown, void, unknown>,
    );

    // Negate resolution events
    expect(resolveEvents).toContain("StackItemCountered");
    expect(resolveEvents).toContain("StackItemResolved");

    // Bolt removed from stack — stack now empty
    expect(game.sharedZones.stack.size).toBe(0);

    // Bolt's source card moved to graveyard (CounterSpellEffect moves it)
    expect(boltCard.zone).toBe(ZoneType.Graveyard);

    // Negate itself moved to graveyard after resolving
    expect(negateCard.zone).toBe(ZoneType.Graveyard);

    // Life totals unchanged (bolt never resolved)
    expect(game.getPlayer(seat0).life).toBe(20);
    expect(game.getPlayer(seat1).life).toBe(20);
  });
});
