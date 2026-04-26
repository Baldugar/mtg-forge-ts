// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 24 — Crew flagship integration test ("Smuggler's Copter" stand-in).
//
// Crew (CR 702.121) — "Crew N: Tap any number of untapped creatures you
// control with total power N or greater: This Vehicle becomes an artifact
// creature with its printed power and toughness until end of turn." Wave 24
// MVP synthesizes the activated ability via CrewKeywordHandler; the
// resolution path lives in CrewEffect, which:
//   1. Yields a chooseCrewSaddleCreatures decision.
//   2. Validates summed effective power ≥ N.
//   3. Taps each chosen creature.
//   4. Stamps card.crewedUntilEot = true and registers an untilEndOfTurn
//      ContinuousEffect with a cleanup hook that clears the flag at expiry.
//   5. Bumps the layer epoch and emits Crewed.
//
// This test pins the success metrics:
//   - The synthesized SpellAbility carries handlerKey "Crew" and is active
//     only on the battlefield.
//   - Activating with a 2/2 creature (Crew 1 → power 1 needed) succeeds:
//     the Bear is tapped, the Vehicle's effective types include Creature,
//     Crewed event fires, CrewedTrigger.matches returns true.
//   - When the untilEndOfTurn effect expires, card.crewedUntilEot reverts
//     to false and the Vehicle's types no longer include Creature.
import { parseCard } from "@mtg-forge-ts/cards";
import type {
  ContinuousEffect,
  EntityId,
  GameEvent,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
  TriggerAst,
} from "@mtg-forge-ts/core";
import {
  CardType,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkEvent,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../src/card.js";
import type { GameMeta } from "../../src/game-meta.js";
import type { GameRules } from "../../src/game-rules.js";
import { Game } from "../../src/game.js";
import { resolveStackItem } from "../../src/resolve/effect-resolve.js";
import { CrewedTrigger } from "../../src/trigger/handlers/wave-19-triggers.js";
import { Battlefield } from "../../src/zone/zones/battlefield.js";
import { Graveyard } from "../../src/zone/zones/graveyard.js";
import { Hand } from "../../src/zone/zones/hand.js";
import { Library } from "../../src/zone/zones/library.js";

// --- Bootstrap registries ---
import "../../src/cost/parts/index.js";
import "../../src/ability/effects/index.js";
import "../../src/keyword/index.js";

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
  forgeSha: "crew-test",
  cardDataSyncedAt: "2026-04-26T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "24",
};

// Smuggler's Copter — Crew 1, 3/3 Vehicle.
const copterSrc = `${[
  "Name:Smugglers Copter",
  "ManaCost:2",
  "Types:Artifact Vehicle",
  "PT:3/3",
  "K:Crew:1",
  "Oracle:Crew 1.",
].join("\n")}\n`;

// Grizzly Bears — 2/2 creature.
const bearsSrc = `${[
  "Name:Grizzly Bears",
  "ManaCost:1 G",
  "Types:Creature Bear",
  "PT:2/2",
  "Oracle:2/2",
].join("\n")}\n`;

const makeGame = (): Game => new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(24n) });

function setupZones(game: Game, seat: PlayerSeat): void {
  const player = game.getPlayer(seat);
  player.zones.set(ZoneType.Library, new Library(ZoneType.Library, seat));
  player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, seat));
  player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, seat));
  player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, seat));
}

