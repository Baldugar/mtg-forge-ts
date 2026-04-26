// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 17 — corpus-unknown replacement handler unit tests.
// Covers DrawCards, PayLife, Cascade, RollDice, Mill, Destroy.
// Each handler gets ~3 cases: filter match/miss, prevent-blocks, pass-through.
import type { MutationIntent, ReplacementAst } from "@mtg-forge-ts/core";
import { mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { CascadeReplacement } from "./cascade-replacement.js";
import { DestroyReplacement } from "./destroy-replacement.js";
import { DrawCardsReplacement } from "./draw-cards-replacement.js";
import { MillReplacement } from "./mill-replacement.js";
import { PayLifeReplacement } from "./pay-life-replacement.js";
import { RollDiceReplacement } from "./roll-dice-replacement.js";

const SOURCE_ID = mkEntityId(700);
const OTHER_ID = mkEntityId(701);
const REPL_ID = mkEntityId(70);
const ALICE = mkPlayerSeat(0);
const BOB = mkPlayerSeat(1);

const mkCtx = (): ReplacementBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: ALICE,
  replacementId: REPL_ID,
});

afterEach(() => {
  replacementHandlerRegistry.clear();
  replacementHandlerRegistry.register(DrawCardsReplacement);
  replacementHandlerRegistry.register(PayLifeReplacement);
  replacementHandlerRegistry.register(CascadeReplacement);
  replacementHandlerRegistry.register(RollDiceReplacement);
  replacementHandlerRegistry.register(MillReplacement);
  replacementHandlerRegistry.register(DestroyReplacement);
});

// Self-register once on module load so the bootstrap-registered handlers
// don't fight the side-effect import path used by the production barrel.
replacementHandlerRegistry.register(DrawCardsReplacement);
replacementHandlerRegistry.register(PayLifeReplacement);
replacementHandlerRegistry.register(CascadeReplacement);
replacementHandlerRegistry.register(RollDiceReplacement);
replacementHandlerRegistry.register(MillReplacement);
replacementHandlerRegistry.register(DestroyReplacement);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mkPlayerAst = (
  eventKind: string,
  validPlayer: string,
  layer?: string,
  prevent?: string,
  replaceWith?: string,
): ReplacementAst => ({
  eventKind,
  params: {
    ValidPlayer: { kind: "literal", raw: validPlayer },
    ...(layer ? { Layer: { kind: "literal", raw: layer } } : {}),
    ...(prevent ? { Prevent: { kind: "literal", raw: prevent } } : {}),
    ...(replaceWith ? { ReplaceWith: { kind: "literal", raw: replaceWith } } : {}),
  },
  effect: { handlerKey: replaceWith ?? "NoEffect", params: {} },
});

const mkSeatIntent = (kind: string, seat: ReturnType<typeof mkPlayerSeat>): MutationIntent =>
  ({ kind, seat }) as unknown as MutationIntent;

// ---------------------------------------------------------------------------
// DrawCards
// ---------------------------------------------------------------------------

