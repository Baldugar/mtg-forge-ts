// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 48 — replacement-handler unit tests covering the four un-stubbed
// `matches() => false` handlers (Counter / AddCounter / CreateToken / Draw)
// and the six newly-registered eventKinds (AssignDealDamage / DealtDamage
// / DeclareBlocker / PlanarDiceResult / SetInMotion / Tap).
import type { MutationIntent, PaperCard, ReplacementAst } from "@mtg-forge-ts/core";
import { mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
// Side-effect import: registers all handlers.
import "../index.js";

const SOURCE = mkEntityId(10);
const OTHER = mkEntityId(99);
const REPL = mkEntityId(1);
const SEAT0 = mkPlayerSeat(0);
const SEAT1 = mkPlayerSeat(1);

const mkCtx = (): ReplacementBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE,
  controllerSeat: SEAT0,
  replacementId: REPL,
});

// ---------------------------------------------------------------------------
// Counter — Cavern of Souls / Gaea's Herald: Prevent$ True
// ---------------------------------------------------------------------------

describe("CounterReplacement (Wave 48)", () => {
  const mkCantBeCounteredAst = (): ReplacementAst => ({
    eventKind: "Counter",
    params: {
      ValidCard: { kind: "literal", raw: "Card" },
      Layer: { kind: "literal", raw: "CantHappen" },
    },
    effect: { handlerKey: "Prevent", params: {} },
  });

  it("matches a `countered` intent against ValidCard$ Card", () => {
    const Cls = replacementHandlerRegistry.lookup("Counter");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ra = new Cls().build(mkCantBeCounteredAst(), mkCtx());
    const intent: MutationIntent = {
      kind: "countered",
      stackItemId: mkEntityId(50),
      counteredCardId: OTHER,
      sourceId: mkEntityId(60),
      seat: SEAT0,
    } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(true);
  });

  it("apply returns null when Layer$ CantHappen", () => {
    const Cls = replacementHandlerRegistry.lookup("Counter");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ra = new Cls().build(mkCantBeCounteredAst(), mkCtx());
    const intent: MutationIntent = {
      kind: "countered",
      stackItemId: mkEntityId(50),
      counteredCardId: OTHER,
      sourceId: mkEntityId(60),
      seat: SEAT0,
    } as unknown as MutationIntent;
    expect(ra.apply(intent, {} as never)).toBeNull();
  });

  it("does NOT match a non-countered intent", () => {
    const Cls = replacementHandlerRegistry.lookup("Counter");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ra = new Cls().build(mkCantBeCounteredAst(), mkCtx());
    const intent: MutationIntent = { kind: "damage" } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(false);
  });

  it("ValidCard$ Card.Self only matches when counteredCardId is the source", () => {
    const Cls = replacementHandlerRegistry.lookup("Counter");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const selfAst: ReplacementAst = {
      eventKind: "Counter",
      params: {
        ValidCard: { kind: "literal", raw: "Card.Self" },
        Layer: { kind: "literal", raw: "CantHappen" },
      },
      effect: { handlerKey: "Prevent", params: {} },
      isSelf: true,
    };
    const ra = new Cls().build(selfAst, mkCtx());
    const selfIntent: MutationIntent = {
      kind: "countered",
      stackItemId: mkEntityId(50),
      counteredCardId: SOURCE,
      sourceId: mkEntityId(60),
      seat: SEAT0,
    } as unknown as MutationIntent;
    const otherIntent: MutationIntent = {
      kind: "countered",
      stackItemId: mkEntityId(51),
      counteredCardId: OTHER,
      sourceId: mkEntityId(60),
      seat: SEAT0,
    } as unknown as MutationIntent;
    expect(ra.matches(selfIntent)).toBe(true);
    expect(ra.matches(otherIntent)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AddCounter — Doubling Season / Hardened Scales
// ---------------------------------------------------------------------------

describe("AddCounterReplacement (Wave 48)", () => {
  const mkDoublingSeasonAst = (): ReplacementAst => ({
    eventKind: "AddCounter",
    params: {
      ValidCard: { kind: "literal", raw: "Permanent" },
      Amount: { kind: "literal", raw: "2" },
    },
    effect: { handlerKey: "AddCounter", params: {} },
  });

  it("matches addCounter intents against any permanent", () => {
    const Cls = replacementHandlerRegistry.lookup("AddCounter");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ra = new Cls().build(mkDoublingSeasonAst(), mkCtx());
    const intent: MutationIntent = {
      kind: "addCounter",
      cardId: OTHER,
      counterType: "P1P1",
      amount: 2,
      sourceId: null,
    } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(true);
  });

  it("doubles the amount on apply (Doubling Season Amount$ 2)", () => {
    const Cls = replacementHandlerRegistry.lookup("AddCounter");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ra = new Cls().build(mkDoublingSeasonAst(), mkCtx());
    const intent: MutationIntent = {
      kind: "addCounter",
      cardId: OTHER,
      counterType: "P1P1",
      amount: 2,
      sourceId: null,
    } as unknown as MutationIntent;
    const result = ra.apply(intent, {} as never) as { amount: number };
    expect(result).not.toBeNull();
    expect(result.amount).toBe(4);
  });

  it("Hardened Scales (AddAmount$ 1) adds one to the placed amount", () => {
    const Cls = replacementHandlerRegistry.lookup("AddCounter");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ast: ReplacementAst = {
      eventKind: "AddCounter",
      params: {
        ValidCard: { kind: "literal", raw: "Permanent" },
        AddAmount: { kind: "literal", raw: "1" },
      },
      effect: { handlerKey: "AddCounter", params: {} },
    };
    const ra = new Cls().build(ast, mkCtx());
    const intent: MutationIntent = {
      kind: "addCounter",
      cardId: OTHER,
      counterType: "P1P1",
      amount: 1,
      sourceId: null,
    } as unknown as MutationIntent;
    const result = ra.apply(intent, {} as never) as { amount: number };
    expect(result.amount).toBe(2);
  });

  it("does NOT match a non-addCounter intent", () => {
    const Cls = replacementHandlerRegistry.lookup("AddCounter");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ra = new Cls().build(mkDoublingSeasonAst(), mkCtx());
    const intent: MutationIntent = { kind: "damage" } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CreateToken — Doubling Season / Parallel Lives / Anointed Procession
// ---------------------------------------------------------------------------

describe("CreateTokenReplacement (Wave 48)", () => {
  const mkParallelLivesAst = (): ReplacementAst => ({
    eventKind: "CreateToken",
    params: {
      ValidPlayer: { kind: "literal", raw: "You" },
      Amount: { kind: "literal", raw: "2" },
    },
    effect: { handlerKey: "CreateToken", params: {} },
  });

  const fakePaperCard = { name: "Test Token" } as unknown as PaperCard;

  it("matches a createToken intent for the controller", () => {
    const Cls = replacementHandlerRegistry.lookup("CreateToken");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ra = new Cls().build(mkParallelLivesAst(), mkCtx());
    const intent: MutationIntent = {
      kind: "createToken",
      controllerSeat: SEAT0,
      paperCard: fakePaperCard,
      count: 2,
      isCopy: false,
      copyOf: null,
    } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(true);
  });

  it("does NOT match a createToken intent for a different player (ValidPlayer$ You)", () => {
    const Cls = replacementHandlerRegistry.lookup("CreateToken");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ra = new Cls().build(mkParallelLivesAst(), mkCtx());
    const intent: MutationIntent = {
      kind: "createToken",
      controllerSeat: SEAT1,
      paperCard: fakePaperCard,
      count: 2,
      isCopy: false,
      copyOf: null,
    } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(false);
  });

  it("doubles the count on apply (2 → 4)", () => {
    const Cls = replacementHandlerRegistry.lookup("CreateToken");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ra = new Cls().build(mkParallelLivesAst(), mkCtx());
    const intent: MutationIntent = {
      kind: "createToken",
      controllerSeat: SEAT0,
      paperCard: fakePaperCard,
      count: 2,
      isCopy: false,
      copyOf: null,
    } as unknown as MutationIntent;
    const result = ra.apply(intent, {} as never) as { count: number };
    expect(result).not.toBeNull();
    expect(result.count).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Draw — Notion Thief / Alms Collector
// ---------------------------------------------------------------------------

describe("DrawReplacement (Wave 48)", () => {
  const mkNotionThiefAst = (): ReplacementAst => ({
    eventKind: "Draw",
    params: {
      ValidPlayer: { kind: "literal", raw: "Opponent" },
      ReplaceWith: { kind: "literal", raw: "DBController" },
    },
    effect: { handlerKey: "DBController", params: {} },
  });

  it("matches an opponent's drawCards intent (ValidPlayer$ Opponent)", () => {
    const Cls = replacementHandlerRegistry.lookup("Draw");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ra = new Cls().build(mkNotionThiefAst(), mkCtx());
    const intent: MutationIntent = {
      kind: "drawCards",
      seat: SEAT1,
      count: 1,
    } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(true);
  });

  it("does NOT match the controller's own drawCards intent", () => {
    const Cls = replacementHandlerRegistry.lookup("Draw");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ra = new Cls().build(mkNotionThiefAst(), mkCtx());
    const intent: MutationIntent = {
      kind: "drawCards",
      seat: SEAT0,
      count: 1,
    } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(false);
  });

  it("redirects opponent's draw to the controller (DBController)", () => {
    const Cls = replacementHandlerRegistry.lookup("Draw");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ra = new Cls().build(mkNotionThiefAst(), mkCtx());
    const intent: MutationIntent = {
      kind: "drawCards",
      seat: SEAT1,
      count: 1,
    } as unknown as MutationIntent;
    const result = ra.apply(intent, {} as never) as { seat: number };
    expect(result).not.toBeNull();
    expect(result.seat).toBe(SEAT0);
  });

  it("Layer$ CantHappen returns null (Maralen-style block)", () => {
    const Cls = replacementHandlerRegistry.lookup("Draw");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ast: ReplacementAst = {
      eventKind: "Draw",
      params: {
        ValidPlayer: { kind: "literal", raw: "You" },
        Layer: { kind: "literal", raw: "CantHappen" },
      },
      effect: { handlerKey: "Prevent", params: {} },
    };
    const ra = new Cls().build(ast, mkCtx());
    const intent: MutationIntent = {
      kind: "drawCards",
      seat: SEAT0,
      count: 1,
    } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(true);
    expect(ra.apply(intent, {} as never)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Six newly-registered eventKinds — registration smoke tests.
// ---------------------------------------------------------------------------

describe("Wave 48 newly-registered replacement eventKinds", () => {
  it.each(["AssignDealDamage", "DealtDamage", "DeclareBlocker", "PlanarDiceResult", "SetInMotion", "Tap"])(
    "registers '%s'",
    (kind) => {
      expect(replacementHandlerRegistry.has(kind)).toBe(true);
    },
  );

  it("Tap handler matches a tap intent for Card.Self", () => {
    const Cls = replacementHandlerRegistry.lookup("Tap");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ast: ReplacementAst = {
      eventKind: "Tap",
      params: {
        ValidCard: { kind: "literal", raw: "Card.Self" },
        Layer: { kind: "literal", raw: "CantHappen" },
      },
      effect: { handlerKey: "Prevent", params: {} },
      isSelf: true,
    };
    const ra = new Cls().build(ast, mkCtx());
    const intent: MutationIntent = { kind: "tap", cardId: SOURCE } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(true);
    expect(ra.apply(intent, {} as never)).toBeNull();
  });

  it("DeclareBlocker handler matches a declareBlocker intent", () => {
    const Cls = replacementHandlerRegistry.lookup("DeclareBlocker");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ast: ReplacementAst = {
      eventKind: "DeclareBlocker",
      params: {
        Layer: { kind: "literal", raw: "CantHappen" },
      },
      effect: { handlerKey: "Prevent", params: {} },
    };
    const ra = new Cls().build(ast, mkCtx());
    const intent: MutationIntent = {
      kind: "declareBlocker",
      blockerId: SOURCE,
      attackerIds: [],
    } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(true);
    expect(ra.apply(intent, {} as never)).toBeNull();
  });
});
