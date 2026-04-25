// SPDX-License-Identifier: GPL-3.0-or-later
// Task 2 — MovedReplacement tests.
import type { MutationIntent, ReplacementAst } from "@mtg-forge-ts/core";
import { ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
// Import for side-effect to register MovedReplacement at module load time.
import { MovedReplacement } from "./moved-replacement.js";

const SOURCE_ID = mkEntityId(10);
const OTHER_ID = mkEntityId(99);
const REPL_ID = mkEntityId(1);
const CONTROLLER = mkPlayerSeat(0);

const mkCtx = (): ReplacementBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  replacementId: REPL_ID,
});

/** "If this would die, exile it instead" (Rest in Peace / Grafdigger's Cage style) */
const mkDieToExileAst = (): ReplacementAst => ({
  eventKind: "Moved",
  params: {
    Origin: { kind: "literal", raw: "Any" },
    Destination: { kind: "literal", raw: "Graveyard" },
    ValidCard: { kind: "literal", raw: "Card.Self" },
  },
  effect: { handlerKey: "DBExile", params: {} },
  isSelf: true,
});

/** Global replacement: prevent ALL moves to graveyard */
const mkPreventGraveyardAst = (): ReplacementAst => ({
  eventKind: "Moved",
  params: {
    Origin: { kind: "literal", raw: "Any" },
    Destination: { kind: "literal", raw: "Graveyard" },
    ValidCard: { kind: "literal", raw: "Card" },
    Prevent: { kind: "literal", raw: "True" },
  },
  effect: { handlerKey: "Prevent", params: {} },
});

/** Redirect any card going to graveyard → hand instead */
const mkToHandAst = (): ReplacementAst => ({
  eventKind: "Moved",
  params: {
    Destination: { kind: "literal", raw: "Graveyard" },
    ValidCard: { kind: "literal", raw: "Card" },
  },
  effect: { handlerKey: "DBHand", params: {} },
});

const mkMoveIntent = (
  cardId: ReturnType<typeof mkEntityId>,
  fromZone: ZoneType,
  toZone: ZoneType,
): MutationIntent => ({
  kind: "moveTo",
  cardId,
  fromZone,
  toZone,
  toSeat: null,
  cause: "test",
});

// Re-register after each clear
afterEach(() => {
  replacementHandlerRegistry.clear();
  replacementHandlerRegistry.register(MovedReplacement);
});

// Ensure handler is registered before all tests
replacementHandlerRegistry.register(MovedReplacement);

