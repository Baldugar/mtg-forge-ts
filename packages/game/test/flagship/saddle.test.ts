// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 24 — Saddle flagship integration test ("Slick Sequence Mount" stand-in).
//
// Saddle (CR 702.165) — "Saddle N: Tap any number of untapped creatures you
// control with total power N or greater: This Mount becomes saddled until
// end of turn." Saddle parallels Crew: same tap-creatures-with-power-≥-N
// pattern, but Mounts are already creatures so saddling does NOT change the
// type set. Instead it sets `card.saddledUntilEot = true`, which downstream
// triggers (BecomesSaddled) and SVar conditions consume.
//
// This test pins:
//   - SaddleKeywordHandler synthesizes a Battlefield-zone activated Saddle
//     ability with empty cost.
//   - Activating with a 2/2 Bear satisfies Saddle 1: card.saddledUntilEot
//     flips to true, the Bear is tapped, Saddled event fires.
//   - SaddledTrigger.matches the emitted event for this exact Mount.
//   - The flag is cleared on EOT effect expiry; type set is unchanged
//     throughout (Mounts are creatures regardless of saddled state).
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
import { SaddledTrigger } from "../../src/trigger/handlers/wave-19-triggers.js";
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
  forgeSha: "saddle-test",
  cardDataSyncedAt: "2026-04-26T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "24",
};

// Outlaws of Thunder Junction Mount stand-in. Real Mounts have varying
// stats; this fixture is a 1/3 Mount with Saddle 2.
const mountSrc = `${[
  "Name:Saddle Test Mount",
  "ManaCost:2 W",
  "Types:Artifact Creature Mount",
  "PT:1/3",
  "K:Saddle:2",
  "Oracle:Saddle 2.",
].join("\n")}\n`;

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

function buildMountPaper(): PaperCard {
  return {
    name: "Saddle Test Mount",
    edition: "OTJ",
    collectorNumber: "1",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition: parseCard(mountSrc, "mount.txt"),
  };
}

function buildBearsPaper(): PaperCard {
  return {
    name: "Grizzly Bears",
    edition: "LEA",
    collectorNumber: "94",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition: parseCard(bearsSrc, "bears.txt"),
  };
}

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

