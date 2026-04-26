// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 19 — final corpus unknown triggers. Smoke + minimal match assertions
// for all 20 new handlers.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
// Side-effect import — registers all Wave 19 handlers.
import "./index.js";

const SOURCE_ID = mkEntityId(500);
const OTHER_ID = mkEntityId(501);
const TRIGGER_ID = mkEntityId(700);
const CONTROLLER = mkPlayerSeat(0);

let fakeTurn = 1;
const mkCtx = (): TriggerBuildContext => ({
  game: {
    get turn() {
      return fakeTurn;
    },
  } as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  triggerId: TRIGGER_ID,
});

const mkAst = (mode: string, executeKey = "TrigEffect"): TriggerAst => ({
  mode,
  params: {},
  effect: { handlerKey: executeKey, params: {} },
});

const buildTrigger = (mode: string) => {
  const Cls = triggerHandlerRegistry.lookup(mode);
  if (!Cls) throw new Error(`No handler for mode ${mode}`);
  return new Cls().build(mkAst(mode), mkCtx());
};

describe("Wave 19 — handler registration", () => {
  it("registers all 20 handlers", () => {
    for (const mode of [
      "DiscardedAll",
      "CounterAddedAll",
      "CounterRemovedOnce",
      "UnlockDoor",
      "DayTimeChanges",
      "ManaAdded",
      "AbilityTriggered",
      "ExcessDamage",
      "CounterAdded",
      "LifeLost",
      "Surveil",
      "LosesGame",
      "Abandoned",
      "RolledDieOnce",
      "DamageAll",
      "SacrificedOnce",
      "Saddled",
      "Crewed",
      "Unattach",
      "CaseSolved",
    ]) {
      expect(triggerHandlerRegistry.has(mode)).toBe(true);
    }
  });
});

