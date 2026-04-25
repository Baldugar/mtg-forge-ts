// SPDX-License-Identifier: GPL-3.0-or-later
// F5 — Counterspell flagship integration test.
// Tests CounterSpellEffect: opponent casts a Lightning Bolt, caster responds
// with Counterspell targeting the Bolt stack item. Bolt is removed from the
// stack and moved to graveyard; Bolt never resolves.
//
// Stack ordering (LIFO): Bolt pushed first, Counterspell pushed on top.
// Counterspell resolves first (LIFO), removing Bolt. Stack ends empty.
//
// CounterSpellEffect.resolve: iterates sa.targets (which holds stack item ids),
// calls stack.removeById(targetId), emits StackItemCountered, moves source
// card to graveyard. Target here is the Bolt StackItem id (EntityId).
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
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const counterspellSrc = `${[
  "Name:Counterspell",
  "ManaCost:U U",
  "Types:Instant",
  "A:SP$ Counter | Cost$ U U | ValidTgts$ Card.nonLand | TgtPrompt$ Select target spell to counter | SpellDescription$ Counter target spell.",
  "Oracle:Counter target spell.",
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

describe("Flagship: Counterspell end-to-end integration", () => {
  it("counters a stack item — bolt removed from stack, moves to graveyard, bolt never resolves", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0); // Counterspell caster
    const seat1 = mkPlayerSeat(1); // Bolt caster

    const counterspellId = mkEntityId(10000);
    const boltId = mkEntityId(10001);

    // 1. Parse both cards
    const csDef = parseCard(counterspellSrc, "counterspell.txt");
    const csPaper: PaperCard = {
      name: "Counterspell",
      edition: "LEA",
      collectorNumber: "54",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: csDef,
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
    const csCard = addCardToHand(game, csPaper, seat0, counterspellId);
    csCard.activateAbilitiesFromDefinition();

    const boltCard = addCardToHand(game, boltPaper, seat1, boltId);
    boltCard.activateAbilitiesFromDefinition();

    // 3. seat1 casts the Bolt (opponent plays first)
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

    // Bolt is no longer in hand
    expect(boltCard.zone).toBe(ZoneType.Hand); // still tracked as "Hand" until resolve

    // 4. seat0 responds with Counterspell — seeds 2 blue mana
    const csPool = new ManaPool();
    csPool.add(ManaProduced.colored(Color.Blue));
    csPool.add(ManaProduced.colored(Color.Blue));
    game.getPlayer(seat0).manaPool = csPool;

    const csProposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: counterspellId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { events: castEvents, result: csStackItem } = drainCast(
      game.castPipeline.run(csProposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(csStackItem).not.toBeNull();
    expect(castEvents).toContain("CostPaid");
    expect(castEvents).toContain("SpellCast");
    expect(csPool.size()).toBe(0);

    // Stack now has 2 items: Bolt (bottom), Counterspell (top — LIFO)
    expect(game.sharedZones.stack.size).toBe(2);

    // 5. Patch Counterspell with Bolt's stack item id as target.
    //    CounterSpellEffect.resolve iterates sa.targets treating each as
    //    a stack item id (EntityId). The bolt's stack item id is boltItem.id.
    const saTemplate = csCard.spellAbilities[0];
    if (!saTemplate) throw new Error("test: card has no spellAbilities");
    const boundSa = new SpellAbility(
      saTemplate.ast,
      saTemplate.sourceCardId,
      saTemplate.controllerSeat,
      saTemplate.svars,
      [boltItem.id], // targeting the bolt's stack item by id
    );
    const patchedCsItem: StackItem = { ...(csStackItem as StackItem), resolver: boundSa.makeResolver() };
    game.sharedZones.stack.pop(); // remove old Counterspell item
    game.sharedZones.stack.push(patchedCsItem);

    // 6. Resolve Counterspell (LIFO — it's on top)
    const resolveEvents = drainResolver(
      resolveStackItem(game, patchedCsItem) as Generator<unknown, void, unknown>,
    );

    // Counterspell resolution events
    expect(resolveEvents).toContain("StackItemCountered");
    expect(resolveEvents).toContain("StackItemResolved");

    // Bolt removed from stack (stack now empty)
    expect(game.sharedZones.stack.size).toBe(0);

    // Bolt's source card moved to graveyard (CounterSpellEffect.resolve does moveTo(Graveyard))
    expect(boltCard.zone).toBe(ZoneType.Graveyard);

    // Counterspell itself moved to graveyard (post-resolve zone change for spell kind)
    expect(csCard.zone).toBe(ZoneType.Graveyard);

    // Life totals unchanged (bolt never resolved)
    expect(game.getPlayer(seat0).life).toBe(20);
    expect(game.getPlayer(seat1).life).toBe(20);
  });
});
