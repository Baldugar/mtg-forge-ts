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
    interface CtxSnapshot {
      castingPlayer: PlayerSeat;
      sourceCardId: EntityId;
      originZone: ZoneType;
      asSpecialAction: boolean;
      altCostUsed: string | null;
      additionalCostsPaid: string[];
      modesChosen: string[];
      faceChosen: CastContext["faceChosen"];
      xValue: number | undefined;
      alternativeZoneDestination: ZoneType | undefined;
    }
    class InspectingPipeline extends CastPipeline {
      captured: CtxSnapshot | undefined;
      // biome-ignore lint/correctness/useYield: inspection stub (no decision)
      protected override *stepPropose(ctx: CastContext): Generator<EngineYield, void, unknown> {
        // Snapshot values before later steps can mutate the shared ctx.
        this.captured = {
          castingPlayer: ctx.castingPlayer,
          sourceCardId: ctx.sourceCardId,
          originZone: ctx.originZone,
          asSpecialAction: ctx.asSpecialAction,
          altCostUsed: ctx.altCostUsed,
          additionalCostsPaid: [...ctx.additionalCostsPaid],
          modesChosen: [...ctx.modesChosen],
          faceChosen: ctx.faceChosen,
          xValue: ctx.xValue,
          alternativeZoneDestination: ctx.alternativeZoneDestination,
        };
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

describe("CastPipeline — Task 36 steps 1-4", () => {
  describe("stepPropose", () => {
    it("accepts a valid cast from Hand — no yield, pipeline completes", () => {
      const { game, seat0 } = makeGame();
      const cardId = mkEntityId(600);
      addCardToZone(game, seat0, ZoneType.Hand, cardId);
      const { yields, result } = drainGenerator(
        game.castPipeline.run({
          castingPlayer: seat0,
          sourceCardId: cardId,
          originZone: ZoneType.Hand,
          asSpecialAction: false,
        }),
      );
      expect(yields).toEqual([]);
      expect(result).not.toBeNull();
    });

    it("returns null when the card is not in Game.cards", () => {
      const { game, seat0 } = makeGame();
      // WHY: no addCardToZone — card ref missing from registry.
      const { result } = drainGenerator(
        game.castPipeline.run({
          castingPlayer: seat0,
          sourceCardId: mkEntityId(999),
          originZone: ZoneType.Hand,
          asSpecialAction: false,
        }),
      );
      expect(result).toBeNull();
    });

    it("returns null when the card is in a different zone than claimed", () => {
      const { game, seat0 } = makeGame();
      const cardId = mkEntityId(601);
      addCardToZone(game, seat0, ZoneType.Hand, cardId);
      const { result } = drainGenerator(
        game.castPipeline.run({
          castingPlayer: seat0,
          sourceCardId: cardId,
          // Claim graveyard though the card is in hand.
          originZone: ZoneType.Graveyard,
          asSpecialAction: false,
        }),
      );
      expect(result).toBeNull();
    });

    it("returns null when a player tries to cast from another's hand", () => {
      const { game, seat0, seat1 } = makeGame();
      const cardId = mkEntityId(602);
      addCardToZone(game, seat0, ZoneType.Hand, cardId);
      const { result } = drainGenerator(
        game.castPipeline.run({
          castingPlayer: seat1,
          sourceCardId: cardId,
          originZone: ZoneType.Hand,
          asSpecialAction: false,
        }),
      );
      expect(result).toBeNull();
    });

    it("gates Battlefield-origin casts on controllerSeat rather than ownerSeat", () => {
      const { game, seat0, seat1 } = makeGame();
      const cardId = mkEntityId(603);
      // Owned by seat0 but controlled by seat1 (e.g. Act of Treason).
      const card = new Card(cardId, samplePaper, seat0, seat1, ZoneType.Battlefield);
      game.cards.set(cardId, card);
      const bf = game.getPlayer(seat1).zones.get(ZoneType.Battlefield);
      if (!bf) throw new Error("test: missing battlefield");
      bf.add(cardId);
      // seat1 (controller) may cast; seat0 (owner) may not.
      const cast0 = drainGenerator(
        game.castPipeline.run({
          castingPlayer: seat0,
          sourceCardId: cardId,
          originZone: ZoneType.Battlefield,
          asSpecialAction: false,
        }),
      );
      expect(cast0.result).toBeNull();
      const cast1 = drainGenerator(
        game.castPipeline.run({
          castingPlayer: seat1,
          sourceCardId: cardId,
          originZone: ZoneType.Battlefield,
          asSpecialAction: false,
        }),
      );
      expect(cast1.result).not.toBeNull();
    });
  });

  describe("stepChooseFace", () => {
    it("auto-passes on a single-face card (no faces surface)", () => {
      const { game, seat0 } = makeGame();
      const cardId = mkEntityId(610);
      addCardToZone(game, seat0, ZoneType.Hand, cardId);
      const { yields, result } = drainGenerator(
        game.castPipeline.run({
          castingPlayer: seat0,
          sourceCardId: cardId,
          originZone: ZoneType.Hand,
          asSpecialAction: false,
        }),
      );
      expect(yields).toEqual([]);
      expect(result).not.toBeNull();
      expect((result as StackItem).provenance.faceChosen).toBeUndefined();
    });

    it("yields chooseFace on a multi-face card and writes the chosen face into provenance", () => {
      const { game, seat0 } = makeGame();
      const paper: PaperCard & { faces: readonly string[] } = {
        ...samplePaper,
        name: "Fire // Ice",
        faces: ["L", "R"] as const,
      };
      const cardId = mkEntityId(611);
      const card = new Card(cardId, paper, seat0, seat0, ZoneType.Hand);
      game.cards.set(cardId, card);
      const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
      if (!hand) throw new Error("test: missing hand");
      hand.add(cardId);

      const gen = game.castPipeline.run({
        castingPlayer: seat0,
        sourceCardId: cardId,
        originZone: ZoneType.Hand,
        asSpecialAction: false,
      });
      const first = gen.next();
      expect(first.done).toBe(false);
      const y = first.value as EngineYield;
      expect(y.kind).toBe("decision");
      if (y.kind === "decision") {
        expect(y.request.kind).toBe("chooseFace");
        if (y.request.kind === "chooseFace") {
          expect(y.request.options).toEqual(["L", "R"]);
          expect(y.request.cardId).toBe(cardId);
          expect(y.request.playerSeat).toBe(seat0);
        }
      }
      const finished = gen.next({ kind: "chooseFace", face: "L" });
      expect(finished.done).toBe(true);
      const item = finished.value as StackItem;
      expect(item.provenance.faceChosen).toBe("L");
    });

    it("returns null when the chosen face is not in the offered options", () => {
      const { game, seat0 } = makeGame();
      const paper: PaperCard & { faces: readonly string[] } = {
        ...samplePaper,
        name: "Delver of Secrets",
        faces: ["front", "back"] as const,
      };
      const cardId = mkEntityId(612);
      const card = new Card(cardId, paper, seat0, seat0, ZoneType.Hand);
      game.cards.set(cardId, card);
      const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
      if (!hand) throw new Error("test: missing hand");
      hand.add(cardId);

      const gen = game.castPipeline.run({
        castingPlayer: seat0,
        sourceCardId: cardId,
        originZone: ZoneType.Hand,
        asSpecialAction: false,
      });
      gen.next();
      const finished = gen.next({ kind: "chooseFace", face: "bogus" });
      expect(finished.done).toBe(true);
      expect(finished.value).toBeNull();
    });
  });

  describe("stepChooseZoneOverride", () => {
    it("Hand origin — no alternative zone destination", () => {
      const { game, seat0 } = makeGame();
      const cardId = mkEntityId(620);
      addCardToZone(game, seat0, ZoneType.Hand, cardId);
      const { result } = drainGenerator(
        game.castPipeline.run({
          castingPlayer: seat0,
          sourceCardId: cardId,
          originZone: ZoneType.Hand,
          asSpecialAction: false,
        }),
      );
      expect((result as StackItem).provenance.alternativeZoneDestination).toBeUndefined();
    });

    it("Graveyard origin — alternativeZoneDestination = Exile (flashback-family)", () => {
      const { game, seat0 } = makeGame();
      const cardId = mkEntityId(621);
      addCardToZone(game, seat0, ZoneType.Graveyard, cardId);
      const { result } = drainGenerator(
        game.castPipeline.run({
          castingPlayer: seat0,
          sourceCardId: cardId,
          originZone: ZoneType.Graveyard,
          asSpecialAction: false,
        }),
      );
      expect((result as StackItem).provenance.alternativeZoneDestination).toBe(ZoneType.Exile);
    });

    it("Exile origin — alternativeZoneDestination = Exile (cascade/impulse/foretell)", () => {
      const { game, seat0 } = makeGame();
      const cardId = mkEntityId(622);
      // Exile is a shared zone, but addCardToZone only handles per-player
      // zones. Add directly to the shared exile + cards registry.
      const card = new Card(cardId, samplePaper, seat0, seat0, ZoneType.Exile);
      game.cards.set(cardId, card);
      game.sharedZones.exile.add(cardId);
      const { result } = drainGenerator(
        game.castPipeline.run({
          castingPlayer: seat0,
          sourceCardId: cardId,
          originZone: ZoneType.Exile,
          asSpecialAction: false,
        }),
      );
      expect((result as StackItem).provenance.alternativeZoneDestination).toBe(ZoneType.Exile);
    });
  });

  describe("stepChooseAltCosts", () => {
    it("auto-passes when the paper card has no optional costs", () => {
      const { game, seat0 } = makeGame();
      const cardId = mkEntityId(630);
      addCardToZone(game, seat0, ZoneType.Hand, cardId);
      const { yields, result } = drainGenerator(
        game.castPipeline.run({
          castingPlayer: seat0,
          sourceCardId: cardId,
          originZone: ZoneType.Hand,
          asSpecialAction: false,
        }),
      );
      expect(yields).toEqual([]);
      expect((result as StackItem).provenance.additionalCostsPaid).toEqual([]);
    });

    it("yields chooseOptionalCosts and stores the chosen ids in provenance", () => {
      const { game, seat0 } = makeGame();
      const paper: PaperCard & {
        optionalCosts: readonly { readonly id: string; readonly description: string }[];
      } = {
        ...samplePaper,
        name: "Fiery Temper",
        optionalCosts: [
          { id: "madness", description: "Madness {R}" },
          { id: "kicker", description: "Kicker {2}" },
        ] as const,
      };
      const cardId = mkEntityId(631);
      const card = new Card(cardId, paper, seat0, seat0, ZoneType.Hand);
      game.cards.set(cardId, card);
      const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
      if (!hand) throw new Error("test: missing hand");
      hand.add(cardId);

      const gen = game.castPipeline.run({
        castingPlayer: seat0,
        sourceCardId: cardId,
        originZone: ZoneType.Hand,
        asSpecialAction: false,
      });
      const first = gen.next();
      expect(first.done).toBe(false);
      const y = first.value as EngineYield;
      expect(y.kind).toBe("decision");
      if (y.kind === "decision" && y.request.kind === "chooseOptionalCosts") {
        expect(y.request.options.map((o) => o.id)).toEqual(["madness", "kicker"]);
      }
      const finished = gen.next({ kind: "chooseOptionalCosts", chosenIds: ["madness"] });
      expect(finished.done).toBe(true);
      const item = finished.value as StackItem;
      expect(item.provenance.additionalCostsPaid).toEqual(["madness"]);
    });

    it("returns null when a chosen cost id is not in the offered set", () => {
      const { game, seat0 } = makeGame();
      const paper: PaperCard & {
        optionalCosts: readonly { readonly id: string; readonly description: string }[];
      } = {
        ...samplePaper,
        name: "Fiery Temper",
        optionalCosts: [{ id: "madness", description: "Madness {R}" }] as const,
      };
      const cardId = mkEntityId(632);
      const card = new Card(cardId, paper, seat0, seat0, ZoneType.Hand);
      game.cards.set(cardId, card);
      const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
      if (!hand) throw new Error("test: missing hand");
      hand.add(cardId);

      const gen = game.castPipeline.run({
        castingPlayer: seat0,
        sourceCardId: cardId,
        originZone: ZoneType.Hand,
        asSpecialAction: false,
      });
      gen.next();
      const finished = gen.next({ kind: "chooseOptionalCosts", chosenIds: ["bogus"] });
      expect(finished.done).toBe(true);
      expect(finished.value).toBeNull();
    });
  });
});
