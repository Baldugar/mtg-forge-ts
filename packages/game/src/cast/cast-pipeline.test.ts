// SPDX-License-Identifier: GPL-3.0-or-later
import type { DecisionRequest, EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../action/engine-yield.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { StackItem } from "../stack/stack-item.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import type { CastContext } from "./cast-context.js";
import { CastPipeline, type CastProposal } from "./cast-pipeline.js";

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

const samplePaper: PaperCard = {
  name: "Lightning Bolt",
  edition: "LEA",
  collectorNumber: "161",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

interface Fixture {
  game: Game;
  seat0: PlayerSeat;
  seat1: PlayerSeat;
}

const makeGame = (): Fixture => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(1n),
  });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return { game, seat0: mkPlayerSeat(0), seat1: mkPlayerSeat(1) };
};

const addCardToZone = (game: Game, seat: PlayerSeat, zone: ZoneType, id: EntityId): Card => {
  const card = new Card(id, samplePaper, seat, seat, zone);
  game.cards.set(id, card);
  const z = game.getPlayer(seat).zones.get(zone);
  if (!z) throw new Error("test: missing zone");
  z.add(id);
  return card;
};

const drainGenerator = <Y, R>(gen: Generator<Y, R, unknown>): { yields: Y[]; result: R } => {
  const yields: Y[] = [];
  let step = gen.next();
  while (!step.done) {
    yields.push(step.value);
    step = gen.next();
  }
  return { yields, result: step.value };
};

describe("CastPipeline — Task 35 skeleton", () => {
  it("wires onto Game.castPipeline after sbaEngine", () => {
    const { game } = makeGame();
    expect(game.castPipeline).toBeInstanceOf(CastPipeline);
  });

  it("run() on a no-op proposal completes without yielding and returns a StackItem", () => {
    const { game, seat0 } = makeGame();
    const cardId = mkEntityId(100);
    addCardToZone(game, seat0, ZoneType.Hand, cardId);
    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: cardId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const { yields, result } = drainGenerator(game.castPipeline.run(proposal));
    expect(yields).toEqual([]);
    expect(result).not.toBeNull();
    const item = result as StackItem;
    expect(item.sourceCardId).toBe(cardId);
    expect(item.controllerSeat).toBe(seat0);
    expect(item.kind).toBe("spell");
    expect(item.isCast).toBe(true);
  });

  it("finalizeStackItem mints a fresh EntityId via game.newEntityId()", () => {
    const { game, seat0 } = makeGame();
    const cardId = mkEntityId(200);
    addCardToZone(game, seat0, ZoneType.Hand, cardId);
    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: cardId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    // Take one id to bump the counter; item should land past that value.
    const baseline = game.newEntityId();
    const { result } = drainGenerator(game.castPipeline.run(proposal));
    const item = result as StackItem;
    expect(item.id).not.toBe(cardId);
    expect(item.id).not.toBe(baseline);
    // Subsequent newEntityId() must be monotonically after the minted item id.
    const next = game.newEntityId();
    expect(next).not.toBe(item.id);
  });

  it("propagates yields from a subclass step", () => {
    class YieldingPipeline extends CastPipeline {
      protected override *stepChooseModes(_ctx: CastContext): Generator<EngineYield, void, unknown> {
        const req: DecisionRequest = {
          kind: "chooseModes",
          sourceId: mkEntityId(999),
          modes: [{ id: "m1", description: "Mode 1" }],
          min: 1,
          max: 1,
        };
        const resp = (yield { kind: "decision", request: req }) as {
          readonly kind: "chooseModes";
          readonly modeIds: readonly string[];
        };
        expect(resp.modeIds).toEqual(["m1"]);
      }
    }
    const { game, seat0 } = makeGame();
    const pipeline = new YieldingPipeline(game);
    const cardId = mkEntityId(300);
    addCardToZone(game, seat0, ZoneType.Hand, cardId);
    const proposal: CastProposal = {
      castingPlayer: seat0,
      sourceCardId: cardId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    };
    const gen = pipeline.run(proposal);
    const first = gen.next();
    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({ kind: "decision" });
    // Supply the response; pipeline should complete.
    const finished = gen.next({ kind: "chooseModes", modeIds: ["m1"] });
    expect(finished.done).toBe(true);
    expect(finished.value).not.toBeNull();
  });

  it("catches a throwing step and returns null (abort path)", () => {
    class ThrowingPipeline extends CastPipeline {
      // biome-ignore lint/correctness/useYield: error branch before any yield
      protected override *stepPropose(_ctx: CastContext): Generator<EngineYield, void, unknown> {
        throw new Error("test-abort");
      }
    }
    const { game, seat0 } = makeGame();
    const pipeline = new ThrowingPipeline(game);
    const cardId = mkEntityId(400);
    addCardToZone(game, seat0, ZoneType.Hand, cardId);
    const { yields, result } = drainGenerator(
      pipeline.run({
        castingPlayer: seat0,
        sourceCardId: cardId,
        originZone: ZoneType.Hand,
        asSpecialAction: false,
      }),
    );
    expect(yields).toEqual([]);
    expect(result).toBeNull();
  });

  it("context carries the proposal fields verbatim", () => {
    class InspectingPipeline extends CastPipeline {
      captured: CastContext | undefined;
      // biome-ignore lint/correctness/useYield: inspection stub (no decision)
      protected override *stepPropose(ctx: CastContext): Generator<EngineYield, void, unknown> {
        this.captured = ctx;
      }
    }
    const { game, seat1 } = makeGame();
    const pipeline = new InspectingPipeline(game);
    const cardId = mkEntityId(500);
    addCardToZone(game, seat1, ZoneType.Graveyard, cardId);
    drainGenerator(
      pipeline.run({
        castingPlayer: seat1,
        sourceCardId: cardId,
        originZone: ZoneType.Graveyard,
        asSpecialAction: true,
      }),
    );
    expect(pipeline.captured).toBeDefined();
    expect(pipeline.captured?.castingPlayer).toBe(seat1);
    expect(pipeline.captured?.sourceCardId).toBe(cardId);
    expect(pipeline.captured?.originZone).toBe(ZoneType.Graveyard);
    expect(pipeline.captured?.asSpecialAction).toBe(true);
    // Default initialized fields.
    expect(pipeline.captured?.altCostUsed).toBeNull();
    expect(pipeline.captured?.additionalCostsPaid).toEqual([]);
    expect(pipeline.captured?.modesChosen).toEqual([]);
    expect(pipeline.captured?.faceChosen).toBeUndefined();
    expect(pipeline.captured?.xValue).toBeUndefined();
    expect(pipeline.captured?.alternativeZoneDestination).toBeUndefined();
  });
});