function addCardToBattlefield(game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card {
  const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
  game.cards.set(id, card);
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  if (!bf) throw new Error("test: missing battlefield zone");
  bf.add(id);
  return card;
}

function buildCopterPaper(): PaperCard {
  const def = parseCard(copterSrc, "copter.txt");
  return {
    name: "Smugglers Copter",
    edition: "KLD",
    collectorNumber: "235",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition: def,
  };
}

function buildBearsPaper(): PaperCard {
  const def = parseCard(bearsSrc, "bears.txt");
  return {
    name: "Grizzly Bears",
    edition: "LEA",
    collectorNumber: "94",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition: def,
  };
}

// Drive a generator. Respond to chooseCrewSaddleCreatures with the supplied
// `tapIds`; default-respond to other decision kinds the engine might surface.
function driveGen(
  gen: Generator<unknown, unknown, unknown>,
  tapIds: readonly EntityId[] = [],
): { events: GameEvent[] } {
  const events: GameEvent[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value as {
      kind?: string;
      event?: GameEvent;
      request?: { kind?: string; replacementIds?: number[] };
    };
    if (y.kind === "event" && y.event) {
      events.push(y.event);
      step = gen.next();
    } else if (y.kind === "decision" && y.request?.kind === "chooseCrewSaddleCreatures") {
      step = gen.next({ kind: "chooseCrewSaddleCreatures", tapIds: [...tapIds] });
    } else if (y.kind === "decision" && y.request?.kind === "orderReplacements") {
      step = gen.next({ order: [...(y.request.replacementIds ?? [])] });
    } else if (y.kind === "decision" && y.request?.kind === "activateManaAbilities") {
      step = gen.next({ kind: "activateManaAbilities", done: true });
    } else {
      step = gen.next();
    }
  }
  return { events };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Flagship: Crew — Smuggler's Copter end-to-end", () => {
  const copterId = mkEntityId(34000);
  const bearsId = mkEntityId(34001);

  it("CrewKeywordHandler synthesizes a Battlefield-zone activated Crew ability", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    setupZones(game, seat);

    const copter = addCardToBattlefield(game, buildCopterPaper(), seat, copterId);
    copter.activateKeywordsFromDefinition(game);

    const crewSa = copter.spellAbilities.find((sa) => sa.tags.has("crew"));
    expect(crewSa).toBeDefined();
    expect(crewSa?.handlerKey).toBe("Crew");
    expect(crewSa?.activeInZones.has(ZoneType.Battlefield)).toBe(true);
    expect(crewSa?.activeInZones.has(ZoneType.Hand)).toBe(false);
    expect(crewSa?.ast.cost.raw).toBe(""); // Empty cost — taps happen inside the effect.
    expect(copter.keywords?.has("crew")).toBe(true);
  });

  it("crew Smuggler's Copter with a 2/2 Bear: Vehicle gains Creature type, Crewed fires", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    setupZones(game, seat);

    const copter = addCardToBattlefield(game, buildCopterPaper(), seat, copterId);
    const bears = addCardToBattlefield(game, buildBearsPaper(), seat, bearsId);
    copter.activateKeywordsFromDefinition(game);

    // Pre-state: Vehicle is artifact, NOT creature; Bear is untapped.
    const charsBefore = game.layerEngine.computeCharacteristics(copterId);
    expect(charsBefore.types.has(CardType.Artifact)).toBe(true);
    expect(charsBefore.types.has(CardType.Creature)).toBe(false);
    expect(bears.tapped).toBe(false);
    expect(copter.crewedUntilEot ?? false).toBe(false);

    // Activate Crew. Empty cost — pays nothing; pushes the activated SA.
    const crewIdx = copter.spellAbilities.findIndex((sa) => sa.tags.has("crew"));
    expect(crewIdx).toBeGreaterThanOrEqual(0);

    const { events: activateEvents } = driveGen(
      game.action.activateAbility(copterId, crewIdx, seat) as Generator<unknown, unknown, unknown>,
    );
    expect(activateEvents.map((e) => e.kind)).toContain("AbilityActivated");
    expect(game.sharedZones.stack.size).toBe(1);

    // Resolve — respond with [bears]. Bear's power is 2, exceeding Crew 1.
    const stackItem = game.sharedZones.stack.top();
    if (!stackItem) throw new Error("test: stack empty after crew activation");
    const { events: resolveEvents } = driveGen(
      resolveStackItem(game, stackItem) as Generator<unknown, unknown, unknown>,
      [bearsId],
    );

    // Crewed event fired with the right payload.
    const crewedEvents = resolveEvents.filter((e) => e.kind === "Crewed");
    expect(crewedEvents.length).toBe(1);
    const crewed = crewedEvents[0];
    if (!crewed || crewed.kind !== "Crewed") throw new Error("expected Crewed");
    expect(crewed.payload.vehicleId).toBe(copterId);
    expect([...crewed.payload.crewIds]).toEqual([bearsId]);

    // Bear is tapped; flag is set; Vehicle's effective types now include
    // Creature (and still include Artifact).
    expect(bears.tapped).toBe(true);
    expect(copter.crewedUntilEot).toBe(true);
    const charsAfter = game.layerEngine.computeCharacteristics(copterId);
    expect(charsAfter.types.has(CardType.Artifact)).toBe(true);
    expect(charsAfter.types.has(CardType.Creature)).toBe(true);

    // CrewedTrigger.matches smoke test — Wave 19 trigger wiring sees the
    // emitted event for this exact Vehicle.
    const fakeAst = {
      mode: "Crewed" as const,
      effect: { handlerKey: "Noop", params: {} },
      params: {},
    } as unknown as TriggerAst;
    const trigger = new CrewedTrigger().build(fakeAst, {
      game,
      sourceCardId: copterId,
      controllerSeat: seat,
      triggerId: mkEntityId(99001),
    });
    expect(trigger.matches(crewed)).toBe(true);
    const unrelated = mkEvent("Crewed", game.turn, game.phase, {
      vehicleId: mkEntityId(7777),
      crewIds: [bearsId],
    });
    expect(trigger.matches(unrelated)).toBe(false);

    expect(game.sharedZones.stack.size).toBe(0);
  });

  it("crew flag is cleared when the untilEndOfTurn ContinuousEffect expires", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    setupZones(game, seat);

    const copter = addCardToBattlefield(game, buildCopterPaper(), seat, copterId);
    addCardToBattlefield(game, buildBearsPaper(), seat, bearsId);
    copter.activateKeywordsFromDefinition(game);

    const crewIdx = copter.spellAbilities.findIndex((sa) => sa.tags.has("crew"));
    driveGen(game.action.activateAbility(copterId, crewIdx, seat) as Generator<unknown, unknown, unknown>);
    const stackItem = game.sharedZones.stack.top();
    if (!stackItem) throw new Error("test: stack empty");
    driveGen(resolveStackItem(game, stackItem) as Generator<unknown, unknown, unknown>, [bearsId]);

    // Crewed — flag set, ContinuousEffect registered.
    expect(copter.crewedUntilEot).toBe(true);
    const effects = game.continuousEffectRegistry.all() as readonly ContinuousEffect[];
    const crewEffect = effects.find((e) => e.sourceCardId === copterId);
    expect(crewEffect).toBeDefined();

    // Force expiry by directly unregistering — drives the cleanup hook
    // (mirrors what CleanupStep does on EOT). The ContinuousEffect's
    // cleanup hook must clear the flag.
    if (crewEffect) game.continuousEffectRegistry.unregister(crewEffect.id);
    expect(copter.crewedUntilEot).toBe(false);
    const charsAfter = game.layerEngine.computeCharacteristics(copterId);
    expect(charsAfter.types.has(CardType.Creature)).toBe(false);
  });

  it("crew fizzles when chosen creatures' total power < requiredPower", () => {
    // Build a Crew 3 vehicle (Heart of Kiran style); a single 2/2 Bear is
    // not enough → effect resolves with no taps, no flag, no event.
    const heartSrc = `${[
      "Name:Heart of Kiran",
      "ManaCost:2",
      "Types:Legendary Artifact Vehicle",
      "PT:4/4",
      "K:Crew:3",
      "Oracle:Crew 3.",
    ].join("\n")}\n`;
    const heartPaper: PaperCard = {
      name: "Heart of Kiran",
      edition: "AER",
      collectorNumber: "162",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: parseCard(heartSrc, "heart.txt"),
    };

    const game = makeGame();
    const seat = mkPlayerSeat(0);
    setupZones(game, seat);

    const heart = addCardToBattlefield(game, heartPaper, seat, mkEntityId(34100));
    const bear = addCardToBattlefield(game, buildBearsPaper(), seat, mkEntityId(34101));
    heart.activateKeywordsFromDefinition(game);

    const crewIdx = heart.spellAbilities.findIndex((sa) => sa.tags.has("crew"));
    driveGen(game.action.activateAbility(heart.id, crewIdx, seat) as Generator<unknown, unknown, unknown>);
    const stackItem = game.sharedZones.stack.top();
    if (!stackItem) throw new Error("test: stack empty");
    const { events } = driveGen(
      resolveStackItem(game, stackItem) as Generator<unknown, unknown, unknown>,
      [bear.id], // only 2 power; fails the 3-threshold
    );

    expect(events.some((e) => e.kind === "Crewed")).toBe(false);
    expect(bear.tapped).toBe(false);
    expect(heart.crewedUntilEot ?? false).toBe(false);
  });
});