describe("DrawCardsReplacement (Wave 17)", () => {
  it("is registered under eventKind 'DrawCards'", () => {
    expect(replacementHandlerRegistry.has("DrawCards")).toBe(true);
  });

  it("matches the controller's draw on ValidPlayer$ You", () => {
    const Cls = replacementHandlerRegistry.lookup("DrawCards");
    if (!Cls) return;
    const ra = new Cls().build(mkPlayerAst("DrawCards", "You"), mkCtx());
    expect(ra.matches(mkSeatIntent("drawCards", ALICE))).toBe(true);
    expect(ra.matches(mkSeatIntent("drawCards", BOB))).toBe(false);
  });

  it("returns null on Layer$ CantHappen (skip-draw)", () => {
    const Cls = replacementHandlerRegistry.lookup("DrawCards");
    if (!Cls) return;
    const ra = new Cls().build(mkPlayerAst("DrawCards", "You", "CantHappen"), mkCtx());
    expect(ra.apply(mkSeatIntent("drawCards", ALICE), {})).toBeNull();
    expect(ra.layer).toBe("cantHappen");
  });

  it("does NOT match a non-drawCards intent", () => {
    const Cls = replacementHandlerRegistry.lookup("DrawCards");
    if (!Cls) return;
    const ra = new Cls().build(mkPlayerAst("DrawCards", "You"), mkCtx());
    expect(ra.matches(mkSeatIntent("damage", ALICE))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PayLife
// ---------------------------------------------------------------------------

describe("PayLifeReplacement (Wave 17)", () => {
  it("is registered under eventKind 'PayLife'", () => {
    expect(replacementHandlerRegistry.has("PayLife")).toBe(true);
  });

  it("matches the controller's payment on ValidPlayer$ You", () => {
    const Cls = replacementHandlerRegistry.lookup("PayLife");
    if (!Cls) return;
    const ra = new Cls().build(mkPlayerAst("PayLife", "You"), mkCtx());
    expect(ra.matches(mkSeatIntent("payLife", ALICE))).toBe(true);
    expect(ra.matches(mkSeatIntent("payLife", BOB))).toBe(false);
  });

  it("returns null on Prevent$ True (life payment blocked)", () => {
    const Cls = replacementHandlerRegistry.lookup("PayLife");
    if (!Cls) return;
    const ra = new Cls().build(mkPlayerAst("PayLife", "You", undefined, "True"), mkCtx());
    expect(ra.apply(mkSeatIntent("payLife", ALICE), {})).toBeNull();
  });

  it("passes through on no-flag replacement", () => {
    const Cls = replacementHandlerRegistry.lookup("PayLife");
    if (!Cls) return;
    const ra = new Cls().build(mkPlayerAst("PayLife", "You"), mkCtx());
    const intent = mkSeatIntent("payLife", ALICE);
    expect(ra.apply(intent, {})).toBe(intent);
  });
});

// ---------------------------------------------------------------------------
// Cascade
// ---------------------------------------------------------------------------

describe("CascadeReplacement (Wave 17)", () => {
  it("is registered under eventKind 'Cascade'", () => {
    expect(replacementHandlerRegistry.has("Cascade")).toBe(true);
  });

  it("matches when an opponent cascades on ValidPlayer$ Opponent", () => {
    const Cls = replacementHandlerRegistry.lookup("Cascade");
    if (!Cls) return;
    const ra = new Cls().build(mkPlayerAst("Cascade", "Opponent"), mkCtx());
    expect(ra.matches(mkSeatIntent("cascade", BOB))).toBe(true);
    expect(ra.matches(mkSeatIntent("cascade", ALICE))).toBe(false);
  });

  it("returns null on Layer$ CantHappen", () => {
    const Cls = replacementHandlerRegistry.lookup("Cascade");
    if (!Cls) return;
    const ra = new Cls().build(mkPlayerAst("Cascade", "You", "CantHappen"), mkCtx());
    expect(ra.apply(mkSeatIntent("cascade", ALICE), {})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RollDice
// ---------------------------------------------------------------------------

describe("RollDiceReplacement (Wave 17)", () => {
  it("is registered under eventKind 'RollDice'", () => {
    expect(replacementHandlerRegistry.has("RollDice")).toBe(true);
  });

  it("matches any seat on ValidPlayer$ Each", () => {
    const Cls = replacementHandlerRegistry.lookup("RollDice");
    if (!Cls) return;
    const ra = new Cls().build(mkPlayerAst("RollDice", "Each"), mkCtx());
    expect(ra.matches(mkSeatIntent("rollDice", ALICE))).toBe(true);
    expect(ra.matches(mkSeatIntent("rollDice", BOB))).toBe(true);
  });

  it("returns null on Prevent$ True", () => {
    const Cls = replacementHandlerRegistry.lookup("RollDice");
    if (!Cls) return;
    const ra = new Cls().build(mkPlayerAst("RollDice", "You", undefined, "True"), mkCtx());
    expect(ra.apply(mkSeatIntent("rollDice", ALICE), {})).toBeNull();
  });

  it("does NOT match a non-rollDice intent", () => {
    const Cls = replacementHandlerRegistry.lookup("RollDice");
    if (!Cls) return;
    const ra = new Cls().build(mkPlayerAst("RollDice", "You"), mkCtx());
    expect(ra.matches(mkSeatIntent("flipCoin", ALICE))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Mill
// ---------------------------------------------------------------------------

describe("MillReplacement (Wave 17)", () => {
  it("is registered under eventKind 'Mill'", () => {
    expect(replacementHandlerRegistry.has("Mill")).toBe(true);
  });

  it("matches the controller's mill on ValidPlayer$ You", () => {
    const Cls = replacementHandlerRegistry.lookup("Mill");
    if (!Cls) return;
    const ra = new Cls().build(mkPlayerAst("Mill", "You"), mkCtx());
    expect(ra.matches(mkSeatIntent("mill", ALICE))).toBe(true);
    expect(ra.matches(mkSeatIntent("mill", BOB))).toBe(false);
  });

  it("returns null on Layer$ CantHappen", () => {
    const Cls = replacementHandlerRegistry.lookup("Mill");
    if (!Cls) return;
    const ra = new Cls().build(mkPlayerAst("Mill", "You", "CantHappen"), mkCtx());
    expect(ra.apply(mkSeatIntent("mill", ALICE), {})).toBeNull();
  });

  it("passes through unmatched flags", () => {
    const Cls = replacementHandlerRegistry.lookup("Mill");
    if (!Cls) return;
    const ra = new Cls().build(mkPlayerAst("Mill", "Player"), mkCtx());
    const intent = mkSeatIntent("mill", BOB);
    expect(ra.apply(intent, {})).toBe(intent);
  });
});

// ---------------------------------------------------------------------------
// Destroy
// ---------------------------------------------------------------------------

describe("DestroyReplacement (Wave 17)", () => {
  const mkDestroyAst = (
    validCard: string,
    layer?: string,
    prevent?: string,
    replaceWith?: string,
  ): ReplacementAst => ({
    eventKind: "Destroy",
    params: {
      ValidCard: { kind: "literal", raw: validCard },
      ...(layer ? { Layer: { kind: "literal", raw: layer } } : {}),
      ...(prevent ? { Prevent: { kind: "literal", raw: prevent } } : {}),
      ...(replaceWith ? { ReplaceWith: { kind: "literal", raw: replaceWith } } : {}),
    },
    effect: { handlerKey: replaceWith ?? "NoEffect", params: {} },
    isSelf: validCard === "Card.Self",
  });

  const mkDestroyIntent = (cardId: ReturnType<typeof mkEntityId>): MutationIntent =>
    ({
      kind: "destroy",
      cardId,
      sourceId: null,
      cause: "effect",
    }) as unknown as MutationIntent;

  it("is registered under eventKind 'Destroy'", () => {
    expect(replacementHandlerRegistry.has("Destroy")).toBe(true);
  });

  it("matches on ValidCard$ Card.Self for the source card", () => {
    const Cls = replacementHandlerRegistry.lookup("Destroy");
    if (!Cls) return;
    const ra = new Cls().build(mkDestroyAst("Card.Self"), mkCtx());
    expect(ra.matches(mkDestroyIntent(SOURCE_ID))).toBe(true);
    expect(ra.matches(mkDestroyIntent(OTHER_ID))).toBe(false);
  });

  it("returns null on Layer$ CantHappen (indestructible-style lock)", () => {
    const Cls = replacementHandlerRegistry.lookup("Destroy");
    if (!Cls) return;
    const ra = new Cls().build(mkDestroyAst("Card.Self", "CantHappen"), mkCtx());
    expect(ra.apply(mkDestroyIntent(SOURCE_ID), {})).toBeNull();
  });

  it("redirects to exile on ReplaceWith$ DBExile", () => {
    const Cls = replacementHandlerRegistry.lookup("Destroy");
    if (!Cls) return;
    const ra = new Cls().build(mkDestroyAst("Card.Self", undefined, undefined, "DBExile"), mkCtx());
    const intent = mkDestroyIntent(SOURCE_ID);
    const result = ra.apply(intent, {}) as { kind: string; cardId: unknown } | null;
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("exile");
    expect(result?.cardId).toBe(SOURCE_ID);
  });
});
