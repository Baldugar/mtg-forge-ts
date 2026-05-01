// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 93 — Real-work TODO closures across keyword handlers.
//
// Closes 6 inline TODO(advanced) tails that previously documented
// real wiring gaps (not stale comments):
//   * squad-keyword.ts     — ETB token-copy synthesis from squadCount.
//   * offspring-keyword.ts — ETB 1/1 token-copy when offspringPaid.
//   * unearth-keyword.ts   — Haste UEoT + EoT-exile delayed trigger.
//   * ravenous-keyword.ts  — X-from-cast +1/+1 counters + draw if X≥5.
//   * sweep-keyword.ts     — Additional-cost loop (return lands; stamp
//                            sweepReturnedCount for SVar Count$Sweep).
//   * prototype-keyword.ts — Layer 7b registration (gated on
//                            prototypeCast). Override applies the
//                            prototype P/T to the source while flag is
//                            live.
import "../../ability/effects/index.js";
import "../../altcost/index.js";
import "./index.js";
import {
  type CardDefinition,
  CardType,
  Color,
  ColorSet,
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  type EntityId,
  type LobbyPlayer,
  type PaperCard,
  PhaseStep,
  type PlayerSeat,
  SeededRng,
  type Supertype,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkEvent,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Exile } from "../../zone/zones/exile.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { OffspringKeywordHandler } from "./offspring-keyword.js";
import { PrototypeKeywordHandler } from "./prototype-keyword.js";
import { RavenousKeywordHandler } from "./ravenous-keyword.js";
import { SquadKeywordHandler } from "./squad-keyword.js";
import { SweepKeywordHandler } from "./sweep-keyword.js";
import { UnearthKeywordHandler } from "./unearth-keyword.js";

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
  cardDataSyncedAt: "2026-04-30T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const ALICE: PlayerSeat = mkPlayerSeat(0);

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [aliceLP, bobLP], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, p.seat));
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
  }
  return game;
};

const NO_SUPERTYPES: readonly Supertype[] = [];

// 2/2 creature paper — used for squad / offspring / ravenous / unearth.
const mkCreaturePaper = (name: string, power: number, toughness: number): PaperCard => {
  const types = new TypeLine(NO_SUPERTYPES, [CardType.Creature], ["Beast"]);
  const definition: CardDefinition = {
    name,
    oracle: "",
    types,
    manaCost: null,
    pt: { power: String(power), toughness: String(toughness) },
    colors: ColorSet.empty(),
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  };
  return {
    name,
    edition: "TST",
    collectorNumber: "001",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition,
  };
};

// 3/3 creature for prototype tests (so we can assert the alt-PT override).
const mkProtoPaper = (): PaperCard => mkCreaturePaper("Test Proto", 7, 7);

// Basic Plains paper for sweep tests.
const mkPlainsPaper = (): PaperCard => {
  const definition: CardDefinition = {
    name: "Plains",
    oracle: "",
    types: TypeLine.parse("Basic Land — Plains"),
    manaCost: null,
    colors: ColorSet.of(Color.White),
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  };
  return {
    name: "Plains",
    edition: "TST",
    collectorNumber: "002",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition,
  };
};

interface YieldEnvelope {
  readonly kind?: string;
  readonly request?: { readonly kind?: string };
}

// -----------------------------------------------------------------------
// Squad — ETB token-copy synthesis. squadCount = N → N token copies.
// -----------------------------------------------------------------------

