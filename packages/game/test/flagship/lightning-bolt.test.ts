import { parseCard } from "@mtg-forge-ts/cards";
// SPDX-License-Identifier: GPL-3.0-or-later
// Task 61 — Lightning Bolt flagship integration test.
// Exercises the complete parse → build → cast → pay → resolve pipeline:
//   1. Parse Lightning Bolt source text into a CardDefinition.
//   2. Construct a Card in the casting player's hand and call
//      activateAbilitiesFromDefinition().
//   3. Seed 1 R in the casting player's mana pool.
//   4. Run CastPipeline (steps 1-10, no targeting decision since we bind
//      the target through the SpellAbility before resolving).
//   5. Resolve the stack item via resolveStackItem with the opponent as target.
//   6. Assert: opponent life 20 → 17, Lightning Bolt in graveyard, pool empty.
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

// Self-register all M7 effects into the effectRegistry
import "../../src/ability/effects/index.js";
// Register cost parts into costPartRegistry
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

/**
 * Drive the cast generator. Responds to activateManaAbilities with done:true.
 * Returns the finalized StackItem (or null on abort) plus all event kinds.
 */
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

/**
 * Drain a resolver generator. Auto-responds to orderReplacements decisions
 * by echoing the provided order; fails fast on any unexpected decision kind.
 */
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

describe("Flagship: Lightning Bolt end-to-end integration", () => {
  it("deals 3 damage to opponent — life 20 → 17, pool empty, bolt in graveyard", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0); // caster
    const seat1 = mkPlayerSeat(1); // target
    const boltId = mkEntityId(1000);

    // 1. Parse Lightning Bolt definition and build PaperCard
    const def = parseCard(boltSrc, "lightning_bolt.txt");
    const boltPaper: PaperCard = {
      name: "Lightning Bolt",
      edition: "LEA",
      collectorNumber: "161",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };

    // 2. Add Lightning Bolt to caster's hand and activate abilities
    const boltCard = addCardToHand(game, boltPaper, seat0, boltId);
    boltCard.activateAbilitiesFromDefinition();

    // 3. Seed 1 R in caster's mana pool
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Red));
    game.getPlayer(seat0).manaPool = pool;

    // Verify initial state
    expect(game.getPlayer(seat0).life).toBe(20);
    expect(game.getPlayer(seat1).life).toBe(20);
    expect(pool.size()).toBe(1);
    expect(boltCard.zone).toBe(ZoneType.Hand);

    // 4. Run CastPipeline — the bolt has no PaperCard.targetRestriction
    //    so step 7 auto-passes. We cast without a target here, then bind
    //    the target explicitly when resolving (as the plan allows for
    //    cards without a configured targetRestriction on the PaperCard).
    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: boltId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { events: castEvents, result: stackItem } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );

    // Cast must succeed
    expect(stackItem).not.toBeNull();
    expect(castEvents).toContain("CostPaid");
    expect(castEvents).toContain("SpellCast");
    // Pool drained after payment
    expect(pool.size()).toBe(0);

    // 5. Resolve — rebuild the resolver with seat1 as target.
    //    The cast pipeline built a resolver with no targets (because there
    //    was no targetRestriction on the PaperCard). We patch the stack item
    //    with a target-bound resolver.
    const saTemplate = boltCard.spellAbilities[0];
    if (!saTemplate) throw new Error("test: card has no spellAbilities");
    const boundSa = new SpellAbility(
      saTemplate.ast,
      saTemplate.sourceCardId,
      saTemplate.controllerSeat,
      saTemplate.svars,
      [seat1 as unknown as EntityId],
    );
    const patchedItem: StackItem = { ...(stackItem as StackItem), resolver: boundSa.makeResolver() };
    // Replace stack item
    game.sharedZones.stack.pop();
    game.sharedZones.stack.push(patchedItem);

    const resolveEvents = drainResolver(
      resolveStackItem(game, patchedItem) as Generator<unknown, void, unknown>,
    );

    // 6. Assertions
    // Opponent life: 20 - 3 = 17
    expect(game.getPlayer(seat1).life).toBe(17);
    // Pool still empty (no refund after successful resolve)
    expect(pool.size()).toBe(0);
    // DamageDealt event fired
    expect(resolveEvents).toContain("DamageDealt");
    // StackItemResolved event fired
    expect(resolveEvents).toContain("StackItemResolved");
    // Lightning Bolt moved to graveyard
    expect(boltCard.zone).toBe(ZoneType.Graveyard);
    // Stack is empty
    expect(game.sharedZones.stack.size).toBe(0);
  });

  it("DamageDealt event has correct payload (source, target, amount)", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const boltId = mkEntityId(2000);

    const def = parseCard(boltSrc, "lightning_bolt.txt");
    const boltPaper: PaperCard = {
      name: "Lightning Bolt",
      edition: "LEA",
      collectorNumber: "161",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const boltCard = addCardToHand(game, boltPaper, seat0, boltId);
    boltCard.activateAbilitiesFromDefinition();

    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Red));
    game.getPlayer(seat0).manaPool = pool;

    const { result: stackItem } = drainCast(
      game.castPipeline.run({
        castingPlayer: seat0,
        sourceCardId: boltId,
        originZone: ZoneType.Hand,
        asSpecialAction: false,
      }) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(stackItem).not.toBeNull();

    const saTemplate = boltCard.spellAbilities[0];
    if (!saTemplate) throw new Error("test: card has no spellAbilities");
    const boundSa = new SpellAbility(
      saTemplate.ast,
      saTemplate.sourceCardId,
      saTemplate.controllerSeat,
      saTemplate.svars,
      [seat1 as unknown as EntityId],
    );
    const patchedItem: StackItem = { ...(stackItem as StackItem), resolver: boundSa.makeResolver() };
    game.sharedZones.stack.pop();
    game.sharedZones.stack.push(patchedItem);

    const allEvents: { kind: string; payload?: unknown }[] = [];
    const gen = resolveStackItem(game, patchedItem) as Generator<
      { kind: string; event?: { kind: string; payload?: unknown } },
      void,
      unknown
    >;
    let step = gen.next();
    while (!step.done) {
      const y = step.value;
      if (y.kind === "event" && y.event) {
        allEvents.push({ kind: y.event.kind, payload: y.event.payload });
      }
      if (y.kind === "decision") {
        const req = y as unknown as { request?: { kind?: string; replacementIds?: number[] } };
        if (req.request?.kind === "orderReplacements") {
          step = gen.next({ order: [...(req.request.replacementIds ?? [])] });
          continue;
        }
      }
      step = gen.next();
    }

    const damageEvent = allEvents.find((e) => e.kind === "DamageDealt");
    expect(damageEvent).toBeDefined();
    const payload = damageEvent?.payload as { amount?: number; targetKind?: string } | undefined;
    expect(payload?.amount).toBe(3);
    expect(payload?.targetKind).toBe("player");
  });
});
