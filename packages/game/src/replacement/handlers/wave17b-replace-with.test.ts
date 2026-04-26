// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 17b — ReplaceWith$ SVar dispatch on the six Wave 17 replacements.
//
// One unit test per handler: build a minimal stub Game with a source card
// whose definition carries an SVar named by `ReplaceWith$`, and verify the
// handler's `apply` returns `null` (canonical event prevented) when the
// SVar resolves to an ability. Pair each "redirect" assertion with a
// "no-redirect when SVar absent" assertion so the helper's null-guard is
// exercised.
import type { EffectInvocation, EntityId, MutationIntent, ReplacementAst, SVarAst } from "@mtg-forge-ts/core";
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

const SOURCE_ID = mkEntityId(800);
const REPL_ID = mkEntityId(80);
const ALICE = mkPlayerSeat(0);

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

replacementHandlerRegistry.register(DrawCardsReplacement);
replacementHandlerRegistry.register(PayLifeReplacement);
replacementHandlerRegistry.register(CascadeReplacement);
replacementHandlerRegistry.register(RollDiceReplacement);
replacementHandlerRegistry.register(MillReplacement);
replacementHandlerRegistry.register(DestroyReplacement);

/**
 * Stub-game: minimum surface the lookupReplaceWithAbility helper reads —
 * `cards.get(id).paperCard.definition.svars.get(key)` returning an ability
 * SVar. We construct only those nested fields; everything else is unused
 * by the apply path under test.
 */
const mkStubGame = (svarName: string, ability: EffectInvocation | null) => {
  const svars = new Map<string, SVarAst>();
  if (ability !== null) {
    svars.set(svarName, { kind: "ability", raw: "stub", ability });
  }
  const card = {
    paperCard: {
      definition: { svars },
    },
  };
  return {
    cards: {
      get: (id: EntityId) => (id === SOURCE_ID ? card : undefined),
    },
  } as unknown as import("../../game.js").Game;
};

const mkAbility = (handlerKey: string): EffectInvocation => ({ handlerKey, params: {} });

const mkPlayerAst = (eventKind: string, replaceWith: string): ReplacementAst => ({
  eventKind,
  params: {
    ValidPlayer: { kind: "literal", raw: "You" },
    ReplaceWith: { kind: "literal", raw: replaceWith },
  },
  effect: { handlerKey: replaceWith, params: {} },
});

const mkSeatIntent = (kind: string): MutationIntent => ({ kind, seat: ALICE }) as unknown as MutationIntent;

// ---------------------------------------------------------------------------
// DrawCards
// ---------------------------------------------------------------------------

describe("DrawCardsReplacement.ReplaceWith$ (Wave 17b)", () => {
  it("returns null when ReplaceWith$ SVar resolves to an ability", () => {
    const handler = new DrawCardsReplacement();
    const ability = handler.build(mkPlayerAst("DrawCards", "DBMillTwo"), mkCtx());
    const game = mkStubGame("DBMillTwo", mkAbility("Mill"));
    const result = ability.apply(mkSeatIntent("drawCards"), game);
    expect(result).toBeNull();
  });
  it("falls through (returns intent) when ReplaceWith$ SVar is absent", () => {
    const handler = new DrawCardsReplacement();
    const ability = handler.build(mkPlayerAst("DrawCards", "DBMillTwo"), mkCtx());
    const game = mkStubGame("DBMillTwo", null);
    const intent = mkSeatIntent("drawCards");
    const result = ability.apply(intent, game);
    expect(result).toBe(intent);
  });
});

// ---------------------------------------------------------------------------
// PayLife
// ---------------------------------------------------------------------------

describe("PayLifeReplacement.ReplaceWith$ (Wave 17b)", () => {
  it("returns null when ReplaceWith$ SVar resolves to an ability", () => {
    const handler = new PayLifeReplacement();
    const ability = handler.build(mkPlayerAst("PayLife", "DBLoseEnergy"), mkCtx());
    const game = mkStubGame("DBLoseEnergy", mkAbility("LoseCounter"));
    const result = ability.apply(mkSeatIntent("payLife"), game);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cascade
// ---------------------------------------------------------------------------

describe("CascadeReplacement.ReplaceWith$ (Wave 17b)", () => {
  it("returns null when ReplaceWith$ SVar resolves to an ability", () => {
    const handler = new CascadeReplacement();
    const ability = handler.build(mkPlayerAst("Cascade", "DBCascadeTwice"), mkCtx());
    const game = mkStubGame("DBCascadeTwice", mkAbility("Cascade"));
    const result = ability.apply(mkSeatIntent("cascade"), game);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RollDice
// ---------------------------------------------------------------------------

describe("RollDiceReplacement.ReplaceWith$ (Wave 17b)", () => {
  it("returns null when ReplaceWith$ SVar resolves to an ability", () => {
    const handler = new RollDiceReplacement();
    const ability = handler.build(mkPlayerAst("RollDice", "DBRerollHigher"), mkCtx());
    const game = mkStubGame("DBRerollHigher", mkAbility("RollDice"));
    const result = ability.apply(mkSeatIntent("rollDice"), game);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Mill
// ---------------------------------------------------------------------------

describe("MillReplacement.ReplaceWith$ (Wave 17b)", () => {
  it("returns null when ReplaceWith$ SVar resolves to an ability", () => {
    const handler = new MillReplacement();
    const ability = handler.build(mkPlayerAst("Mill", "DBExileFromLibrary"), mkCtx());
    const game = mkStubGame("DBExileFromLibrary", mkAbility("ChangeZone"));
    const result = ability.apply(mkSeatIntent("mill"), game);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Destroy
// ---------------------------------------------------------------------------

describe("DestroyReplacement.ReplaceWith$ (Wave 17b)", () => {
  it("DBExile redirect (existing) returns an exile intent", () => {
    const handler = new DestroyReplacement();
    const ast: ReplacementAst = {
      eventKind: "Destroy",
      params: {
        ValidCard: { kind: "literal", raw: "Card.Self" },
        ReplaceWith: { kind: "literal", raw: "DBExile" },
      },
      effect: { handlerKey: "DBExile", params: {} },
    };
    const ability = handler.build(ast, mkCtx());
    const game = mkStubGame("DBExile", null);
    const intent = { kind: "destroy", cardId: SOURCE_ID } as unknown as MutationIntent;
    const result = ability.apply(intent, game);
    expect(result).not.toBeNull();
    expect((result as { kind?: string } | null)?.kind).toBe("exile");
  });
  it("non-DBExile SVar redirect returns null when SVar resolves", () => {
    const handler = new DestroyReplacement();
    const ast: ReplacementAst = {
      eventKind: "Destroy",
      params: {
        ValidCard: { kind: "literal", raw: "Card.Self" },
        ReplaceWith: { kind: "literal", raw: "DBRescue" },
      },
      effect: { handlerKey: "Replace", params: {} },
    };
    const ability = handler.build(ast, mkCtx());
    const game = mkStubGame("DBRescue", mkAbility("ChangeZone"));
    const intent = { kind: "destroy", cardId: SOURCE_ID } as unknown as MutationIntent;
    const result = ability.apply(intent, game);
    expect(result).toBeNull();
  });
});
