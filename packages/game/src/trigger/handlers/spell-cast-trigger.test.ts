// SPDX-License-Identifier: GPL-3.0-or-later
// Task 2 — SpellCastTrigger tests (TDD, written before implementation).
// Covers: SpellCast event matching, ValidCard$ variants (Card, Card.Self,
// Card.nonCreature+YouCtrl), ValidActivatingPlayer$ variants (You, Opponent,
// Each), wrong-event rejection, identity fields, resolver stamping.
import type { TriggerAst } from "@mtg-forge-ts/core";
import {
  CardType,
  DEFAULT_PAPER_CARD_FLAGS,
  PhaseStep,
  ZoneType,
  mkEntityId,
  mkEvent,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { SpellCastTrigger } from "./spell-cast-trigger.js";

// Minimal PaperCard factories for type-check tests.
// SpellCastTrigger looks up cards in game.cards when validating nonCreature$.

const SOURCE_ID = mkEntityId(40);
const SPELL_ID = mkEntityId(41);
const OTHER_SPELL_ID = mkEntityId(42);
const TRIGGER_ID = mkEntityId(4);
const CONTROLLER = mkPlayerSeat(0);
const OPPONENT = mkPlayerSeat(1);

const mkCtx = (): TriggerBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  triggerId: TRIGGER_ID,
});

/** Build a SpellCast event. */
const mkSpellCastEvent = (
  cardId: ReturnType<typeof mkEntityId>,
  controllerSeat: ReturnType<typeof mkPlayerSeat>,
  stackItemId = mkEntityId(999),
) =>
  mkEvent("SpellCast", 1, PhaseStep.Main1, {
    stackItemId,
    cardId,
    controllerSeat,
  });

const mkAnyAst = (): TriggerAst => ({
  mode: "SpellCast",
  params: {
    ValidCard: { kind: "literal", raw: "Card" },
    ValidActivatingPlayer: { kind: "literal", raw: "You" },
  },
  effect: { handlerKey: "TrigPump", params: {} },
});

afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(SpellCastTrigger);
});

triggerHandlerRegistry.register(SpellCastTrigger);

