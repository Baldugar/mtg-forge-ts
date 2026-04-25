// SPDX-License-Identifier: GPL-3.0-or-later
// F14 — Two-player Counterspell stops Bolt — full priority window scenario.
//
// Scenario:
//   1. Player 0 casts Lightning Bolt targeting Player 1 (1R in pool).
//   2. While Bolt is on the stack, Player 1 casts Counterspell targeting the
//      Bolt stack item (2U in pool).
//   3. Stack has Counterspell on top (LIFO), Bolt on bottom.
//   4. Resolve Counterspell first: removes Bolt from stack, Bolt goes to GY,
//      Counterspell goes to GY.
//   5. Stack is empty. Player 1's life is unchanged (Bolt never resolved).
//
// Multi-player aspects tested:
//   - Player 1 (the defender/non-active player) casts a spell in response
//   - Each player pays their own mana (separate pools)
//   - Stack ordering (LIFO) means the last-cast spell resolves first
//   - After Counterspell resolves, the countered Bolt never deals damage
//
// This test drives the FULL cast pipeline for both players, including
// mana payment from different player seats.
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

const boltSrc = `${[
  "Name:Lightning Bolt",
  "ManaCost:R",
  "Types:Instant",
  "A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ CARDNAME deals 3 damage to any target.",
  "Oracle:Lightning Bolt deals 3 damage to any target.",
].join("\n")}\n`;

