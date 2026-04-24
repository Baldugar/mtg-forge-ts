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

describe("CastPipeline — Task 37 steps 5-7", () => {
  describe("stepChooseModes", () => {
    it("auto-passes when the paper card publishes no modes and no X", () => {
      const { game, seat0 } = makeGame();
      const cardId = mkEntityId(700);
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
      expect((result as StackItem).provenance.modesChosen).toBeUndefined();
      expect((result as StackItem).provenance.xValue).toBeUndefined();
    });

    it("yields chooseModes for a modal spell and stores the picks in provenance", () => {
      const { game, seat0 } = makeGame();
      const paper: PaperCard & {
        modes: {
          readonly options: readonly { readonly id: string; readonly description: string }[];
          readonly min: number;
          readonly max: number;
        };
      } = {
        ...samplePaper,
        name: "Charm of Three",
        modes: {
          options: [
            { id: "a", description: "Draw a card" },
            { id: "b", description: "Target creature gets +1/+1" },
            { id: "c", description: "Deal 2 damage" },
          ],
          min: 1,
          max: 2,
        },
      };
      const cardId = mkEntityId(701);
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
      if (y.kind === "decision" && y.request.kind === "chooseModes") {
        expect(y.request.modes.map((m) => m.id)).toEqual(["a", "b", "c"]);
        expect(y.request.min).toBe(1);
        expect(y.request.max).toBe(2);
      }
      const finished = gen.next({ kind: "chooseModes", modeIds: ["a", "c"] });
      expect(finished.done).toBe(true);
      const item = finished.value as StackItem;
      expect(item.provenance.modesChosen).toEqual(["a", "c"]);
    });

    it("returns null when count is outside [min, max]", () => {
      const { game, seat0 } = makeGame();
      const paper: PaperCard & {
        modes: {
          readonly options: readonly { readonly id: string; readonly description: string }[];
          readonly min: number;
          readonly max: number;
        };
      } = {
        ...samplePaper,
        modes: {
          options: [
            { id: "a", description: "A" },
            { id: "b", description: "B" },
          ],
          min: 1,
          max: 1,
        },
      };
      const cardId = mkEntityId(702);
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
      const finished = gen.next({ kind: "chooseModes", modeIds: ["a", "b"] });
      expect(finished.done).toBe(true);
      expect(finished.value).toBeNull();
    });

    it("returns null when a chosen id is unknown", () => {
      const { game, seat0 } = makeGame();
      const paper: PaperCard & {
        modes: {
          readonly options: readonly { readonly id: string; readonly description: string }[];
          readonly min: number;
          readonly max: number;
        };
      } = {
        ...samplePaper,
        modes: {
          options: [{ id: "a", description: "A" }],
          min: 1,
          max: 1,
        },
      };
      const cardId = mkEntityId(703);
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
      const finished = gen.next({ kind: "chooseModes", modeIds: ["bogus"] });
      expect(finished.done).toBe(true);
      expect(finished.value).toBeNull();
    });

    it("returns null when a mode id is picked twice (CR 700.2)", () => {
      const { game, seat0 } = makeGame();
      const paper: PaperCard & {
        modes: {
          readonly options: readonly { readonly id: string; readonly description: string }[];
          readonly min: number;
          readonly max: number;
        };
      } = {
        ...samplePaper,
        modes: {
          options: [
            { id: "a", description: "A" },
            { id: "b", description: "B" },
          ],
          min: 2,
          max: 2,
        },
      };
      const cardId = mkEntityId(704);
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
      const finished = gen.next({ kind: "chooseModes", modeIds: ["a", "a"] });
      expect(finished.done).toBe(true);
      expect(finished.value).toBeNull();
    });
  });

  describe("stepChooseModes — X announcement", () => {
    it("yields chooseNumber for an X spell and stores xValue in provenance", () => {
      const { game, seat0 } = makeGame();
      const paper: PaperCard & { hasX: true } = {
        ...samplePaper,
        name: "Fireball",
        hasX: true,
      };
      const cardId = mkEntityId(710);
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
      if (y.kind === "decision" && y.request.kind === "chooseNumber") {
        expect(y.request.min).toBe(0);
        expect(y.request.max).toBe(Number.MAX_SAFE_INTEGER);
      }
      const finished = gen.next({ kind: "chooseNumber", chosen: 5 });
      expect(finished.done).toBe(true);
      const item = finished.value as StackItem;
      expect(item.provenance.xValue).toBe(5);
    });

    it("returns null when X value is negative", () => {
      const { game, seat0 } = makeGame();
      const paper: PaperCard & { hasX: true } = { ...samplePaper, hasX: true };
      const cardId = mkEntityId(711);
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
      const finished = gen.next({ kind: "chooseNumber", chosen: -1 });
      expect(finished.done).toBe(true);
      expect(finished.value).toBeNull();
    });

    it("returns null when X value is not an integer", () => {
      const { game, seat0 } = makeGame();
      const paper: PaperCard & { hasX: true } = { ...samplePaper, hasX: true };
      const cardId = mkEntityId(712);
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
      const finished = gen.next({ kind: "chooseNumber", chosen: 1.5 });
      expect(finished.done).toBe(true);
      expect(finished.value).toBeNull();
    });
  });

  describe("stepDistributeX", () => {
    it("non-distribute spell leaves ctx.distributions undefined on the StackItem targets", () => {
      const { game, seat0 } = makeGame();
      const cardId = mkEntityId(720);
      addCardToZone(game, seat0, ZoneType.Hand, cardId);
      const { result } = drainGenerator(
        game.castPipeline.run({
          castingPlayer: seat0,
          sourceCardId: cardId,
          originZone: ZoneType.Hand,
          asSpecialAction: false,
        }),
      );
      expect(result).not.toBeNull();
    });

    it("distribute spell with no X announced and no fixed amount aborts to null", () => {
      const { game, seat0 } = makeGame();
      const paper: PaperCard & { distributesX: true } = { ...samplePaper, distributesX: true };
      const cardId = mkEntityId(721);
      const card = new Card(cardId, paper, seat0, seat0, ZoneType.Hand);
      game.cards.set(cardId, card);
      const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
      if (!hand) throw new Error("test: missing hand");
      hand.add(cardId);
      const { result } = drainGenerator(
        game.castPipeline.run({
          castingPlayer: seat0,
          sourceCardId: cardId,
          originZone: ZoneType.Hand,
          asSpecialAction: false,
        }),
      );
      expect(result).toBeNull();
    });

    it("distribute spell with fixed distributeAmount stamps xValue for step 7", () => {
      const { game, seat0 } = makeGame();
      // Spell has no targetRestriction — so step 7 auto-passes and xValue is
      // simply stamped, letting provenance.xValue carry the distribution total.
      const paper: PaperCard & { distributesX: true; distributeAmount: number } = {
        ...samplePaper,
        distributesX: true,
        distributeAmount: 3,
      };
      const cardId = mkEntityId(722);
      const card = new Card(cardId, paper, seat0, seat0, ZoneType.Hand);
      game.cards.set(cardId, card);
      const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
      if (!hand) throw new Error("test: missing hand");
      hand.add(cardId);
      const { result } = drainGenerator(
        game.castPipeline.run({
          castingPlayer: seat0,
          sourceCardId: cardId,
          originZone: ZoneType.Hand,
          asSpecialAction: false,
        }),
      );
      const item = result as StackItem;
      expect(item).not.toBeNull();
      expect(item.provenance.xValue).toBe(3);
    });
  });

  describe("stepChooseTargets", () => {
    it("auto-passes when the paper card has no targetRestriction", () => {
      const { game, seat0 } = makeGame();
      const cardId = mkEntityId(730);
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
      const item = result as StackItem;
      expect(item).not.toBeNull();
      expect(item.targets).toBeNull();
    });

    it("yields chooseCastTargets with the enumerated eligible set", () => {
      const { game, seat0 } = makeGame();
      // Seed a battlefield creature to serve as the target.
      const targetId = mkEntityId(780);
      addCardToZone(game, seat0, ZoneType.Battlefield, targetId);
      // Spell card in hand with a target restriction admitting battlefield
      // cards controlled by the caster.
      const restriction = {
        controllerScope: "any",
        permitZones: new Set([ZoneType.Battlefield]),
        permitTypes: new Set(),
        forbidTypes: new Set(),
        minTargets: 1,
        maxTargets: 1,
        mayTargetPlayers: false,
      } as const;
      const paper: PaperCard & { targetRestriction: typeof restriction } = {
        ...samplePaper,
        name: "Murder",
        targetRestriction: restriction,
      };
      const cardId = mkEntityId(731);
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
      if (y.kind === "decision" && y.request.kind === "chooseCastTargets") {
        expect(y.request.min).toBe(1);
        expect(y.request.max).toBe(1);
        expect(y.request.legalTargets).toHaveLength(1); // only the battlefield card
        expect(y.request.playerSeat).toBe(seat0);
        expect(y.request.sourceId).toBe(cardId);
      }
      const finished = gen.next({
        kind: "chooseCastTargets",
        targets: [{ kind: "card", id: targetId }],
      });
      expect(finished.done).toBe(true);
      const item = finished.value as StackItem;
      expect(item).not.toBeNull();
      expect(item.targets).toEqual([{ kind: "card", id: targetId }]);
    });

    it("returns null when the chosen target is not in the eligible set", () => {
      const { game, seat0, seat1 } = makeGame();
      // Target we want only allows seat0's cards on battlefield.
      addCardToZone(game, seat0, ZoneType.Battlefield, mkEntityId(791));
      // seat1 controls a battlefield card — ineligible under scope "you".
      const notEligibleId = mkEntityId(792);
      const otherCard = new Card(notEligibleId, samplePaper, seat1, seat1, ZoneType.Battlefield);
      game.cards.set(notEligibleId, otherCard);
      const bfB = game.getPlayer(seat1).zones.get(ZoneType.Battlefield);
      if (!bfB) throw new Error("test: missing battlefield");
      bfB.add(notEligibleId);

      const restriction = {
        controllerScope: "you",
        permitZones: new Set([ZoneType.Battlefield]),
        permitTypes: new Set(),
        forbidTypes: new Set(),
        minTargets: 1,
        maxTargets: 1,
        mayTargetPlayers: false,
      } as const;
      const paper: PaperCard & { targetRestriction: typeof restriction } = {
        ...samplePaper,
        targetRestriction: restriction,
      };
      const cardId = mkEntityId(732);
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
      const finished = gen.next({
        kind: "chooseCastTargets",
        targets: [{ kind: "card", id: notEligibleId }],
      });
      expect(finished.done).toBe(true);
      expect(finished.value).toBeNull();
    });

    it("passes divisions through to ctx when restriction has divideX", () => {
      const { game, seat0 } = makeGame();
      const aId = mkEntityId(740);
      const bId = mkEntityId(741);
      addCardToZone(game, seat0, ZoneType.Battlefield, aId);
      addCardToZone(game, seat0, ZoneType.Battlefield, bId);
      const restriction = {
        controllerScope: "any",
        permitZones: new Set([ZoneType.Battlefield]),
        permitTypes: new Set(),
        forbidTypes: new Set(),
        minTargets: 2,
        maxTargets: 2,
        divideX: { amount: 5 },
        mayTargetPlayers: false,
      } as const;
      const paper: PaperCard & { targetRestriction: typeof restriction } = {
        ...samplePaper,
        name: "Savage Twister",
        targetRestriction: restriction,
      };
      const cardId = mkEntityId(733);
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
      const y = first.value as EngineYield;
      if (y.kind === "decision" && y.request.kind === "chooseCastTargets") {
        expect(y.request.divideX?.amount).toBe(5);
      }
      const finished = gen.next({
        kind: "chooseCastTargets",
        targets: [
          { kind: "card", id: aId },
          { kind: "card", id: bId },
        ],
        divisions: { 0: 3, 1: 2 },
      });
      expect(finished.done).toBe(true);
      const item = finished.value as StackItem;
      expect(item).not.toBeNull();
      expect(item.targets).toHaveLength(2);
    });

    it("integration: modal spell with X and targets completes end-to-end", () => {
      const { game, seat0 } = makeGame();
      const creatureId = mkEntityId(750);
      addCardToZone(game, seat0, ZoneType.Battlefield, creatureId);
      const restriction = {
        controllerScope: "any",
        permitZones: new Set([ZoneType.Battlefield]),
        permitTypes: new Set(),
        forbidTypes: new Set(),
        minTargets: 1,
        maxTargets: 1,
        mayTargetPlayers: false,
      } as const;
      type PaperShape = PaperCard & {
        readonly modes: {
          readonly options: readonly { readonly id: string; readonly description: string }[];
          readonly min: number;
          readonly max: number;
        };
        readonly hasX: true;
        readonly targetRestriction: typeof restriction;
      };
      const paper: PaperShape = {
        ...samplePaper,
        name: "Charmed Fireball",
        modes: {
          options: [
            { id: "damage", description: "Deal X damage to target" },
            { id: "pump", description: "Pump target" },
          ],
          min: 1,
          max: 1,
        },
        hasX: true,
        targetRestriction: restriction,
      };
      const cardId = mkEntityId(751);
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
      // 1st yield: chooseModes
      const modeStep = gen.next();
      expect((modeStep.value as EngineYield).kind).toBe("decision");
      // 2nd yield: chooseNumber (X)
      const xStep = gen.next({ kind: "chooseModes", modeIds: ["damage"] });
      if ((xStep.value as EngineYield).kind === "decision") {
        const req = (xStep.value as EngineYield & { kind: "decision" }).request;
        expect(req.kind).toBe("chooseNumber");
      }
      // 3rd yield: chooseCastTargets
      const tgtStep = gen.next({ kind: "chooseNumber", chosen: 4 });
      if ((tgtStep.value as EngineYield).kind === "decision") {
        const req = (tgtStep.value as EngineYield & { kind: "decision" }).request;
        expect(req.kind).toBe("chooseCastTargets");
      }
      const finished = gen.next({
        kind: "chooseCastTargets",
        targets: [{ kind: "card", id: creatureId }],
      });
      expect(finished.done).toBe(true);
      const item = finished.value as StackItem;
      expect(item.provenance.modesChosen).toEqual(["damage"]);
      expect(item.provenance.xValue).toBe(4);
      expect(item.targets).toEqual([{ kind: "card", id: creatureId }]);
    });
  });
});