describe("MovedReplacement", () => {
  it("is registered under eventKind 'Moved'", () => {
    expect(replacementHandlerRegistry.has("Moved")).toBe(true);
  });

  describe("die-to-exile (ValidCard$ Card.Self, Destination$ Graveyard, ReplaceWith$ DBExile)", () => {
    it("matches when the source card moves to Graveyard from any zone", () => {
      const Cls = replacementHandlerRegistry.lookup("Moved");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkDieToExileAst(), mkCtx());
      const intent = mkMoveIntent(SOURCE_ID, ZoneType.Battlefield, ZoneType.Graveyard);
      expect(ra.matches(intent)).toBe(true);
    });

    it("does NOT match when a different card moves to Graveyard (Card.Self filter)", () => {
      const Cls = replacementHandlerRegistry.lookup("Moved");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkDieToExileAst(), mkCtx());
      const intent = mkMoveIntent(OTHER_ID, ZoneType.Battlefield, ZoneType.Graveyard);
      expect(ra.matches(intent)).toBe(false);
    });

    it("does NOT match when source card moves to Exile (wrong destination)", () => {
      const Cls = replacementHandlerRegistry.lookup("Moved");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkDieToExileAst(), mkCtx());
      const intent = mkMoveIntent(SOURCE_ID, ZoneType.Battlefield, ZoneType.Exile);
      expect(ra.matches(intent)).toBe(false);
    });

    it("does NOT match a non-moveTo intent kind", () => {
      const Cls = replacementHandlerRegistry.lookup("Moved");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkDieToExileAst(), mkCtx());
      const intent: MutationIntent = { kind: "damage", amount: 3 };
      expect(ra.matches(intent)).toBe(false);
    });

    it("apply redirects toZone from Graveyard to Exile", () => {
      const Cls = replacementHandlerRegistry.lookup("Moved");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkDieToExileAst(), mkCtx());
      const intent = mkMoveIntent(SOURCE_ID, ZoneType.Battlefield, ZoneType.Graveyard);
      const result = ra.apply(intent, {} as never);
      expect(result).not.toBeNull();
      expect((result as typeof intent).toZone).toBe(ZoneType.Exile);
    });

    it("apply preserves other intent fields (cardId, fromZone, cause)", () => {
      const Cls = replacementHandlerRegistry.lookup("Moved");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkDieToExileAst(), mkCtx());
      const intent = mkMoveIntent(SOURCE_ID, ZoneType.Battlefield, ZoneType.Graveyard);
      const result = ra.apply(intent, {} as never) as Record<string, unknown>;
      expect(result.cardId).toBe(SOURCE_ID);
      expect(result.fromZone).toBe(ZoneType.Battlefield);
      expect(result.cause).toBe("test");
    });
  });

  describe("Prevent$ True — prevent move entirely", () => {
    it("apply returns null when Prevent$ True is set", () => {
      const Cls = replacementHandlerRegistry.lookup("Moved");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkPreventGraveyardAst(), mkCtx());
      const intent = mkMoveIntent(OTHER_ID, ZoneType.Battlefield, ZoneType.Graveyard);
      expect(ra.matches(intent)).toBe(true);
      expect(ra.apply(intent, {} as never)).toBeNull();
    });
  });

  describe("global watcher (ValidCard$ Card)", () => {
    it("matches any card moving to Graveyard", () => {
      const Cls = replacementHandlerRegistry.lookup("Moved");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkToHandAst(), mkCtx());
      const intent = mkMoveIntent(OTHER_ID, ZoneType.Battlefield, ZoneType.Graveyard);
      expect(ra.matches(intent)).toBe(true);
    });

    it("apply redirects to Hand (DBHand)", () => {
      const Cls = replacementHandlerRegistry.lookup("Moved");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkToHandAst(), mkCtx());
      const intent = mkMoveIntent(OTHER_ID, ZoneType.Library, ZoneType.Graveyard);
      const result = ra.apply(intent, {} as never) as typeof intent;
      expect(result).not.toBeNull();
      expect(result.toZone).toBe(ZoneType.Hand);
    });
  });

  describe("Origin$ filter", () => {
    it("matches only when fromZone matches Origin$", () => {
      const Cls = replacementHandlerRegistry.lookup("Moved");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ast: ReplacementAst = {
        eventKind: "Moved",
        params: {
          Origin: { kind: "literal", raw: "Battlefield" },
          Destination: { kind: "literal", raw: "Graveyard" },
          ValidCard: { kind: "literal", raw: "Card.Self" },
        },
        effect: { handlerKey: "DBExile", params: {} },
      };
      const ra = new Cls().build(ast, mkCtx());
      // Correct origin
      expect(ra.matches(mkMoveIntent(SOURCE_ID, ZoneType.Battlefield, ZoneType.Graveyard))).toBe(true);
      // Wrong origin — hand → graveyard should NOT match
      expect(ra.matches(mkMoveIntent(SOURCE_ID, ZoneType.Hand, ZoneType.Graveyard))).toBe(false);
    });
  });

  describe("ReplacementAbility identity fields", () => {
    it("has correct id, sourceCardId, kind, isSelfReplacement, layer", () => {
      const Cls = replacementHandlerRegistry.lookup("Moved");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ra = new Cls().build(mkDieToExileAst(), mkCtx());
      expect(ra.kind).toBe("replacement");
      expect(ra.id).toBe(REPL_ID);
      expect(ra.sourceCardId).toBe(SOURCE_ID);
      expect(ra.controllerSeatAtReg).toBe(CONTROLLER);
      expect(ra.isSelfReplacement).toBe(true); // isSelf: true in AST
      expect(ra.layer).toBe("other");
    });
  });
});