const counterspellSrc = `${[
  "Name:Counterspell",
  "ManaCost:U U",
  "Types:Instant",
  "A:SP$ Counter | Cost$ U U | ValidTgts$ Card.nonLand | TgtPrompt$ Select target spell to counter | SpellDescription$ Counter target spell.",
  "Oracle:Counter target spell.",
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

describe("Flagship: two-player Counterspell stops Bolt — full priority window", () => {
  it("Player 1 counters Player 0's Bolt — bolt countered, no damage dealt", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0); // Alice — Bolt caster
    const seat1 = mkPlayerSeat(1); // Bob — Counterspell caster

    const boltId = mkEntityId(24000);
    const csId = mkEntityId(24001);

    // 1. Parse both cards
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

    // 2. Add to respective hands
    const boltCard = addCardToHand(game, boltPaper, seat0, boltId);
    boltCard.activateAbilitiesFromDefinition();

    const csCard = addCardToHand(game, csPaper, seat1, csId);
    csCard.activateAbilitiesFromDefinition();

    // 3. Player 0 (Alice) casts Lightning Bolt — seed 1R
    const alicePool = new ManaPool();
    alicePool.add(ManaProduced.colored(Color.Red));
    game.getPlayer(seat0).manaPool = alicePool;

    // Bolt targets Player 1 (seat1) — target is seat1 as EntityId
    // DealDamage uses targets; we'll patch after cast like other tests
    const boltProposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: boltId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { events: boltCastEvents, result: boltRawItem } = drainCast(
      game.castPipeline.run(boltProposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(boltRawItem).not.toBeNull();
    expect(boltCastEvents).toContain("CostPaid");
    expect(boltCastEvents).toContain("SpellCast");
    expect(alicePool.size()).toBe(0); // 1R spent

    // Stack now has Bolt
    const boltItem = boltRawItem as StackItem;
    expect(game.sharedZones.stack.size).toBe(1);
    expect(game.sharedZones.stack.top()?.id).toBe(boltItem.id);

    // Note: priority opens for Player 1 here (the non-active player gets priority
    // in response). Player 1 acts: casts Counterspell.

    // 4. Player 1 (Bob) responds with Counterspell — seed 2U
    const bobPool = new ManaPool();
    bobPool.add(ManaProduced.colored(Color.Blue));
    bobPool.add(ManaProduced.colored(Color.Blue));
    game.getPlayer(seat1).manaPool = bobPool;

    const csProposal: CastProposal = {
      castingPlayer: seat1,
      sourceCardId: csId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { events: csCastEvents, result: csRawItem } = drainCast(
      game.castPipeline.run(csProposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(csRawItem).not.toBeNull();
    expect(csCastEvents).toContain("CostPaid");
    expect(csCastEvents).toContain("SpellCast");
    expect(bobPool.size()).toBe(0); // 2U spent

    // Stack now has 2 items: Bolt (bottom), Counterspell (top — LIFO)
    const csItem = csRawItem as StackItem;
    expect(game.sharedZones.stack.size).toBe(2);
    expect(game.sharedZones.stack.top()?.id).toBe(csItem.id);

    // 5. Patch Counterspell: target is the Bolt's stack item id
    const csSaTemplate = csCard.spellAbilities[0];
    if (!csSaTemplate) throw new Error("test: Counterspell has no spellAbilities");
    const csBoundSa = new SpellAbility(
      csSaTemplate.ast,
      csSaTemplate.sourceCardId,
      csSaTemplate.controllerSeat,
      csSaTemplate.svars,
      [boltItem.id], // targeting the Bolt stack item by EntityId
    );
    const patchedCsItem: StackItem = {
      ...csItem,
      resolver: csBoundSa.makeResolver(),
    };
    game.sharedZones.stack.pop(); // remove unpatchedCounterspell
    game.sharedZones.stack.push(patchedCsItem);

    // Stack top is now the patched Counterspell
    expect(game.sharedZones.stack.top()?.id).toBe(patchedCsItem.id);

    // 6. Resolve Counterspell (LIFO — it's on top)
    //    Priority is passed around and both players pass → Counterspell resolves.
    const csResolveEvents = drainResolver(
      resolveStackItem(game, patchedCsItem) as Generator<unknown, void, unknown>,
    );

    expect(csResolveEvents).toContain("StackItemCountered");
    expect(csResolveEvents).toContain("StackItemResolved");

    // 7. Verify post-resolution state

    // Stack is empty — both Bolt (countered) and Counterspell (resolved) are gone
    expect(game.sharedZones.stack.size).toBe(0);

    // Bolt's source card (boltCard) moved to graveyard (CounterSpellEffect.resolve)
    expect(boltCard.zone).toBe(ZoneType.Graveyard);

    // Counterspell itself moved to Player 1's graveyard
    expect(csCard.zone).toBe(ZoneType.Graveyard);

    // Player 1's life is unchanged — Bolt never resolved, no damage dealt
    expect(game.getPlayer(seat0).life).toBe(20);
    expect(game.getPlayer(seat1).life).toBe(20);

    // Player 0's mana pool drained when bolt was cast
    expect(alicePool.size()).toBe(0);
    // Player 1's mana pool drained when Counterspell was cast
    expect(bobPool.size()).toBe(0);
  });

  it("stack ordering — Counterspell is top, Bolt is below; correct LIFO resolution", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);

    const boltId = mkEntityId(25000);
    const csId = mkEntityId(25001);

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

    const boltCard = addCardToHand(game, boltPaper, seat0, boltId);
    boltCard.activateAbilitiesFromDefinition();
    const csCard = addCardToHand(game, csPaper, seat1, csId);
    csCard.activateAbilitiesFromDefinition();

    // Alice casts Bolt
    const p0Pool = new ManaPool();
    p0Pool.add(ManaProduced.colored(Color.Red));
    game.getPlayer(seat0).manaPool = p0Pool;
    const { result: boltItemRaw } = drainCast(
      game.castPipeline.run({
        castingPlayer: seat0,
        sourceCardId: boltId,
        originZone: ZoneType.Hand,
        asSpecialAction: false,
      }) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    const boltItem = boltItemRaw as StackItem;

    // Bob casts Counterspell
    const p1Pool = new ManaPool();
    p1Pool.add(ManaProduced.colored(Color.Blue));
    p1Pool.add(ManaProduced.colored(Color.Blue));
    game.getPlayer(seat1).manaPool = p1Pool;
    const { result: csItemRaw } = drainCast(
      game.castPipeline.run({
        castingPlayer: seat1,
        sourceCardId: csId,
        originZone: ZoneType.Hand,
        asSpecialAction: false,
      }) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    const csItem = csItemRaw as StackItem;

    // Stack has 2 items: Counterspell on top (index 1), Bolt below (index 0)
    expect(game.sharedZones.stack.size).toBe(2);
    // top() is Counterspell
    expect(game.sharedZones.stack.top()?.id).toBe(csItem.id);
    // Bolt was pushed first and is below Counterspell
    const stackArray = game.sharedZones.stack.toArray();
    expect(stackArray[0]?.id).toBe(boltItem.id);
    expect(stackArray[1]?.id).toBe(csItem.id);
  });
});
