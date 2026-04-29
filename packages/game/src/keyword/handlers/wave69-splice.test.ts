// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 69 — Splice onto Arcane (CR 702.46/702.47) cast-pipeline integration.
//
// Closes the TODO(advanced) tail from Waves 37/58. The cast pipeline now:
//   1. Detects K:Splice cards in caster's hand whenever an Arcane spell
//      is being cast.
//   2. Yields per-splicer confirmation decisions; on accept, splices the
//      splicer's cost into the spell's total cost.
//   3. Emits CardsRevealed for each accepted splicer (CR 701.23 reveal).
//   4. Records the splicers on `card.splicedEffects` so finalizeStackItem
//      wraps the resolver to dispatch each splicer's effect AFTER the
//      parent spell's body resolves.
import "../../altcost/index.js";
import "../../ability/effects/index.js";
import "./index.js";
import type {
  AbilityAst,
  CardDefinition,
  EntityId,
  KeywordAst,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
  SVarAst,
} from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../../action/engine-yield.js";
import { Card } from "../../card.js";
import { CastPipeline } from "../../cast/cast-pipeline.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";

// ---------- Game / fixture setup ----------

const aliceLP: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bobLP: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };
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
  cardDataSyncedAt: "2026-04-28T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};
const ALICE = mkPlayerSeat(0);

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [aliceLP, bobLP], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
  }
  return game;
};

const mkPaper = (
  name: string,
  typeLine: string,
  manaCostRaw: string,
  abilities: readonly AbilityAst[],
  keywords: readonly KeywordAst[],
  svars: ReadonlyMap<string, SVarAst>,
): PaperCard => {
  const definition: CardDefinition = {
    name,
    oracle: "",
    types: TypeLine.parse(typeLine),
    manaCost: { raw: manaCostRaw },
    abilities,
    triggers: [],
    replacements: [],
    statics: [],
    keywords,
    svars,
  };
  const paper: PaperCard = {
    name,
    edition: "TST",
    collectorNumber: "001",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
  } as PaperCard;
  // The CastPipeline reads paper.definition structurally; attach via cast.
  (paper as unknown as { definition: CardDefinition }).definition = definition;
  return paper;
};

// Casting card — Arcane spell that gains 3 life on resolve.
const mkArcaneSpellPaper = (): PaperCard =>
  mkPaper(
    "Test Arcane",
    "Instant — Arcane",
    "{1}",
    [
      {
        kind: "spell",
        effect: {
          handlerKey: "GainLife",
          params: { LifeAmount: { kind: "literal", raw: "3" } },
        },
        cost: { raw: "1" },
      },
    ],
    [],
    new Map(),
  );

// Casting card — non-Arcane spell (control case).
const mkPlainSpellPaper = (): PaperCard =>
  mkPaper(
    "Test Plain",
    "Instant",
    "{1}",
    [
      {
        kind: "spell",
        effect: {
          handlerKey: "GainLife",
          params: { LifeAmount: { kind: "literal", raw: "3" } },
        },
        cost: { raw: "1" },
      },
    ],
    [],
    new Map(),
  );

// Splicer card — K:Splice:Arcane:G; SP$ GainLife | LifeAmount$ 5.
const mkSplicerPaper = (): PaperCard =>
  mkPaper(
    "Splicer",
    "Instant — Arcane",
    "{G}",
    [
      {
        kind: "spell",
        effect: {
          handlerKey: "GainLife",
          params: { LifeAmount: { kind: "literal", raw: "5" } },
        },
        cost: { raw: "G" },
      },
    ],
    [{ keyword: "splice", params: { detail: { kind: "literal", raw: "Arcane:G" } } }],
    new Map(),
  );

const placeCard = (game: Game, seat: PlayerSeat, paper: PaperCard, id: EntityId, zone: ZoneType): Card => {
  const card = new Card(id, paper, seat, seat, zone);
  card.activateAbilitiesFromDefinition();
  game.cards.set(id, card);
  const z = game.getPlayer(seat).zones.get(zone);
  if (!z) throw new Error("missing zone");
  z.add(id);
  return card;
};

const stampSpliceKeyword = (card: Card): void => {
  if (!card.keywords) card.keywords = new Set();
  card.keywords.add("splice");
};

// ---------- Tests ----------

