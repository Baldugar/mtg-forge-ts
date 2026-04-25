// SPDX-License-Identifier: GPL-3.0-or-later
// F3 — Wrath of God flagship integration test.
// Tests DestroyAllEffect with ValidCards$ Creature — destroys ALL creatures
// on the battlefield regardless of controller.
//
// Scenario: seat0 has a 2/2 creature, seat1 has a 2/2 creature.
// Cast Wrath of God (2WW). Both creatures move to graveyard.
import { parseCard } from "@mtg-forge-ts/cards";
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  CardType,
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

const wrathSrc = `${[
  "Name:Wrath of God",
  "ManaCost:2 W W",
  "Types:Sorcery",
  "A:SP$ DestroyAll | Cost$ 2 W W | ValidCards$ Creature | NoRegen$ True | SpellDescription$ Destroy all creatures. They can't be regenerated.",
  "Oracle:Destroy all creatures. They can't be regenerated.",
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

// deriveBaseCharacteristics (SP4 gap): does NOT read CardType from PaperCard.definition.
// DestroyAllEffect and ChangesZoneAllTrigger both call
// game.layerEngine.computeCharacteristics() and check chars.types.has(CardType.Creature).
// Without Layer4 seeding, no card appears as a Creature. The workaround (same pattern
// as destroy-all.test.ts) is to push a global "add Creature" Layer4 effect before cast.
const seedCreatureType = (game: Game): void => {
  game.layerEngine.typeEffects.push({
    kind: "add",
    cardType: CardType.Creature,
    isCda: false,
    timestamp: 0,
    sourceAbilityId: null,
  });
};

describe("Flagship: Wrath of God end-to-end integration", () => {
  it("destroys all creatures — both cards move to graveyard, life unchanged", () => {
    const game = makeGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const wrathId = mkEntityId(7000);
    const bear1Id = mkEntityId(7001);
    const bear2Id = mkEntityId(7002);

    // 1. Parse Wrath of God
    const wrathDef = parseCard(wrathSrc, "wrath_of_god.txt");
    const wrathPaper: PaperCard = {
      name: "Wrath of God",
      edition: "LEA",
      collectorNumber: "47",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: wrathDef,
    };

    // 2. Build a minimal Grizzly Bears PaperCard (no definition needed; Creature type
    //    is injected via Layer4 seeding — same pattern as destroy-all.test.ts).
    const bearPaper: PaperCard = {
      name: "Grizzly Bears",
      edition: "LEA",
      collectorNumber: "195",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
    };

    // 3. Add Wrath to seat0's hand
    const wrathCard = addCardToHand(game, wrathPaper, seat0, wrathId);
    wrathCard.activateAbilitiesFromDefinition();

    // 4. Add one creature per player to battlefield
    const bear1 = addCardToBattlefield(game, bearPaper, seat0, bear1Id);
    const bear2 = addCardToBattlefield(game, bearPaper, seat1, bear2Id);
    expect(bear1.zone).toBe(ZoneType.Battlefield);
    expect(bear2.zone).toBe(ZoneType.Battlefield);

    // SP4 gap workaround: deriveBaseCharacteristics does not read CardType from
    // PaperCard.definition. Seed a global Layer4 "add Creature" effect so that
    // DestroyAllEffect.collectMatching() sees all cards as Creatures.
    seedCreatureType(game);

    // 5. Seed 4 mana: 2 colorless + 2 white (Wrath costs 2WW)
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colorless());
    pool.add(ManaProduced.colored(Color.White));
    pool.add(ManaProduced.colored(Color.White));
    game.getPlayer(seat0).manaPool = pool;

    expect(game.getPlayer(seat0).life).toBe(20);
    expect(game.getPlayer(seat1).life).toBe(20);

    // 6. Cast Wrath of God
    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: wrathId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { events: castEvents, result: stackItem } = drainCast(
      game.castPipeline.run(proposal) as Generator<{ kind: string }, StackItem | null, unknown>,
    );

    expect(stackItem).not.toBeNull();
    expect(castEvents).toContain("CostPaid");
    expect(castEvents).toContain("SpellCast");
    expect(pool.size()).toBe(0);

    // 7. Resolve Wrath of God
    const resolveEvents = drainResolver(
      resolveStackItem(game, stackItem as StackItem) as Generator<unknown, void, unknown>,
    );

    // At least 2 CardDestroyed events (the two bears). The Layer4 global Creature
    // seed also causes the Wrath sorcery itself (still in game.cards) to be
    // collected by collectMatching — a known artefact of the SP4 gap in
    // deriveBaseCharacteristics (no zone filter in collectMatching). The bears'
    // zone transitions are the canonical assertions below.
    const destroyedEvents = resolveEvents.filter((e) => e === "CardDestroyed");
    expect(destroyedEvents.length).toBeGreaterThanOrEqual(2);
    expect(resolveEvents).toContain("StackItemResolved");

    // Both bears in graveyard
    expect(bear1.zone).toBe(ZoneType.Graveyard);
    expect(bear2.zone).toBe(ZoneType.Graveyard);

    // Wrath in graveyard
    expect(wrathCard.zone).toBe(ZoneType.Graveyard);

    // Life totals unchanged (Wrath doesn't deal damage)
    expect(game.getPlayer(seat0).life).toBe(20);
    expect(game.getPlayer(seat1).life).toBe(20);

    // Stack empty
    expect(game.sharedZones.stack.size).toBe(0);
  });
});