describe("DiscardedAllTrigger", () => {
  it("matches DiscardedAll", () => {
    const ta = buildTrigger("DiscardedAll");
    const ev = mkEvent("DiscardedAll", 1, PhaseStep.Main1, {
      playerSeat: CONTROLLER,
      cardIds: [OTHER_ID],
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("CounterAddedAllTrigger", () => {
  it("matches CounterAdded events", () => {
    const ta = buildTrigger("CounterAddedAll");
    const ev = mkEvent("CounterAdded", 1, PhaseStep.Main1, {
      cardId: OTHER_ID,
      counterType: "+1/+1",
      amount: 1,
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("CounterRemovedOnceTrigger", () => {
  it("fires once per turn", () => {
    fakeTurn = 1;
    const ta = buildTrigger("CounterRemovedOnce");
    const ev = mkEvent("CounterRemoved", 1, PhaseStep.Main1, {
      cardId: OTHER_ID,
      counterType: "+1/+1",
      amount: 1,
    });
    expect(ta.matches(ev)).toBe(true);
    expect(ta.matches(ev)).toBe(false); // same turn, suppressed
    fakeTurn = 2;
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("UnlockDoorTrigger", () => {
  it("matches DoorOpened on self", () => {
    const ta = buildTrigger("UnlockDoor");
    const ev = mkEvent("DoorOpened", 1, PhaseStep.Main1, { cardId: SOURCE_ID });
    expect(ta.matches(ev)).toBe(true);
  });
  it("does not match other card's door", () => {
    const ta = buildTrigger("UnlockDoor");
    const ev = mkEvent("DoorOpened", 1, PhaseStep.Main1, { cardId: OTHER_ID });
    expect(ta.matches(ev)).toBe(false);
  });
});

describe("DayTimeChangesTrigger", () => {
  it("matches DayTimeChanged", () => {
    const ta = buildTrigger("DayTimeChanges");
    const ev = mkEvent("DayTimeChanged", 1, PhaseStep.Main1, {
      oldValue: "day",
      newValue: "night",
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("ManaAddedTrigger", () => {
  it("matches ManaAdded", () => {
    const ta = buildTrigger("ManaAdded");
    const ev = mkEvent("ManaAdded", 1, PhaseStep.Main1, {
      playerSeat: CONTROLLER,
      amount: 1,
      color: null,
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("AbilityTriggeredTrigger", () => {
  it("matches AbilityTriggered", () => {
    const ta = buildTrigger("AbilityTriggered");
    const ev = mkEvent("AbilityTriggered", 1, PhaseStep.Main1, {
      stackItemId: OTHER_ID,
      sourceCardId: OTHER_ID,
      controllerSeat: CONTROLLER,
      triggerMode: "etb",
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("ExcessDamageTrigger", () => {
  it("matches ExcessDamage", () => {
    const ta = buildTrigger("ExcessDamage");
    const ev = mkEvent("ExcessDamage", 1, PhaseStep.Main1, {
      sourceId: OTHER_ID,
      targetKind: "creature",
      targetId: SOURCE_ID,
      amount: 3,
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("CounterAddedTrigger", () => {
  it("matches CounterAdded", () => {
    const ta = buildTrigger("CounterAdded");
    const ev = mkEvent("CounterAdded", 1, PhaseStep.Main1, {
      cardId: OTHER_ID,
      counterType: "+1/+1",
      amount: 1,
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("LifeLostTrigger", () => {
  it("matches LifeLost event", () => {
    const ta = buildTrigger("LifeLost");
    const ev = mkEvent("LifeLost", 1, PhaseStep.Main1, {
      playerSeat: CONTROLLER,
      amount: 2,
    });
    expect(ta.matches(ev)).toBe(true);
  });
  it("matches LifeChanged with negative delta", () => {
    const ta = buildTrigger("LifeLost");
    const ev = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
      playerSeat: CONTROLLER,
      oldLife: 20,
      newLife: 18,
      delta: -2,
      cause: "damage",
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("SurveilTrigger", () => {
  it("matches Surveil", () => {
    const ta = buildTrigger("Surveil");
    const ev = mkEvent("Surveil", 1, PhaseStep.Main1, {
      playerSeat: CONTROLLER,
      count: 1,
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("LosesGameTrigger", () => {
  it("matches PlayerLost", () => {
    const ta = buildTrigger("LosesGame");
    const ev = mkEvent("PlayerLost", 1, PhaseStep.Main1, {
      playerSeat: CONTROLLER,
      reason: "life",
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("AbandonedTrigger", () => {
  it("matches Abandoned", () => {
    const ta = buildTrigger("Abandoned");
    const ev = mkEvent("Abandoned", 1, PhaseStep.Main1, {
      schemeCardId: SOURCE_ID,
      archenemySeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("RolledDieOnceTrigger", () => {
  it("fires once per turn", () => {
    fakeTurn = 5;
    const ta = buildTrigger("RolledDieOnce");
    const ev = mkEvent("RollDie", 5, PhaseStep.Main1, {
      playerSeat: CONTROLLER,
      sides: 6,
      result: 4,
    });
    expect(ta.matches(ev)).toBe(true);
    expect(ta.matches(ev)).toBe(false);
  });
});

describe("DamageAllTrigger", () => {
  it("matches DamageDealtAll", () => {
    const ta = buildTrigger("DamageAll");
    const ev = mkEvent("DamageDealtAll", 1, PhaseStep.Main1, {
      sourceId: OTHER_ID,
      targetIds: [],
      amount: 1,
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("SacrificedOnceTrigger", () => {
  it("fires once per turn", () => {
    fakeTurn = 7;
    const ta = buildTrigger("SacrificedOnce");
    const ev = mkEvent("CardSacrificed", 7, PhaseStep.Main1, {
      cardId: OTHER_ID,
      playerSeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(true);
    expect(ta.matches(ev)).toBe(false);
  });
});

describe("SaddledTrigger", () => {
  it("matches Saddled on self", () => {
    const ta = buildTrigger("Saddled");
    const ev = mkEvent("Saddled", 1, PhaseStep.Main1, {
      mountId: SOURCE_ID,
      riderIds: [OTHER_ID],
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("CrewedTrigger", () => {
  it("matches Crewed on self", () => {
    const ta = buildTrigger("Crewed");
    const ev = mkEvent("Crewed", 1, PhaseStep.Main1, {
      vehicleId: SOURCE_ID,
      crewIds: [OTHER_ID],
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("UnattachTrigger", () => {
  it("matches CardUnattached", () => {
    const ta = buildTrigger("Unattach");
    const ev = mkEvent("CardUnattached", 1, PhaseStep.Main1, {
      sourceId: OTHER_ID,
      reason: "effect",
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("CaseSolvedTrigger", () => {
  it("matches CaseSolved on self", () => {
    const ta = buildTrigger("CaseSolved");
    const ev = mkEvent("CaseSolved", 1, PhaseStep.Main1, {
      cardId: SOURCE_ID,
      playerSeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(true);
  });
});
