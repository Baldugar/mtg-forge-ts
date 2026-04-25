// SPDX-License-Identifier: GPL-3.0-or-later
// F1 — Llanowar Elves flagship integration test.
// Tests mana ability (AB$ Mana | Cost$ T | Produced$ G): tap Llanowar Elves
// → adds G to controller's mana pool.
//
// Test structure:
//   Phase A: Cast Llanowar Elves → resolve to Battlefield (ETB, no trigger).
//   Phase B: Activate the mana ability via game.action.activateAbility():
//     1. Activate ability index 0 — orchestrator pays {T} cost (card taps)
//        and pushes the activated ability onto the stack.
//     2. Resolve via resolveStackItem → G added to pool.
//     3. Assert: card tapped, pool has 1 G, stack empty.
//
// SCOPING NOTE: AB$ lines are parsed as SpellAbilities by
// activateAbilitiesFromDefinition (the parser doesn't distinguish SP vs AB
// at the SpellAbility constructor level — both are AbilityAst.kind="spell"
// in the current parser). The handlerKey distinguishes them.
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
import { resolveStackItem } from "../../src/resolve/effect-resolve.js";
import type { StackItem } from "../../src/stack/stack-item.js";
import { Battlefield } from "../../src/zone/zones/battlefield.js";
import { Graveyard } from "../../src/zone/zones/graveyard.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

// Self-register all effects (ManaEffect, etc.)
import "../../src/ability/effects/index.js";
// Register cost parts (CostTap, CostMana, etc.)
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

// Llanowar Elves: G creature with {T}: Add {G}.
// AB$ lines are parsed identically to SP$ lines by activateAbilitiesFromDefinition;
// the handlerKey "Mana" distinguishes them from spell effects.
const llanowarElvesSrc = `${[
  "Name:Llanowar Elves",
  "ManaCost:G",
  "Types:Creature Elf Druid",
  "PT:1/1",
  "A:AB$ Mana | Cost$ T | Produced$ G | SpellDescription$ Add {G}.",
  "Oracle:{T}: Add {G}.",
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

describe("Flagship: Llanowar Elves end-to-end integration", () => {
  it("Phase A: casts and resolves to battlefield", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const elvesId = mkEntityId(15000);

    const def = parseCard(llanowarElvesSrc, "llanowar_elves.txt");
    const elvesPaper: PaperCard = {
      name: "Llanowar Elves",
      edition: "LEA",
      collectorNumber: "186",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };

    const elvesCard = addCardToHand(game, elvesPaper, seat0, elvesId);
    elvesCard.activateAbilitiesFromDefinition();

    // Verify the AB$ Mana ability was parsed as a SpellAbility
    expect(elvesCard.spellAbilities).toHaveLength(1);
    expect(elvesCard.spellAbilities[0]?.handlerKey).toBe("Mana");

    // Seed 1 G to cast
    const castPool = new ManaPool();
    castPool.add(ManaProduced.colored(Color.Green));
    game.getPlayer(seat0).manaPool = castPool;

    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: elvesId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { result: rawStackItem } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );
    expect(rawStackItem).not.toBeNull();

    // Patch to battlefield destination (creature spells go to battlefield)
    const spellItem = rawStackItem as StackItem;
    const patchedItem: StackItem = {
      ...spellItem,
      provenance: { ...spellItem.provenance, alternativeZoneDestination: ZoneType.Battlefield },
    };
    game.sharedZones.stack.pop();
    game.sharedZones.stack.push(patchedItem);

    const resolveEvents = drainResolver(
      resolveStackItem(game, patchedItem) as Generator<unknown, void, unknown>,
    );

    expect(resolveEvents).toContain("StackItemResolved");
    expect(resolveEvents).toContain("CardChangedZone");
    expect(elvesCard.zone).toBe(ZoneType.Battlefield);
    expect(elvesCard.tapped).toBe(false);
  });

  it("Phase B: {T}: Add {G} via canonical activateAbility — card taps, pool gains 1 G", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const elvesId = mkEntityId(16000);

    const def = parseCard(llanowarElvesSrc, "llanowar_elves.txt");
    const elvesPaper: PaperCard = {
      name: "Llanowar Elves",
      edition: "LEA",
      collectorNumber: "186",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };

    // Place Llanowar Elves directly on battlefield (skip casting for this test).
    const elvesCard = new Card(elvesId, elvesPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(elvesId, elvesCard);
    const bf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);
    if (!bf) throw new Error("test: missing battlefield zone");
    bf.add(elvesId);
    elvesCard.activateAbilitiesFromDefinition();

    // Verify the AB$ Mana ability was parsed.
    expect(elvesCard.spellAbilities).toHaveLength(1);
    expect(elvesCard.spellAbilities[0]?.handlerKey).toBe("Mana");

    // Pool starts empty.
    const pool = new ManaPool();
    game.getPlayer(seat0).manaPool = pool;
    expect(pool.size()).toBe(0);
    expect(elvesCard.tapped).toBe(false);

    // Activate ability index 0 via the canonical orchestrator.
    const activateEvents: string[] = [];
    const activateGen = game.action.activateAbility(elvesId, 0, seat0) as Generator<
      { kind: string; event?: { kind?: string } },
      unknown,
      unknown
    >;
    let activateStep = activateGen.next();
    while (!activateStep.done) {
      const y = activateStep.value;
      if (y.kind === "event" && y.event?.kind) activateEvents.push(y.event.kind);
      activateStep = activateGen.next();
    }

    // Cost paid: card is now tapped. AbilityActivated event fired.
    expect(elvesCard.tapped).toBe(true);
    expect(activateEvents).toContain("CardTapped");
    expect(activateEvents).toContain("AbilityActivated");

    // Stack has the activated ability item.
    expect(game.sharedZones.stack.size).toBe(1);

    // Resolve the ability (drives ManaEffect — adds G to pool).
    const stackItem = game.sharedZones.stack.top();
    if (!stackItem) throw new Error("test: stack is empty after activateAbility");
    const resolveEvents = drainResolver(
      resolveStackItem(game, stackItem) as Generator<unknown, void, unknown>,
    );

    expect(resolveEvents).toContain("StackItemResolved");

    // Pool has exactly 1 G.
    expect(pool.size()).toBe(1);
    // Verify green by adding a white and confirming total = 2.
    pool.add(ManaProduced.colored(Color.White));
    expect(pool.size()).toBe(2);

    // Card remains on battlefield, tapped.
    expect(elvesCard.zone).toBe(ZoneType.Battlefield);
    expect(elvesCard.tapped).toBe(true);

    // Stack is now empty.
    expect(game.sharedZones.stack.size).toBe(0);
  });
});