describe("Wave 93 — Squad ETB token-copy synthesis", () => {
  it("activate registers an ETB trigger; resolver creates squadCount token copies", () => {
    const game = mkGame();
    const sourceId = mkEntityId(9301);
    const source = new Card(
      sourceId,
      mkCreaturePaper("Squad Beast", 2, 2),
      ALICE,
      ALICE,
      ZoneType.Battlefield,
    );
    source.squadCount = 3;
    game.cards.set(sourceId, source);

    new SquadKeywordHandler().activate(
      { keyword: "squad", params: { cost: { kind: "literal", raw: "1 R" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    expect(source.keywords?.has("squad")).toBe(true);
    expect(source.squadCost).toBe("1 R");

    const ta = source.triggeredAbilities[0];
    expect(ta).toBeDefined();
    if (!ta) return;
    expect(ta.activeInZones.has(ZoneType.Battlefield)).toBe(true);
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) next = gen.next();

    // Three token copies were minted into the controller's battlefield.
    let tokens = 0;
    for (const [, c] of game.cards) {
      if (c.id === sourceId) continue;
      if (c.copiedFrom !== undefined) tokens++;
    }
    expect(tokens).toBe(3);
  });

  it("resolver no-ops when squadCount is undefined / 0", () => {
    const game = mkGame();
    const sourceId = mkEntityId(9302);
    const source = new Card(
      sourceId,
      mkCreaturePaper("Squad Beast", 2, 2),
      ALICE,
      ALICE,
      ZoneType.Battlefield,
    );
    game.cards.set(sourceId, source);
    new SquadKeywordHandler().activate(
      { keyword: "squad", params: { cost: { kind: "literal", raw: "1 R" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) next = gen.next();
    let tokens = 0;
    for (const [, c] of game.cards) {
      if (c.id === sourceId) continue;
      if (c.copiedFrom !== undefined) tokens++;
    }
    expect(tokens).toBe(0);
  });
});

// -----------------------------------------------------------------------
// Offspring — ETB 1/1 token-copy when offspringPaid is true.
// -----------------------------------------------------------------------

describe("Wave 93 — Offspring ETB 1/1 token-copy", () => {
  it("when offspringPaid=true, mints one token-copy with setPower/Toughness override", () => {
    const game = mkGame();
    const sourceId = mkEntityId(9311);
    const source = new Card(sourceId, mkCreaturePaper("Off Beast", 4, 4), ALICE, ALICE, ZoneType.Battlefield);
    source.offspringPaid = true;
    game.cards.set(sourceId, source);

    new OffspringKeywordHandler().activate(
      { keyword: "offspring", params: { cost: { kind: "literal", raw: "2" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    expect(ta).toBeDefined();
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) next = gen.next();

    let tokenId: EntityId | undefined;
    for (const [, c] of game.cards) {
      if (c.id === sourceId) continue;
      if (c.copiedFrom !== undefined) {
        tokenId = c.id;
        break;
      }
    }
    expect(tokenId).toBeDefined();
    if (tokenId === undefined) return;
    const tok = game.cards.get(tokenId);
    expect(tok?.tokenOverrides?.setPower).toBe(1);
    expect(tok?.tokenOverrides?.setToughness).toBe(1);
  });

  it("when offspringPaid is undefined, the resolver is a no-op", () => {
    const game = mkGame();
    const sourceId = mkEntityId(9312);
    const source = new Card(sourceId, mkCreaturePaper("Off Beast", 4, 4), ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    new OffspringKeywordHandler().activate(
      { keyword: "offspring", params: { cost: { kind: "literal", raw: "2" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) next = gen.next();
    let tokens = 0;
    for (const [, c] of game.cards) {
      if (c.id === sourceId) continue;
      if (c.copiedFrom !== undefined) tokens++;
    }
    expect(tokens).toBe(0);
  });
});

// -----------------------------------------------------------------------
// Unearth — haste UEoT + EoT-exile delayed trigger when unearthCast.
// -----------------------------------------------------------------------

describe("Wave 93 — Unearth haste UEoT + EoT-exile delayed trigger", () => {
  it("ETB trigger when unearthCast=true registers Layer-6 Haste grant + EoT delayed exile", () => {
    const game = mkGame();
    const sourceId = mkEntityId(9321);
    const source = new Card(
      sourceId,
      mkCreaturePaper("Unearth Beast", 3, 3),
      ALICE,
      ALICE,
      ZoneType.Battlefield,
    );
    source.unearthCast = true;
    game.cards.set(sourceId, source);

    new UnearthKeywordHandler().activate(
      { keyword: "unearth", params: { cost: { kind: "literal", raw: "1 B" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    expect(ta).toBeDefined();
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const initialDelayedSize = game.delayedTriggerQueue.size();
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) next = gen.next();

    // Layer 6 Haste grant is registered + filterable by source.
    const hasHaste = game.layerEngine.effectiveGrantedKeywords(sourceId).has("haste");
    expect(hasHaste).toBe(true);
    // Delayed-trigger queue gained one entry.
    expect(game.delayedTriggerQueue.size()).toBe(initialDelayedSize + 1);
  });

  it("ETB trigger no-ops when unearthCast is not stamped (cast from hand)", () => {
    const game = mkGame();
    const sourceId = mkEntityId(9322);
    const source = new Card(
      sourceId,
      mkCreaturePaper("Unearth Beast", 3, 3),
      ALICE,
      ALICE,
      ZoneType.Battlefield,
    );
    game.cards.set(sourceId, source);
    new UnearthKeywordHandler().activate(
      { keyword: "unearth", params: { cost: { kind: "literal", raw: "1 B" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const initialDelayedSize = game.delayedTriggerQueue.size();
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) next = gen.next();
    const hasHaste = game.layerEngine.effectiveGrantedKeywords(sourceId).has("haste");
    expect(hasHaste).toBe(false);
    expect(game.delayedTriggerQueue.size()).toBe(initialDelayedSize);
  });

  it("EoT delayed trigger fires on StepStarted(End) and exiles the source", () => {
    const game = mkGame();
    const sourceId = mkEntityId(9323);
    const source = new Card(
      sourceId,
      mkCreaturePaper("Unearth Beast", 3, 3),
      ALICE,
      ALICE,
      ZoneType.Battlefield,
    );
    source.unearthCast = true;
    game.cards.set(sourceId, source);
    game.getPlayer(ALICE).zones.get(ZoneType.Battlefield)?.add(sourceId);

    new UnearthKeywordHandler().activate(
      { keyword: "unearth", params: { cost: { kind: "literal", raw: "1 B" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) next = gen.next();

    // Now feed a StepStarted(EndStep) into the delayed-trigger queue.
    const endStepEvent = mkEvent("StepStarted", game.turn, PhaseStep.EndStep, {
      step: PhaseStep.EndStep,
      activeSeat: ALICE,
    });
    game.delayedTriggerQueue.onEvent(endStepEvent, game.triggerRegistry);
    // Source should now be in exile.
    expect(source.zone).toBe(ZoneType.Exile);
  });
});

// -----------------------------------------------------------------------
// Ravenous — X-from-cast +1/+1 counters + draw if X≥5.
// -----------------------------------------------------------------------

describe("Wave 93 — Ravenous X-from-cast wiring", () => {
  it("ETB trigger reads chosenX and adds X +1/+1 counters; draws a card when X >= 5", () => {
    const game = mkGame();
    const sourceId = mkEntityId(9331);
    const source = new Card(sourceId, mkCreaturePaper("Rav Beast", 0, 0), ALICE, ALICE, ZoneType.Battlefield);
    (source as unknown as { chosenX?: number }).chosenX = 5;
    game.cards.set(sourceId, source);

    // Seed a card in the library so drawCards has something to draw.
    const filler = new Card(
      mkEntityId(9332),
      mkCreaturePaper("Filler", 1, 1),
      ALICE,
      ALICE,
      ZoneType.Library,
    );
    game.cards.set(filler.id, filler);
    game.getPlayer(ALICE).zones.get(ZoneType.Library)?.add(filler.id);

    new RavenousKeywordHandler().activate(
      { keyword: "ravenous" },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) next = gen.next();

    expect(source.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(5);
    // Filler card should have moved from Library → Hand.
    expect(filler.zone).toBe(ZoneType.Hand);
  });

  it("when chosenX < 5, applies counters but does NOT draw a card", () => {
    const game = mkGame();
    const sourceId = mkEntityId(9333);
    const source = new Card(sourceId, mkCreaturePaper("Rav Beast", 0, 0), ALICE, ALICE, ZoneType.Battlefield);
    (source as unknown as { chosenX?: number }).chosenX = 3;
    game.cards.set(sourceId, source);

    const filler = new Card(
      mkEntityId(9334),
      mkCreaturePaper("Filler", 1, 1),
      ALICE,
      ALICE,
      ZoneType.Library,
    );
    game.cards.set(filler.id, filler);
    game.getPlayer(ALICE).zones.get(ZoneType.Library)?.add(filler.id);

    new RavenousKeywordHandler().activate(
      { keyword: "ravenous" },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) next = gen.next();
    expect(source.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(3);
    // Filler must still be in the Library (X<5 → no draw).
    expect(filler.zone).toBe(ZoneType.Library);
  });
});

// -----------------------------------------------------------------------
// Sweep — additional-cost loop returns chosen lands to hand and stamps
// sweepReturnedCount.
// -----------------------------------------------------------------------

describe("Wave 93 — Sweep additional-cost loop", () => {
  it("yields chooseCard, returns chosen Plains to hand, stamps sweepReturnedCount", () => {
    const game = mkGame();
    const sourceId = mkEntityId(9341);
    const source = new Card(sourceId, mkCreaturePaper("Sweep Spell", 0, 0), ALICE, ALICE, ZoneType.Stack);
    game.cards.set(sourceId, source);

    // Seed two Plains on the controller's battlefield.
    const plainsA = new Card(mkEntityId(9342), mkPlainsPaper(), ALICE, ALICE, ZoneType.Battlefield);
    const plainsB = new Card(mkEntityId(9343), mkPlainsPaper(), ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(plainsA.id, plainsA);
    game.cards.set(plainsB.id, plainsB);
    const battlefield = game.getPlayer(ALICE).zones.get(ZoneType.Battlefield);
    battlefield?.add(plainsA.id);
    battlefield?.add(plainsB.id);

    new SweepKeywordHandler().activate(
      { keyword: "sweep", params: { type: { kind: "literal", raw: "Plains" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    let sawChoose = false;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "chooseCard") {
        sawChoose = true;
        next = gen.next({ kind: "chooseCard", chosen: [plainsA.id, plainsB.id] });
      } else {
        next = gen.next();
      }
    }
    expect(sawChoose).toBe(true);
    expect(source.sweepReturnedCount).toBe(2);
    expect(plainsA.zone).toBe(ZoneType.Hand);
    expect(plainsB.zone).toBe(ZoneType.Hand);
  });

  it("no-op (count=0) when controller has no matching lands", () => {
    const game = mkGame();
    const sourceId = mkEntityId(9344);
    const source = new Card(sourceId, mkCreaturePaper("Sweep Spell", 0, 0), ALICE, ALICE, ZoneType.Stack);
    game.cards.set(sourceId, source);
    new SweepKeywordHandler().activate(
      { keyword: "sweep", params: { type: { kind: "literal", raw: "Plains" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    let sawDecision = false;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision") sawDecision = true;
      next = gen.next();
    }
    expect(sawDecision).toBe(false);
    expect(source.sweepReturnedCount).toBe(0);
  });
});

// -----------------------------------------------------------------------
// Prototype — Layer 7b registration. The override is gated on
// `prototypeCast === true`; flipping the flag flips the override on/off.
// -----------------------------------------------------------------------

describe("Wave 93 — Prototype Layer 7b registration", () => {
  it("when prototypeCast=true, the Layer 7b override sets the source to the prototype P/T", () => {
    const game = mkGame();
    const sourceId = mkEntityId(9351);
    const source = new Card(sourceId, mkProtoPaper(), ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    new PrototypeKeywordHandler().activate(
      {
        keyword: "prototype",
        params: {
          cost: { kind: "literal", raw: "2 R" },
          pt: { kind: "literal", raw: "2/3" },
        },
      },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    expect(source.prototypeCost).toBe("2 R");
    expect(source.prototypePT).toBe("2/3");

    // Without prototypeCast: characteristics use printed P/T (7/7).
    let chars = game.layerEngine.computeCharacteristics(sourceId);
    expect(chars.power).toBe(7);
    expect(chars.toughness).toBe(7);

    // Stamp prototypeCast and bump the epoch so the cache invalidates.
    source.prototypeCast = true;
    game.layerEngine.bumpEpoch("test:prototype-flag-flip");
    chars = game.layerEngine.computeCharacteristics(sourceId);
    expect(chars.power).toBe(2);
    expect(chars.toughness).toBe(3);
  });

  it("the registered Layer 7b effect is permanent-duration scoped to Card.Self", () => {
    const game = mkGame();
    const sourceId = mkEntityId(9352);
    const otherId = mkEntityId(9353);
    const source = new Card(sourceId, mkProtoPaper(), ALICE, ALICE, ZoneType.Battlefield);
    const other = new Card(otherId, mkProtoPaper(), ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(otherId, other);
    source.prototypeCast = true;

    new PrototypeKeywordHandler().activate(
      {
        keyword: "prototype",
        params: {
          cost: { kind: "literal", raw: "1 U" },
          pt: { kind: "literal", raw: "1/1" },
        },
      },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    // Source picks up the override.
    const sourceChars = game.layerEngine.computeCharacteristics(sourceId);
    expect(sourceChars.power).toBe(1);
    expect(sourceChars.toughness).toBe(1);
    // Sibling card (no prototype flag) keeps its printed P/T — proving
    // the override is scoped to Card.Self via targetCardIdFn.
    const otherChars = game.layerEngine.computeCharacteristics(otherId);
    expect(otherChars.power).toBe(7);
    expect(otherChars.toughness).toBe(7);
  });
});