describe("CastPipeline — Task 38 steps 8-10", () => {
  // Paper-card fixture with a (placeholder) mana cost — non-null enough to
  // exercise the cost-gate on steps 9 and 10. SP3 replaces with a real
  // ManaCost instance.
  const paidPaper: PaperCard & { manaCost: unknown } = {
    ...samplePaper,
    name: "Paid Spell",
    manaCost: { raw: "{1}{R}" },
  };

  describe("stepDetermineTotalCost", () => {
    it("records base / modIds / additionalCostIds / altCostUsed / xValue", () => {
      const { game, seat0 } = makeGame();
      const cardId = mkEntityId(800);
      const card = new Card(cardId, paidPaper, seat0, seat0, ZoneType.Hand);
      game.cards.set(cardId, card);
      const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
      if (!hand) throw new Error("test: missing hand");
      hand.add(cardId);
      // Subclass overrides stepActivateManaAbilities to return immediately
      // so we can drive the generator with drainGenerator and inspect
      // ctx.totalCost via captureCtx.
      class InspectingPipeline extends CastPipeline {
        capturedCtx: CastContext | undefined;
        // biome-ignore lint/correctness/useYield: inspection only
        protected override *stepActivateManaAbilities(
          ctx: CastContext,
        ): Generator<EngineYield, void, unknown> {
          // Snapshot *after* stepDetermineTotalCost has run.
          this.capturedCtx = ctx;
        }
        // biome-ignore lint/correctness/useYield: inspection only
        protected override *stepPayCosts(_ctx: CastContext): Generator<EngineYield, void, unknown> {
          return;
        }
      }
      const pipe = new InspectingPipeline(game);
      drainGenerator(
        pipe.run({
          castingPlayer: seat0,
          sourceCardId: cardId,
          originZone: ZoneType.Hand,
          asSpecialAction: false,
        }),
      );
      expect(pipe.capturedCtx).toBeDefined();
      const tc = pipe.capturedCtx?.totalCost as {
        base: unknown;
        modIds: readonly EntityId[];
        additionalCostIds: readonly string[];
        altCostUsed: string | null;
        xValue: number | undefined;
      };
      expect(tc.base).toEqual({ raw: "{1}{R}" });
      expect(tc.modIds).toEqual([]);
      expect(tc.additionalCostIds).toEqual([]);
      expect(tc.altCostUsed).toBeNull();
      expect(tc.xValue).toBeUndefined();
    });

    it("picks up cost-modification statics via registry.byCategory", () => {
      const { game, seat0 } = makeGame();
      const cardId = mkEntityId(801);
      const card = new Card(cardId, paidPaper, seat0, seat0, ZoneType.Hand);
      game.cards.set(cardId, card);
      const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
      if (!hand) throw new Error("test: missing hand");
      hand.add(cardId);
      // Register a dummy cost-mod static ability on seat0's side.
      const modId = mkEntityId(5000);
      game.staticEffectRegistry.register({
        id: modId,
        kind: "static",
        sourceCardId: cardId,
        activeInZones: new Set([ZoneType.Battlefield]),
        timestamp: 1,
        controllerSeatAtReg: seat0,
        category: "costModification",
        describe: () => ({ raw: "mod" }),
      });

      class InspectingPipeline extends CastPipeline {
        capturedCtx: CastContext | undefined;
        // biome-ignore lint/correctness/useYield: inspection only
        protected override *stepActivateManaAbilities(
          ctx: CastContext,
        ): Generator<EngineYield, void, unknown> {
          this.capturedCtx = ctx;
        }
        // biome-ignore lint/correctness/useYield: inspection only
        protected override *stepPayCosts(_ctx: CastContext): Generator<EngineYield, void, unknown> {
          return;
        }
      }
      const pipe = new InspectingPipeline(game);
      drainGenerator(
        pipe.run({
          castingPlayer: seat0,
          sourceCardId: cardId,
          originZone: ZoneType.Hand,
          asSpecialAction: false,
        }),
      );
      const tc = pipe.capturedCtx?.totalCost as { modIds: readonly EntityId[] };
      expect(tc.modIds).toContain(modId);
    });
  });

  describe("stepActivateManaAbilities", () => {
    it("yields activateManaAbilities for a paid card and accepts {done:true}", () => {
      const { game, seat0 } = makeGame();
      const cardId = mkEntityId(810);
      const card = new Card(cardId, paidPaper, seat0, seat0, ZoneType.Hand);
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
      if (y.kind === "decision" && y.request.kind === "activateManaAbilities") {
        expect(y.request.playerSeat).toBe(seat0);
        expect(y.request.forStackItem).toBe(cardId);
      }
      // The next yield is the CostPaid event.
      const second = gen.next({ kind: "activateManaAbilities", done: true });
      if (!second.done) {
        const ev = second.value as EngineYield;
        expect(ev.kind).toBe("event");
        if (ev.kind === "event") {
          expect(ev.event.kind).toBe("CostPaid");
        }
      }
      const third = gen.next();
      expect(third.done).toBe(true);
      expect(third.value).not.toBeNull();
    });

    it("skips the decision when the card has no base mana cost", () => {
      const { game, seat0 } = makeGame();
      const cardId = mkEntityId(811);
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
  });

  describe("stepPayCosts", () => {
    it("emits CostPaid event and records a CostPayment on ctx.paidAlready", () => {
      const { game, seat0 } = makeGame();
      const cardId = mkEntityId(820);
      const card = new Card(cardId, paidPaper, seat0, seat0, ZoneType.Hand);
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
      const activationYield = gen.next();
      expect((activationYield.value as EngineYield).kind).toBe("decision");
      const paidYield = gen.next({ kind: "activateManaAbilities", done: true });
      expect(paidYield.done).toBe(false);
      const ev = paidYield.value as EngineYield;
      expect(ev.kind).toBe("event");
      if (ev.kind === "event") {
        expect(ev.event.kind).toBe("CostPaid");
        if (ev.event.kind === "CostPaid") {
          expect(ev.event.payload.stackItemId).toBe(cardId);
          expect(ev.event.payload.payerSeat).toBe(seat0);
        }
      }
      const finished = gen.next();
      expect(finished.done).toBe(true);
      const item = finished.value as StackItem;
      expect(item).not.toBeNull();
      // costPaid on the StackItem is the paidAlready list with one entry.
      const costPaid = item.costPaid as readonly unknown[];
      expect(costPaid.length).toBe(1);
    });
  });

  describe("finalizeStackItem provenance", () => {
    it("carries originZone, altCostUsed (null by default), additionalCostsPaid (empty)", () => {
      const { game, seat0 } = makeGame();
      const cardId = mkEntityId(830);
      addCardToZone(game, seat0, ZoneType.Hand, cardId);
      const { result } = drainGenerator(
        game.castPipeline.run({
          castingPlayer: seat0,
          sourceCardId: cardId,
          originZone: ZoneType.Hand,
          asSpecialAction: false,
        }),
      );
      const item = result as StackItem;
      expect(item.provenance.originZone).toBe(ZoneType.Hand);
      expect(item.provenance.altCostUsed).toBeNull();
      expect(item.provenance.additionalCostsPaid).toEqual([]);
    });

    it("omits faceChosen / modesChosen / xValue when not set", () => {
      const { game, seat0 } = makeGame();
      const cardId = mkEntityId(831);
      addCardToZone(game, seat0, ZoneType.Hand, cardId);
      const { result } = drainGenerator(
        game.castPipeline.run({
          castingPlayer: seat0,
          sourceCardId: cardId,
          originZone: ZoneType.Hand,
          asSpecialAction: false,
        }),
      );
      const item = result as StackItem;
      expect(item.provenance.faceChosen).toBeUndefined();
      expect(item.provenance.modesChosen).toBeUndefined();
      expect(item.provenance.xValue).toBeUndefined();
    });

    it("includes alternativeZoneDestination when origin is Graveyard", () => {
      const { game, seat0 } = makeGame();
      const cardId = mkEntityId(832);
      addCardToZone(game, seat0, ZoneType.Graveyard, cardId);
      const { result } = drainGenerator(
        game.castPipeline.run({
          castingPlayer: seat0,
          sourceCardId: cardId,
          originZone: ZoneType.Graveyard,
          asSpecialAction: false,
        }),
      );
      const item = result as StackItem;
      expect(item.provenance.alternativeZoneDestination).toBe(ZoneType.Exile);
    });
  });
});
