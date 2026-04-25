// SPDX-License-Identifier: GPL-3.0-or-later
// F-SumPower — SumPower flagship integration test.
// Proves that SumPower$Creature.YouCtrl flows through the full cast-resolve
// pipeline and evaluates correctly against real battlefield state.
//
// Scenario: seat0 has two 2/2 Grizzly Bears on the battlefield (total
// power = 4). They cast "Verdant Harvest" (a sorcery with
//   LifeAmount$ X / SVar:X:SumPower$Creature.YouCtrl).
// After resolution, seat0's life should be 20 + 4 = 24.
//
// This validates:
//   - deriveBaseCharacteristics reads PaperCard.definition (Creature type + P/T)
//   - SumPower selector correctly aggregates battlefield permanents
//   - YouCtrl filter excludes opponent's cards
//   - SVar indirection (svarRef → expression → selector) flows end-to-end
//   - GainLife effect resolves with the computed numeric value
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

// Self-register all effects (GainLife, etc.)
import "../../src/ability/effects/index.js";
// Register cost parts
import "../../src/cost/parts/index.js";
// SVar selectors — number.js for literal/X, sum-aggregates.js for SumPower
import "../../src/svar/selectors/number.js";
import "../../src/svar/selectors/sum-aggregates.js";

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

// Synthetic sorcery: gain life equal to the sum of power of your creatures.
// SVar:X:SumPower$Creature.YouCtrl → LifeAmount resolves to sumPower(YouCtrl).
const verdantHarvestSrc = `${[
  "Name:Verdant Harvest",
  "ManaCost:G",
  "Types:Sorcery",
  "A:SP$ GainLife | Cost$ G | LifeAmount$ X",
  "SVar:X:SumPower$Creature.YouCtrl",
  "Oracle:You gain life equal to the total power of creatures you control.",
].join("\n")}\n`;

// A 2/2 Grizzly Bears — types parsed from definition, no Layer4 injection needed.
const grizzlyBearsSrc = `${[
  "Name:Grizzly Bears",
  "ManaCost:1 G",
  "Types:Creature Bear",
  "PT:2/2",
  "Oracle:2/2",
].join("\n")}\n`;

const makeGame = (): Game => {
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

const addCardToBattlefield = (game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
  game.cards.set(id, card);
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  if (!bf) throw new Error("test: missing battlefield zone");
  bf.add(id);
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

describe("Flagship: SumPower end-to-end integration", () => {
  it("GainLife via SumPower$Creature.YouCtrl — two 2/2 bears → life 20 → 24", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);

    // 1. Parse cards.
    const harvestDef = parseCard(verdantHarvestSrc, "verdant_harvest.txt");
    const harvestPaper: PaperCard = {
      name: "Verdant Harvest",
      edition: "TST",
      collectorNumber: "001",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: harvestDef,
    };

    const bearDef = parseCard(grizzlyBearsSrc, "grizzly_bears.txt");
    const bearPaper: PaperCard = {
      name: "Grizzly Bears",
      edition: "LEA",
      collectorNumber: "195",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: bearDef,
    };

    // 2. Put "Verdant Harvest" in seat0's hand.
    const harvestId = mkEntityId(9001);
    const harvestCard = addCardToHand(game, harvestPaper, seat0, harvestId);
    harvestCard.activateAbilitiesFromDefinition();

    // 3. Put two 2/2 Bears on seat0's battlefield (total power = 4).
    //    deriveBaseCharacteristics reads Creature type + P/T from definition;
    //    no Layer4 injection required.
    addCardToBattlefield(game, bearPaper, seat0, mkEntityId(9010));
    addCardToBattlefield(game, bearPaper, seat0, mkEntityId(9011));

    // 4. Put one 3/3 Bear on seat1's battlefield (should be excluded by YouCtrl).
    //    Use a hand-crafted 3/3 definition.
    const bear3Src = `${[
      "Name:Hill Giant",
      "ManaCost:3 R",
      "Types:Creature Giant",
      "PT:3/3",
      "Oracle:3/3",
    ].join("\n")}\n`;
    const bear3Def = parseCard(bear3Src, "hill_giant.txt");
    const bear3Paper: PaperCard = {
      name: "Hill Giant",
      edition: "LEA",
      collectorNumber: "170",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: bear3Def,
    };
    addCardToBattlefield(game, bear3Paper, seat1, mkEntityId(9020));

    // 5. Seed 1 green mana (Verdant Harvest costs G).
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Green));
    game.getPlayer(seat0).manaPool = pool;

    // Verify starting life.
    expect(game.getPlayer(seat0).life).toBe(20);
    expect(game.getPlayer(seat1).life).toBe(20);

    // 6. Cast Verdant Harvest.
    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: harvestId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { events: castEvents, result: stackItem } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );

    expect(stackItem).not.toBeNull();
    expect(castEvents).toContain("SpellCast");
    expect(castEvents).toContain("CostPaid");
    expect(pool.size()).toBe(0);

    // 7. Resolve: GainLife fires, SVar X → SumPower$Creature.YouCtrl = 4.
    const resolveEvents = drainResolver(
      resolveStackItem(game, stackItem as StackItem) as Generator<unknown, void, unknown>,
    );

    expect(resolveEvents).toContain("LifeChanged");
    expect(resolveEvents).toContain("StackItemResolved");

    // 8. Assertions.
    // seat0 gains 4 (sum of power of two 2/2 bears): 20 → 24.
    expect(game.getPlayer(seat0).life).toBe(24);
    // seat1 life unchanged (YouCtrl excludes opponent's Hill Giant).
    expect(game.getPlayer(seat1).life).toBe(20);
    // Verdant Harvest in graveyard (sorcery resolved).
    expect(harvestCard.zone).toBe(ZoneType.Graveyard);
    // Stack is empty.
    expect(game.sharedZones.stack.size).toBe(0);
  });

  it("GainLife via SumPower$Creature.YouCtrl — zero creatures → life unchanged", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);

    const harvestDef = parseCard(verdantHarvestSrc, "verdant_harvest.txt");
    const harvestPaper: PaperCard = {
      name: "Verdant Harvest",
      edition: "TST",
      collectorNumber: "001",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: harvestDef,
    };

    const harvestId = mkEntityId(9100);
    const harvestCard = addCardToHand(game, harvestPaper, seat0, harvestId);
    harvestCard.activateAbilitiesFromDefinition();

    // No creatures on battlefield → SumPower = 0 → GainLife 0.
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Green));
    game.getPlayer(seat0).manaPool = pool;

    const { result: stackItem } = drainCast(
      game.castPipeline.run({
        castingPlayer: seat0,
        sourceCardId: harvestId,
        originZone: ZoneType.Hand,
        asSpecialAction: false,
      }) as Generator<{ kind: string }, StackItem | null, unknown>,
    );

    expect(stackItem).not.toBeNull();

    drainResolver(resolveStackItem(game, stackItem as StackItem) as Generator<unknown, void, unknown>);

    // 0 life gained — life stays at 20.
    expect(game.getPlayer(seat0).life).toBe(20);
    expect(game.sharedZones.stack.size).toBe(0);
  });
});