describe("Flagship: Saddle — Mount end-to-end", () => {
  const mountId = mkEntityId(35000);
  const bearsId = mkEntityId(35001);

  it("SaddleKeywordHandler synthesizes a Battlefield-zone activated Saddle ability", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    setupZones(game, seat);

    const mount = addCardToBattlefield(game, buildMountPaper(), seat, mountId);
    mount.activateKeywordsFromDefinition(game);

    const saddleSa = mount.spellAbilities.find((sa) => sa.tags.has("saddle"));
    expect(saddleSa).toBeDefined();
    expect(saddleSa?.handlerKey).toBe("Saddle");
    expect(saddleSa?.activeInZones.has(ZoneType.Battlefield)).toBe(true);
    expect(saddleSa?.ast.cost.raw).toBe("");
    expect(mount.keywords?.has("saddle")).toBe(true);
  });

  it("saddle Mount with a 2/2 Bear (Saddle 2): flag flips, Saddled fires, types unchanged", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    setupZones(game, seat);

    const mount = addCardToBattlefield(game, buildMountPaper(), seat, mountId);
    const bears = addCardToBattlefield(game, buildBearsPaper(), seat, bearsId);
    mount.activateKeywordsFromDefinition(game);

    // Pre-state: Mount is already a creature (Mounts are printed as
    // Artifact Creature Mount); flag is unset; Bear is untapped.
    const charsBefore = game.layerEngine.computeCharacteristics(mountId);
    expect(charsBefore.types.has(CardType.Creature)).toBe(true);
    expect(charsBefore.types.has(CardType.Artifact)).toBe(true);
    expect(mount.saddledUntilEot ?? false).toBe(false);
    expect(bears.tapped).toBe(false);

    const saddleIdx = mount.spellAbilities.findIndex((sa) => sa.tags.has("saddle"));
    expect(saddleIdx).toBeGreaterThanOrEqual(0);

    const { events: activateEvents } = driveGen(
      game.action.activateAbility(mountId, saddleIdx, seat) as Generator<unknown, unknown, unknown>,
    );
    expect(activateEvents.map((e) => e.kind)).toContain("AbilityActivated");
    expect(game.sharedZones.stack.size).toBe(1);

    const stackItem = game.sharedZones.stack.top();
    if (!stackItem) throw new Error("test: stack empty after saddle activation");
    const { events: resolveEvents } = driveGen(
      resolveStackItem(game, stackItem) as Generator<unknown, unknown, unknown>,
      [bearsId],
    );

    // Saddled event fired with the right payload.
    const saddledEvents = resolveEvents.filter((e) => e.kind === "Saddled");
    expect(saddledEvents.length).toBe(1);
    const saddled = saddledEvents[0];
    if (!saddled || saddled.kind !== "Saddled") throw new Error("expected Saddled");
    expect(saddled.payload.mountId).toBe(mountId);
    expect([...saddled.payload.riderIds]).toEqual([bearsId]);

    // Bear tapped; flag set; types still Artifact + Creature (unchanged).
    expect(bears.tapped).toBe(true);
    expect(mount.saddledUntilEot).toBe(true);
    const charsAfter = game.layerEngine.computeCharacteristics(mountId);
    expect(charsAfter.types.has(CardType.Creature)).toBe(true);
    expect(charsAfter.types.has(CardType.Artifact)).toBe(true);

    // SaddledTrigger smoke test.
    const fakeAst = {
      mode: "Saddled" as const,
      effect: { handlerKey: "Noop", params: {} },
      params: {},
    } as unknown as TriggerAst;
    const trigger = new SaddledTrigger().build(fakeAst, {
      game,
      sourceCardId: mountId,
      controllerSeat: seat,
      triggerId: mkEntityId(99002),
    });
    expect(trigger.matches(saddled)).toBe(true);
    const unrelated = mkEvent("Saddled", game.turn, game.phase, {
      mountId: mkEntityId(8888),
      riderIds: [bearsId],
    });
    expect(trigger.matches(unrelated)).toBe(false);

    expect(game.sharedZones.stack.size).toBe(0);
  });

  it("saddle flag is cleared when the untilEndOfTurn ContinuousEffect expires", () => {
    const game = makeGame();
    const seat = mkPlayerSeat(0);
    setupZones(game, seat);

    const mount = addCardToBattlefield(game, buildMountPaper(), seat, mountId);
    addCardToBattlefield(game, buildBearsPaper(), seat, bearsId);
    mount.activateKeywordsFromDefinition(game);

    const saddleIdx = mount.spellAbilities.findIndex((sa) => sa.tags.has("saddle"));
    driveGen(game.action.activateAbility(mountId, saddleIdx, seat) as Generator<unknown, unknown, unknown>);
    const stackItem = game.sharedZones.stack.top();
    if (!stackItem) throw new Error("test: stack empty");
    driveGen(resolveStackItem(game, stackItem) as Generator<unknown, unknown, unknown>, [bearsId]);

    expect(mount.saddledUntilEot).toBe(true);
    const effects = game.continuousEffectRegistry.all() as readonly ContinuousEffect[];
    const saddleEffect = effects.find((e) => e.sourceCardId === mountId);
    expect(saddleEffect).toBeDefined();
    if (saddleEffect) game.continuousEffectRegistry.unregister(saddleEffect.id);
    expect(mount.saddledUntilEot).toBe(false);
  });

  it("saddle fizzles when chosen creatures' total power < requiredPower", () => {
    // Build a Saddle 4 mount; a single 2/2 Bear can't satisfy → no taps,
    // no flag, no event.
    const bigMountSrc = `${[
      "Name:Big Mount",
      "ManaCost:4 W",
      "Types:Artifact Creature Mount",
      "PT:4/4",
      "K:Saddle:4",
      "Oracle:Saddle 4.",
    ].join("\n")}\n`;
    const bigPaper: PaperCard = {
      name: "Big Mount",
      edition: "OTJ",
      collectorNumber: "2",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: parseCard(bigMountSrc, "big.txt"),
    };

    const game = makeGame();
    const seat = mkPlayerSeat(0);
    setupZones(game, seat);

    const big = addCardToBattlefield(game, bigPaper, seat, mkEntityId(35100));
    const bear = addCardToBattlefield(game, buildBearsPaper(), seat, mkEntityId(35101));
    big.activateKeywordsFromDefinition(game);

    const saddleIdx = big.spellAbilities.findIndex((sa) => sa.tags.has("saddle"));
    driveGen(game.action.activateAbility(big.id, saddleIdx, seat) as Generator<unknown, unknown, unknown>);
    const stackItem = game.sharedZones.stack.top();
    if (!stackItem) throw new Error("test: stack empty");
    const { events } = driveGen(resolveStackItem(game, stackItem) as Generator<unknown, unknown, unknown>, [
      bear.id,
    ]);

    expect(events.some((e) => e.kind === "Saddled")).toBe(false);
    expect(bear.tapped).toBe(false);
    expect(big.saddledUntilEot ?? false).toBe(false);
  });
});