describe("SpellCastTrigger", () => {
  it("is registered under mode 'SpellCast'", () => {
    expect(triggerHandlerRegistry.has("SpellCast")).toBe(true);
  });

  describe("ValidCard$ Card (any spell) + ValidActivatingPlayer$ You", () => {
    it("matches when controller casts any spell", () => {
      const Cls = triggerHandlerRegistry.lookup("SpellCast");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkAnyAst(), mkCtx());

      const event = mkSpellCastEvent(SPELL_ID, CONTROLLER);
      expect(ta.matches(event)).toBe(true);
    });

    it("does NOT match when opponent casts a spell (ValidActivatingPlayer$ You)", () => {
      const Cls = triggerHandlerRegistry.lookup("SpellCast");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkAnyAst(), mkCtx());

      const event = mkSpellCastEvent(SPELL_ID, OPPONENT);
      expect(ta.matches(event)).toBe(false);
    });
  });

  describe("ValidActivatingPlayer$ Opponent", () => {
    it("matches when opponent casts a spell", () => {
      const Cls = triggerHandlerRegistry.lookup("SpellCast");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const oppAst: TriggerAst = {
        mode: "SpellCast",
        params: {
          ValidCard: { kind: "literal", raw: "Card" },
          ValidActivatingPlayer: { kind: "literal", raw: "Opponent" },
        },
        effect: { handlerKey: "TrigOpp", params: {} },
      };
      const ta = new Cls().build(oppAst, mkCtx());

      expect(ta.matches(mkSpellCastEvent(SPELL_ID, OPPONENT))).toBe(true);
      expect(ta.matches(mkSpellCastEvent(SPELL_ID, CONTROLLER))).toBe(false);
    });
  });

  describe("ValidActivatingPlayer$ Each (default)", () => {
    it("matches when any player casts a spell", () => {
      const Cls = triggerHandlerRegistry.lookup("SpellCast");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const eachAst: TriggerAst = {
        mode: "SpellCast",
        params: {
          ValidCard: { kind: "literal", raw: "Card" },
          ValidActivatingPlayer: { kind: "literal", raw: "Each" },
        },
        effect: { handlerKey: "TrigEach", params: {} },
      };
      const ta = new Cls().build(eachAst, mkCtx());

      expect(ta.matches(mkSpellCastEvent(SPELL_ID, CONTROLLER))).toBe(true);
      expect(ta.matches(mkSpellCastEvent(SPELL_ID, OPPONENT))).toBe(true);
    });
  });

  describe("ValidCard$ Card.Self (the source card casting itself — effectively never)", () => {
    it("does NOT match any SpellCast event (Card.Self never triggers on cast)", () => {
      const Cls = triggerHandlerRegistry.lookup("SpellCast");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const selfAst: TriggerAst = {
        mode: "SpellCast",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          ValidActivatingPlayer: { kind: "literal", raw: "You" },
        },
        effect: { handlerKey: "TrigNever", params: {} },
      };
      const ta = new Cls().build(selfAst, mkCtx());

      // Even if the source card is cast, it can't trigger its own cast
      // (the trigger is not active on the stack). Always false.
      expect(ta.matches(mkSpellCastEvent(SOURCE_ID, CONTROLLER))).toBe(false);
      expect(ta.matches(mkSpellCastEvent(SPELL_ID, CONTROLLER))).toBe(false);
    });
  });

  describe("ValidCard$ Card.nonCreature+YouCtrl (Prowess pattern)", () => {
    // Build a minimal game-like context with a game.cards map so the trigger
    // can look up the spell's card type.
    const mkGameWithCard = (cardId: ReturnType<typeof mkEntityId>, isCreature: boolean) => {
      const paperCard = {
        name: "TestSpell",
        edition: "T",
        collectorNumber: "1",
        language: "en",
        foil: false,
        flags: DEFAULT_PAPER_CARD_FLAGS,
        definition: {
          name: "TestSpell",
          oracle: "",
          types: { has: (t: unknown) => (isCreature ? t === CardType.Creature : false) } as never,
          manaCost: null,
          abilities: [],
          triggers: [],
          replacements: [],
          statics: [],
          keywords: [],
          svars: new Map(),
        },
      };
      const card = new Card(cardId, paperCard, CONTROLLER, CONTROLLER, ZoneType.Hand);
      const cards = new Map([[cardId, card]]);
      return { cards } as unknown as import("../../game.js").Game;
    };

    it("matches when controller casts a noncreature spell", () => {
      const Cls = triggerHandlerRegistry.lookup("SpellCast");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const prowlessAst: TriggerAst = {
        mode: "SpellCast",
        params: {
          ValidCard: { kind: "literal", raw: "Card.nonCreature+YouCtrl" },
          ValidActivatingPlayer: { kind: "literal", raw: "You" },
        },
        effect: { handlerKey: "TrigProwess", params: {} },
      };

      const game = mkGameWithCard(SPELL_ID, false); // non-creature
      const ctx: TriggerBuildContext = {
        game,
        sourceCardId: SOURCE_ID,
        controllerSeat: CONTROLLER,
        triggerId: TRIGGER_ID,
      };
      const ta = new Cls().build(prowlessAst, ctx);

      const event = mkSpellCastEvent(SPELL_ID, CONTROLLER);
      expect(ta.matches(event)).toBe(true);
    });

    it("does NOT match when controller casts a creature spell", () => {
      const Cls = triggerHandlerRegistry.lookup("SpellCast");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const prowlessAst: TriggerAst = {
        mode: "SpellCast",
        params: {
          ValidCard: { kind: "literal", raw: "Card.nonCreature+YouCtrl" },
          ValidActivatingPlayer: { kind: "literal", raw: "You" },
        },
        effect: { handlerKey: "TrigProwess", params: {} },
      };

      const game = mkGameWithCard(SPELL_ID, true); // creature
      const ctx: TriggerBuildContext = {
        game,
        sourceCardId: SOURCE_ID,
        controllerSeat: CONTROLLER,
        triggerId: TRIGGER_ID,
      };
      const ta = new Cls().build(prowlessAst, ctx);

      const event = mkSpellCastEvent(SPELL_ID, CONTROLLER);
      expect(ta.matches(event)).toBe(false);
    });

    it("does NOT match when opponent casts a noncreature (YouCtrl constraint)", () => {
      const Cls = triggerHandlerRegistry.lookup("SpellCast");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const prowlessAst: TriggerAst = {
        mode: "SpellCast",
        params: {
          ValidCard: { kind: "literal", raw: "Card.nonCreature+YouCtrl" },
          ValidActivatingPlayer: { kind: "literal", raw: "You" },
        },
        effect: { handlerKey: "TrigProwess", params: {} },
      };

      const game = mkGameWithCard(OTHER_SPELL_ID, false);
      const ctx: TriggerBuildContext = {
        game,
        sourceCardId: SOURCE_ID,
        controllerSeat: CONTROLLER,
        triggerId: TRIGGER_ID,
      };
      const ta = new Cls().build(prowlessAst, ctx);

      // Opponent casts the noncreature
      const event = mkSpellCastEvent(OTHER_SPELL_ID, OPPONENT);
      expect(ta.matches(event)).toBe(false);
    });
  });

  describe("wrong event kind", () => {
    it("does NOT match a non-SpellCast event", () => {
      const Cls = triggerHandlerRegistry.lookup("SpellCast");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkAnyAst(), mkCtx());

      const lifeEvent = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
        playerSeat: CONTROLLER,
        oldLife: 20,
        newLife: 18,
        delta: -2,
        cause: "effect",
      });
      expect(ta.matches(lifeEvent)).toBe(false);
    });
  });

  describe("TriggeredAbility identity fields", () => {
    it("has correct id, sourceCardId, controllerSeatAtReg, kind, isDelayed", () => {
      const Cls = triggerHandlerRegistry.lookup("SpellCast");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkAnyAst(), mkCtx());

      expect(ta.kind).toBe("triggered");
      expect(ta.id).toBe(TRIGGER_ID);
      expect(ta.sourceCardId).toBe(SOURCE_ID);
      expect(ta.controllerSeatAtReg).toBe(CONTROLLER);
      expect(ta.isDelayed).toBe(false);
    });
  });

  describe("resolver stamp", () => {
    it("has a non-null resolver after build()", () => {
      const Cls = triggerHandlerRegistry.lookup("SpellCast");
      expect(Cls).toBeDefined();
      if (!Cls) return;
      const ta = new Cls().build(mkAnyAst(), mkCtx());

      const resolver = (ta as unknown as { resolver?: unknown }).resolver;
      expect(resolver).not.toBeNull();
      expect(resolver).not.toBeUndefined();
      expect(typeof (resolver as { resolve?: unknown }).resolve).toBe("function");
    });
  });
});