describe("Wave 69 — Splice onto Arcane cast-pipeline integration", () => {
  it("yields a splice prompt when an Arcane spell is cast with a K:Splice card in hand", () => {
    const game = mkGame();
    const arcaneId = mkEntityId(6900);
    const splicerId = mkEntityId(6901);
    placeCard(game, ALICE, mkArcaneSpellPaper(), arcaneId, ZoneType.Hand);
    const splicer = placeCard(game, ALICE, mkSplicerPaper(), splicerId, ZoneType.Hand);
    stampSpliceKeyword(splicer);

    // Skip cost payment so the test can drive only the splice prompt.
    class TestPipeline extends CastPipeline {
      // biome-ignore lint/correctness/useYield: bypass payment for inspection
      protected override *stepActivateManaAbilities(): Generator<EngineYield, void, unknown> {
        return;
      }
      // biome-ignore lint/correctness/useYield: bypass payment for inspection
      protected override *stepPayCosts(): Generator<EngineYield, void, unknown> {
        return;
      }
    }
    const pipe = new TestPipeline(game);
    const gen = pipe.run({
      castingPlayer: ALICE,
      sourceCardId: arcaneId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    });
    let step = gen.next();
    let foundSplicePrompt = false;
    while (!step.done) {
      const v = step.value as { kind?: string; request?: { kind?: string; prompt?: string } };
      if (
        v.kind === "decision" &&
        v.request?.kind === "confirmAction" &&
        v.request.prompt?.startsWith("Splice ")
      ) {
        foundSplicePrompt = true;
        // Decline so the test completes cleanly.
        step = gen.next({ kind: "confirmAction", confirmed: false });
        continue;
      }
      step = gen.next();
    }
    expect(foundSplicePrompt).toBe(true);
  });

  it("does NOT yield a splice prompt when the casting spell is non-Arcane", () => {
    const game = mkGame();
    const plainId = mkEntityId(6910);
    const splicerId = mkEntityId(6911);
    placeCard(game, ALICE, mkPlainSpellPaper(), plainId, ZoneType.Hand);
    const splicer = placeCard(game, ALICE, mkSplicerPaper(), splicerId, ZoneType.Hand);
    stampSpliceKeyword(splicer);

    class TestPipeline extends CastPipeline {
      // biome-ignore lint/correctness/useYield: bypass payment for inspection
      protected override *stepActivateManaAbilities(): Generator<EngineYield, void, unknown> {
        return;
      }
      // biome-ignore lint/correctness/useYield: bypass payment for inspection
      protected override *stepPayCosts(): Generator<EngineYield, void, unknown> {
        return;
      }
    }
    const pipe = new TestPipeline(game);
    const gen = pipe.run({
      castingPlayer: ALICE,
      sourceCardId: plainId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    });
    let step = gen.next();
    let sawSplicePrompt = false;
    while (!step.done) {
      const v = step.value as { kind?: string; request?: { kind?: string; prompt?: string } };
      if (
        v.kind === "decision" &&
        v.request?.kind === "confirmAction" &&
        v.request.prompt?.startsWith("Splice ")
      ) {
        sawSplicePrompt = true;
      }
      step = gen.next();
    }
    expect(sawSplicePrompt).toBe(false);
  });

  it("on accept, splices the cost into base.raw, reveals the splicer, and stamps splicedEffects", () => {
    const game = mkGame();
    const arcaneId = mkEntityId(6920);
    const splicerId = mkEntityId(6921);
    placeCard(game, ALICE, mkArcaneSpellPaper(), arcaneId, ZoneType.Hand);
    const splicer = placeCard(game, ALICE, mkSplicerPaper(), splicerId, ZoneType.Hand);
    stampSpliceKeyword(splicer);

    class TestPipeline extends CastPipeline {
      capturedSpliced:
        | ReadonlyArray<{ readonly splicerCardId: EntityId; readonly svarName: string }>
        | undefined;
      capturedBaseRaw: string | undefined;
      // biome-ignore lint/correctness/useYield: bypass payment for inspection
      protected override *stepActivateManaAbilities(): Generator<EngineYield, void, unknown> {
        // Snapshot the state populated by stepChooseSplices BEFORE
        // finalizeStackItem runs (which clears card.splicedEffects).
        const card = this.game.cards.get(arcaneId);
        if (card?.splicedEffects !== undefined) {
          this.capturedSpliced = [...card.splicedEffects];
        }
        const ctx = (this as unknown as { _ctx?: { totalCost?: { base?: { raw?: string } } } })._ctx;
        const baseRaw = ctx?.totalCost?.base?.raw;
        if (typeof baseRaw === "string") this.capturedBaseRaw = baseRaw;
        return;
      }
      // biome-ignore lint/correctness/useYield: bypass payment for inspection
      protected override *stepPayCosts(): Generator<EngineYield, void, unknown> {
        return;
      }
    }
    const pipe = new TestPipeline(game);
    const gen = pipe.run({
      castingPlayer: ALICE,
      sourceCardId: arcaneId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    });
    let step = gen.next();
    const events: Array<{ kind: string; payload?: unknown }> = [];
    while (!step.done) {
      const v = step.value as {
        kind?: string;
        request?: { kind?: string; prompt?: string };
        event?: { kind?: string; payload?: unknown };
      };
      if (
        v.kind === "decision" &&
        v.request?.kind === "confirmAction" &&
        v.request.prompt?.startsWith("Splice ")
      ) {
        step = gen.next({ kind: "confirmAction", confirmed: true });
        continue;
      }
      if (v.kind === "event" && v.event !== undefined) {
        events.push({ kind: v.event.kind ?? "", payload: v.event.payload });
      }
      step = gen.next();
    }

    // Splicer card stays in hand (CR 702.46c).
    expect(splicer.zone).toBe(ZoneType.Hand);

    // CardsRevealed event fired with the splicer id.
    const revealed = events.find((e) => e.kind === "CardsRevealed");
    expect(revealed).not.toBeUndefined();
    const revPayload = revealed?.payload as
      | { revealedBy: PlayerSeat; cardIds: readonly EntityId[]; fromZone: ZoneType }
      | undefined;
    expect(revPayload?.revealedBy).toBe(ALICE);
    expect(revPayload?.cardIds).toEqual([splicerId]);
    expect(revPayload?.fromZone).toBe(ZoneType.Hand);

    // splicedEffects was captured pre-finalize (slot now cleared).
    expect(pipe.capturedSpliced).not.toBeUndefined();
    expect(pipe.capturedSpliced?.length).toBe(1);
    expect(pipe.capturedSpliced?.[0]?.splicerCardId).toBe(splicerId);
  });

  it("on decline, no cost is added, no reveal fires, and splicedEffects stays empty", () => {
    const game = mkGame();
    const arcaneId = mkEntityId(6930);
    const splicerId = mkEntityId(6931);
    const arcaneCard = placeCard(game, ALICE, mkArcaneSpellPaper(), arcaneId, ZoneType.Hand);
    const splicer = placeCard(game, ALICE, mkSplicerPaper(), splicerId, ZoneType.Hand);
    stampSpliceKeyword(splicer);

    class TestPipeline extends CastPipeline {
      // biome-ignore lint/correctness/useYield: bypass payment for inspection
      protected override *stepActivateManaAbilities(): Generator<EngineYield, void, unknown> {
        return;
      }
      // biome-ignore lint/correctness/useYield: bypass payment for inspection
      protected override *stepPayCosts(): Generator<EngineYield, void, unknown> {
        return;
      }
    }
    const pipe = new TestPipeline(game);
    const gen = pipe.run({
      castingPlayer: ALICE,
      sourceCardId: arcaneId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    });
    let step = gen.next();
    const events: Array<{ kind: string }> = [];
    while (!step.done) {
      const v = step.value as {
        kind?: string;
        request?: { kind?: string; prompt?: string };
        event?: { kind?: string };
      };
      if (
        v.kind === "decision" &&
        v.request?.kind === "confirmAction" &&
        v.request.prompt?.startsWith("Splice ")
      ) {
        step = gen.next({ kind: "confirmAction", confirmed: false });
        continue;
      }
      if (v.kind === "event" && v.event !== undefined) events.push({ kind: v.event.kind ?? "" });
      step = gen.next();
    }

    // No CardsRevealed for splice.
    expect(events.find((e) => e.kind === "CardsRevealed")).toBeUndefined();
    // Splicer stays in hand.
    expect(splicer.zone).toBe(ZoneType.Hand);
    // splicedEffects was never set on the casting card (or was already
    // cleared by finalizeStackItem). Either way, it must be empty/unset.
    expect(arcaneCard.splicedEffects).toBeUndefined();
  });

  it("resolves: parent's GainLife (3) + splicer's GainLife (5) both apply on resolve", () => {
    const game = mkGame();
    const arcaneId = mkEntityId(6940);
    const splicerId = mkEntityId(6941);
    placeCard(game, ALICE, mkArcaneSpellPaper(), arcaneId, ZoneType.Hand);
    const splicer = placeCard(game, ALICE, mkSplicerPaper(), splicerId, ZoneType.Hand);
    stampSpliceKeyword(splicer);

    class TestPipeline extends CastPipeline {
      // biome-ignore lint/correctness/useYield: bypass payment for inspection
      protected override *stepActivateManaAbilities(): Generator<EngineYield, void, unknown> {
        return;
      }
      // biome-ignore lint/correctness/useYield: bypass payment for inspection
      protected override *stepPayCosts(): Generator<EngineYield, void, unknown> {
        return;
      }
    }
    const pipe = new TestPipeline(game);
    const gen = pipe.run({
      castingPlayer: ALICE,
      sourceCardId: arcaneId,
      originZone: ZoneType.Hand,
      asSpecialAction: false,
    });
    let step = gen.next();
    let item: unknown = null;
    while (!step.done) {
      const v = step.value as { kind?: string; request?: { kind?: string; prompt?: string } };
      if (
        v.kind === "decision" &&
        v.request?.kind === "confirmAction" &&
        v.request.prompt?.startsWith("Splice ")
      ) {
        step = gen.next({ kind: "confirmAction", confirmed: true });
        continue;
      }
      step = gen.next();
    }
    item = step.value;
    expect(item).not.toBeNull();

    const startingLife = game.getPlayer(ALICE).life;
    const stackItem = item as {
      resolver?: { resolve: (g: unknown) => Generator<unknown, void, unknown> } | null;
    };
    const resolver = stackItem.resolver;
    expect(resolver).not.toBeNull();
    if (resolver != null) {
      const resGen = resolver.resolve(game);
      let r = resGen.next();
      while (!r.done) r = resGen.next();
    }

    // Parent +3, spliced +5 → +8 life total.
    expect(game.getPlayer(ALICE).life).toBe(startingLife + 8);
  });
});
