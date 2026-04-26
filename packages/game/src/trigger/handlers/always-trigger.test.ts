// SPDX-License-Identifier: GPL-3.0-or-later
// Batch D2 — AlwaysTrigger tests. Verifies match-all behavior on canonical
// events (Tapped, LifeChanged, SpellCast) and crucially the telemetry-event
// filter that prevents the trigger from re-firing on its own resolution
// (TriggerQueued, TriggerResolved, ReplacementApplied, EventPrevented,
// StateBasedActionApplied, etc.) — without that filter, Always-mode
// triggers create infinite recursion.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { CardType, PhaseStep, ZoneType, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { AlwaysTrigger } from "./always-trigger.js";

const SOURCE_ID = mkEntityId(70);
const TRIGGER_ID = mkEntityId(7);
const CONTROLLER = mkPlayerSeat(0);

const mkCtx = (): TriggerBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  triggerId: TRIGGER_ID,
});

const mkAst = (): TriggerAst => ({
  mode: "Always",
  params: {},
  effect: { handlerKey: "TrigSac", params: {} },
});

afterEach(() => {
  triggerHandlerRegistry.clear();
  triggerHandlerRegistry.register(AlwaysTrigger);
});

triggerHandlerRegistry.register(AlwaysTrigger);

describe("AlwaysTrigger (Batch D2)", () => {
  it("is registered under mode 'Always'", () => {
    expect(triggerHandlerRegistry.has("Always")).toBe(true);
  });

  it("matches canonical events (CardTapped)", () => {
    const Cls = triggerHandlerRegistry.lookup("Always");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const event = mkEvent("CardTapped", 1, PhaseStep.Main1, { cardId: mkEntityId(99) });
    expect(ta.matches(event)).toBe(true);
  });

  it("matches canonical events (LifeChanged)", () => {
    const Cls = triggerHandlerRegistry.lookup("Always");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const event = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
      playerSeat: CONTROLLER,
      oldLife: 20,
      newLife: 18,
      delta: -2,
      cause: "effect",
    });
    expect(ta.matches(event)).toBe(true);
  });

  it("matches canonical events (SpellCast)", () => {
    const Cls = triggerHandlerRegistry.lookup("Always");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const event = mkEvent("SpellCast", 1, PhaseStep.Main1, {
      stackItemId: mkEntityId(98),
      cardId: mkEntityId(99),
      controllerSeat: CONTROLLER,
    });
    expect(ta.matches(event)).toBe(true);
  });

  it("does NOT match telemetry events (TriggerQueued)", () => {
    const Cls = triggerHandlerRegistry.lookup("Always");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const event = mkEvent("TriggerQueued", 1, PhaseStep.Main1, {
      triggerId: TRIGGER_ID,
      sourceCardId: SOURCE_ID,
    });
    expect(ta.matches(event)).toBe(false);
  });

  it("does NOT match telemetry events (TriggerResolved)", () => {
    const Cls = triggerHandlerRegistry.lookup("Always");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const event = mkEvent("TriggerResolved", 1, PhaseStep.Main1, { triggerId: TRIGGER_ID });
    expect(ta.matches(event)).toBe(false);
  });

  it("does NOT match telemetry events (ReplacementApplied)", () => {
    const Cls = triggerHandlerRegistry.lookup("Always");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const event = mkEvent("ReplacementApplied", 1, PhaseStep.Main1, {
      replacementId: mkEntityId(88),
      original: { kind: "lifeChange" },
      replaced: { kind: "lifeChange" },
    });
    expect(ta.matches(event)).toBe(false);
  });

  it("does NOT match telemetry events (EventPrevented)", () => {
    const Cls = triggerHandlerRegistry.lookup("Always");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const event = mkEvent("EventPrevented", 1, PhaseStep.Main1, {
      original: { kind: "gameLoss" },
    });
    expect(ta.matches(event)).toBe(false);
  });

  it("does NOT match telemetry events (StateBasedActionApplied)", () => {
    const Cls = triggerHandlerRegistry.lookup("Always");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    const event = mkEvent("StateBasedActionApplied", 1, PhaseStep.Main1, { actionCount: 1 });
    expect(ta.matches(event)).toBe(false);
  });

  it("does NOT match telemetry events (StaticAbilityRegistered/Unregistered)", () => {
    const Cls = triggerHandlerRegistry.lookup("Always");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    expect(
      ta.matches(
        mkEvent("StaticAbilityRegistered", 1, PhaseStep.Main1, {
          staticId: mkEntityId(11),
          sourceCardId: SOURCE_ID,
        }),
      ),
    ).toBe(false);
    expect(
      ta.matches(mkEvent("StaticAbilityUnregistered", 1, PhaseStep.Main1, { staticId: mkEntityId(11) })),
    ).toBe(false);
  });

  it("does NOT match telemetry events (ContinuousEffectRegistered/Expired, CostPaid)", () => {
    const Cls = triggerHandlerRegistry.lookup("Always");
    if (!Cls) return;
    const ta = new Cls().build(mkAst(), mkCtx());
    expect(
      ta.matches(mkEvent("ContinuousEffectRegistered", 1, PhaseStep.Main1, { effectId: mkEntityId(12) })),
    ).toBe(false);
    expect(
      ta.matches(mkEvent("ContinuousEffectExpired", 1, PhaseStep.Main1, { effectId: mkEntityId(12) })),
    ).toBe(false);
    expect(
      ta.matches(
        mkEvent("CostPaid", 1, PhaseStep.Main1, {
          stackItemId: mkEntityId(13),
          payerSeat: CONTROLLER,
        }),
      ),
    ).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Wave 14b — IsPresent$ predicate gating
  // -------------------------------------------------------------------------

  describe("IsPresent$ predicate (Wave 14b)", () => {
    const LAND_ID = mkEntityId(200);
    const OPP = mkPlayerSeat(1);

    const mkLand = (controllerSeat: ReturnType<typeof mkPlayerSeat>) =>
      ({
        id: LAND_ID,
        zone: ZoneType.Battlefield,
        controllerSeat,
        tapped: false,
        paperCard: {
          definition: {
            types: {
              has: (t: string) => t === CardType.Land,
              hasSubtype: () => false,
            },
          },
          name: "Forest",
        },
      }) as never;

    const mkPresentAst = (raw: string): TriggerAst => ({
      mode: "Always",
      params: { IsPresent: { kind: "literal", raw } },
      effect: { handlerKey: "TrigSac", params: {} },
    });

    const mkGameWithCards = (cards: Map<number, unknown>): { cards: Map<number, unknown> } => ({ cards });

    it("matches when ≥1 Land.YouCtrl is on the controller's battlefield", () => {
      const Cls = triggerHandlerRegistry.lookup("Always");
      if (!Cls) return;
      const cards = new Map<number, unknown>([[LAND_ID as number, mkLand(CONTROLLER)]]);
      const game = mkGameWithCards(cards);
      const ta = new Cls().build(mkPresentAst("Land.YouCtrl"), {
        game: game as never,
        sourceCardId: SOURCE_ID,
        controllerSeat: CONTROLLER,
        triggerId: TRIGGER_ID,
      });
      const event = mkEvent("CardTapped", 1, PhaseStep.Main1, { cardId: mkEntityId(99) });
      expect(ta.matches(event)).toBe(true);
    });

    it("does NOT match when no Land.YouCtrl is on the battlefield", () => {
      const Cls = triggerHandlerRegistry.lookup("Always");
      if (!Cls) return;
      const cards = new Map<number, unknown>(); // empty battlefield
      const game = mkGameWithCards(cards);
      const ta = new Cls().build(mkPresentAst("Land.YouCtrl"), {
        game: game as never,
        sourceCardId: SOURCE_ID,
        controllerSeat: CONTROLLER,
        triggerId: TRIGGER_ID,
      });
      const event = mkEvent("CardTapped", 1, PhaseStep.Main1, { cardId: mkEntityId(99) });
      expect(ta.matches(event)).toBe(false);
    });

    it("does NOT match when the only Land is opponent-controlled (Land.YouCtrl)", () => {
      const Cls = triggerHandlerRegistry.lookup("Always");
      if (!Cls) return;
      const cards = new Map<number, unknown>([[LAND_ID as number, mkLand(OPP)]]);
      const game = mkGameWithCards(cards);
      const ta = new Cls().build(mkPresentAst("Land.YouCtrl"), {
        game: game as never,
        sourceCardId: SOURCE_ID,
        controllerSeat: CONTROLLER,
        triggerId: TRIGGER_ID,
      });
      const event = mkEvent("CardTapped", 1, PhaseStep.Main1, { cardId: mkEntityId(99) });
      expect(ta.matches(event)).toBe(false);
    });

    it("absent IsPresent$ keeps the legacy match-all behaviour", () => {
      const Cls = triggerHandlerRegistry.lookup("Always");
      if (!Cls) return;
      const ta = new Cls().build(mkAst(), mkCtx());
      const event = mkEvent("CardTapped", 1, PhaseStep.Main1, { cardId: mkEntityId(99) });
      expect(ta.matches(event)).toBe(true);
    });
  });
});
