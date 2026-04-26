// SPDX-License-Identifier: GPL-3.0-or-later
// Batch D2 — RemoveCounterReplacement tests. Verifies ValidCounterType$
// filtering (case-insensitive STUN match), ValidCard$ Permanent.OppCtrl
// requires the target's controller to differ from the replacement's
// controller, and Layer$ CantHappen apply() returns null.
import type { MutationIntent, ReplacementAst } from "@mtg-forge-ts/core";
import { CounterType, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { RemoveCounterReplacement } from "./remove-counter-replacement.js";

const SOURCE_ID = mkEntityId(40);
const TARGET_OWN = mkEntityId(41);
const TARGET_OPP = mkEntityId(42);
const REPL_ID = mkEntityId(4);
const ALICE = mkPlayerSeat(0);
const BOB = mkPlayerSeat(1);

const mkPaperCard = () => ({
  oracleId: "oracle-test",
  printingId: "set:001",
  name: "Test",
  flags: { isToken: false, isMeldResult: false, isEmblem: false, isAttraction: false },
  definition: {
    name: "Test",
    types: new Set(),
    superTypes: new Set(),
    subTypes: new Set(),
    colors: new Set(),
    abilities: [],
    triggers: [],
    statics: [],
    replacements: [],
    keywords: [],
    svars: new Map(),
  },
});

const mkCtxWithCards = (
  ownCards: ReturnType<typeof mkEntityId>[],
  oppCards: ReturnType<typeof mkEntityId>[],
): ReplacementBuildContext => {
  const cards = new Map<ReturnType<typeof mkEntityId>, Card>();
  for (const id of ownCards) {
    const c = new Card(id, mkPaperCard() as never, ALICE, ALICE, ZoneType.Battlefield);
    cards.set(id, c);
  }
  for (const id of oppCards) {
    const c = new Card(id, mkPaperCard() as never, BOB, BOB, ZoneType.Battlefield);
    cards.set(id, c);
  }
  return {
    game: { cards } as never,
    sourceCardId: SOURCE_ID,
    controllerSeat: ALICE,
    replacementId: REPL_ID,
  };
};

const mkStunBlockerAst = (): ReplacementAst => ({
  eventKind: "RemoveCounter",
  params: {
    ValidCard: { kind: "literal", raw: "Permanent.OppCtrl" },
    ValidCounterType: { kind: "literal", raw: "STUN" },
    Layer: { kind: "literal", raw: "CantHappen" },
  },
  effect: { handlerKey: "Prevent", params: {} },
});

const mkRemoveCounterIntent = (
  cardId: ReturnType<typeof mkEntityId>,
  counterType: string,
): MutationIntent => ({
  kind: "removeCounter",
  cardId,
  counterType,
  amount: 1,
  sourceId: null,
});

afterEach(() => {
  replacementHandlerRegistry.clear();
  replacementHandlerRegistry.register(RemoveCounterReplacement);
});

beforeEach(() => {
  replacementHandlerRegistry.clear();
  replacementHandlerRegistry.register(RemoveCounterReplacement);
});

describe("RemoveCounterReplacement (Batch D2)", () => {
  it("is registered under eventKind 'RemoveCounter'", () => {
    expect(replacementHandlerRegistry.has("RemoveCounter")).toBe(true);
  });

  it("matches stun-counter removal on opponent's permanent", () => {
    const Cls = replacementHandlerRegistry.lookup("RemoveCounter");
    if (!Cls) return;
    const ctx = mkCtxWithCards([], [TARGET_OPP]);
    const ra = new Cls().build(mkStunBlockerAst(), ctx);
    expect(ra.matches(mkRemoveCounterIntent(TARGET_OPP, CounterType.Stun))).toBe(true);
  });

  it("does NOT match stun-counter removal on own permanent (Permanent.OppCtrl)", () => {
    const Cls = replacementHandlerRegistry.lookup("RemoveCounter");
    if (!Cls) return;
    const ctx = mkCtxWithCards([TARGET_OWN], []);
    const ra = new Cls().build(mkStunBlockerAst(), ctx);
    expect(ra.matches(mkRemoveCounterIntent(TARGET_OWN, CounterType.Stun))).toBe(false);
  });

  it("does NOT match other counter types (ValidCounterType$ STUN)", () => {
    const Cls = replacementHandlerRegistry.lookup("RemoveCounter");
    if (!Cls) return;
    const ctx = mkCtxWithCards([], [TARGET_OPP]);
    const ra = new Cls().build(mkStunBlockerAst(), ctx);
    expect(ra.matches(mkRemoveCounterIntent(TARGET_OPP, CounterType.PlusOnePlusOne))).toBe(false);
  });

  it("apply() returns null on Layer$ CantHappen (counter removal prevented)", () => {
    const Cls = replacementHandlerRegistry.lookup("RemoveCounter");
    if (!Cls) return;
    const ctx = mkCtxWithCards([], [TARGET_OPP]);
    const ra = new Cls().build(mkStunBlockerAst(), ctx);
    const intent = mkRemoveCounterIntent(TARGET_OPP, CounterType.Stun);
    expect(ra.apply(intent, {})).toBeNull();
  });

  it("does NOT match unrelated intent kinds", () => {
    const Cls = replacementHandlerRegistry.lookup("RemoveCounter");
    if (!Cls) return;
    const ctx = mkCtxWithCards([], [TARGET_OPP]);
    const ra = new Cls().build(mkStunBlockerAst(), ctx);
    expect(ra.matches({ kind: "addCounter", amount: 1 })).toBe(false);
  });
});
