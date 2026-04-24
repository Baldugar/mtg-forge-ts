import { parseCard } from "@mtg-forge-ts/cards";
// SPDX-License-Identifier: GPL-3.0-or-later
// Task 60 — verify that CastPipeline.stepPayCosts calls the real payCost
// orchestrator when totalCost.base.raw is a parseable mana cost string.
// Scenarios:
//   - Pay "R" with 1 R in pool → pool drained, CostPaid fires.
//   - Pay "R" with empty pool → pipeline aborts (cast returns null), pool unchanged.
//   - Abort path: payment succeeds then finalizeStackItem throws → pool refunded.
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
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
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { ManaPool } from "../mana/mana-pool.js";
import type { StackItem } from "../stack/stack-item.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import type { CastContext } from "./cast-context.js";
import { CastPipeline, type CastProposal } from "./cast-pipeline.js";

// Side-effect: register cost parts (CostMana etc.)
import "../cost/parts/index.js";
// SVar selectors
import "../svar/selectors/number.js";

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

const makeBoltCard = (
  game: Game,
  seat: ReturnType<typeof mkPlayerSeat>,
  id: ReturnType<typeof mkEntityId>,
): Card => {
  const def = parseCard(boltSrc, "lightning_bolt.txt");
  const paper: PaperCard = {
    name: "Lightning Bolt",
    edition: "LEA",
    collectorNumber: "161",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition: def,
  };
  const card = new Card(id, paper, seat, seat, ZoneType.Hand);
  game.cards.set(id, card);
  const hand = game.getPlayer(seat).zones.get(ZoneType.Hand);
  if (!hand) throw new Error("test: missing hand zone");
  hand.add(id);
  return card;
};

/** Drain the cast generator. Responds to activateManaAbilities with done:true, skips SpellCast. */
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

/**
 * A CastPipeline subclass whose finalizeStackItem always throws. Used to
 * verify that abort() undoes a previously-successful stepPayCosts.
 */
class AbortAfterPayPipeline extends CastPipeline {
  protected override *stepPayCosts(
    ctx: CastContext,
  ): Generator<import("../action/engine-yield.js").EngineYield, void, unknown> {
    yield* super.stepPayCosts(ctx);
  }
  protected override finalizeStackItem(_ctx: CastContext): StackItem {
    throw new Error("test: forced abort after payment");
  }
}

describe("Task 60 — stepPayCosts real payment via payCost", () => {
  it("drains 1 R from pool when casting Lightning Bolt with R available", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const cardId = mkEntityId(400);
    makeBoltCard(game, seat0, cardId);

    // Seed mana pool with 1 R
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Red));
    game.getPlayer(seat0).manaPool = pool;

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: cardId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };

    const { events, result } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );

    expect(result).not.toBeNull();
    expect(events).toContain("CostPaid");
    // Pool should now be empty after payment
    expect(pool.size()).toBe(0);
  });

  it("aborts (returns null) when casting Lightning Bolt with empty pool", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const cardId = mkEntityId(500);
    makeBoltCard(game, seat0, cardId);

    // Pool is empty (default)
    const pool = new ManaPool();
    game.getPlayer(seat0).manaPool = pool;

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: cardId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };

    const { events, result } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );

    expect(result).toBeNull();
    expect(events).toContain("CastAborted");
    // Pool should still be empty (nothing to refund)
    expect(pool.size()).toBe(0);
  });

  it("abort path refunds the pool — undo restores 1 R after finalization throws", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const cardId = mkEntityId(600);
    makeBoltCard(game, seat0, cardId);

    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Red));
    game.getPlayer(seat0).manaPool = pool;

    const pipeline = new AbortAfterPayPipeline(game);
    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: cardId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };

    const { events, result } = drainCast(
      pipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );

    expect(result).toBeNull();
    expect(events).toContain("CastAborted");
    // Pool should be restored to 1 R (undo refunded the payment)
    expect(pool.size()).toBe(1);
  });
});
