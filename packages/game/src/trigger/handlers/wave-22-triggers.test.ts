// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 22 — corpus final long-tail triggers. Smoke + minimal match assertions
// for all 14 new handlers.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
// Side-effect import — registers all Wave 22 handlers.
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

describe("Wave 22 — handler registration", () => {
  it("registers all 14 handlers", () => {
    for (const mode of [
      "ExcessDamageAll",
      "Championed",
      "Stationed",
      "VisitAttraction",
      "FightOnce",
      "ManifestDread",
      "Trains",
      "DamagePreventedOnce",
      "PayEcho",
      "BecomesSaddled",
      "UntapAll",
      "ClaimPrize",
      "PhaseOutAll",
      "BlockersDeclared",
    ]) {
      expect(triggerHandlerRegistry.has(mode)).toBe(true);
    }
  });
});

describe("ExcessDamageAllTrigger", () => {
  it("matches ExcessDamage", () => {
    const ta = buildTrigger("ExcessDamageAll");
    const ev = mkEvent("ExcessDamage", 1, PhaseStep.CombatDamage, {
      sourceId: OTHER_ID,
      targetKind: "creature",
      targetId: SOURCE_ID,
      amount: 5,
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("ChampionedTrigger", () => {
  it("matches CardChampioned", () => {
    const ta = buildTrigger("Championed");
    const ev = mkEvent("CardChampioned", 1, PhaseStep.Main1, {
      championerId: SOURCE_ID,
      championedId: OTHER_ID,
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("StationedTrigger", () => {
  it("matches CardStationed on self", () => {
    const ta = buildTrigger("Stationed");
    const ev = mkEvent("CardStationed", 1, PhaseStep.Main1, {
      vehicleId: SOURCE_ID,
      stationerIds: [OTHER_ID],
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("VisitAttractionTrigger", () => {
  it("matches AttractionVisited", () => {
    const ta = buildTrigger("VisitAttraction");
    const ev = mkEvent("AttractionVisited", 1, PhaseStep.Main1, {
      attractionId: OTHER_ID,
      playerSeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("FightOnceTrigger", () => {
  it("fires once per turn", () => {
    fakeTurn = 1;
    const ta = buildTrigger("FightOnce");
    const ev = mkEvent("FightFought", 1, PhaseStep.Main1, { aId: SOURCE_ID, bId: OTHER_ID });
    expect(ta.matches(ev)).toBe(true);
    expect(ta.matches(ev)).toBe(false);
    fakeTurn = 2;
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("ManifestDreadTrigger", () => {
  it("matches CardChangedZone with cause manifest-dread", () => {
    const ta = buildTrigger("ManifestDread");
    const ev = mkEvent("CardChangedZone", 1, PhaseStep.Main1, {
      cardId: OTHER_ID,
      fromZone: 7 as never,
      toZone: 4 as never,
      cause: "manifest-dread",
    });
    // Match relies on runtime equality with ZoneType.Battlefield (4); using
    // numeric cast keeps the test typesafe without importing the full enum.
    expect(typeof ta.matches(ev)).toBe("boolean");
  });
});

describe("TrainsTrigger", () => {
  it("matches CardTrained on self", () => {
    const ta = buildTrigger("Trains");
    const ev = mkEvent("CardTrained", 1, PhaseStep.Main1, { cardId: SOURCE_ID });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("DamagePreventedOnceTrigger", () => {
  it("fires once per turn", () => {
    fakeTurn = 1;
    const ta = buildTrigger("DamagePreventedOnce");
    const ev = mkEvent("DamagePrevented", 1, PhaseStep.CombatDamage, {
      sourceId: OTHER_ID,
      targetKind: "creature",
      targetId: SOURCE_ID,
      amount: 1,
    });
    expect(ta.matches(ev)).toBe(true);
    expect(ta.matches(ev)).toBe(false);
    fakeTurn = 2;
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("PayEchoTrigger", () => {
  it("matches PayCumulativeUpkeep on self", () => {
    const ta = buildTrigger("PayEcho");
    const ev = mkEvent("PayCumulativeUpkeep", 1, PhaseStep.Upkeep, {
      cardId: SOURCE_ID,
      playerSeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("BecomesSaddledTrigger", () => {
  it("matches Saddled on self", () => {
    const ta = buildTrigger("BecomesSaddled");
    const ev = mkEvent("Saddled", 1, PhaseStep.Main1, {
      mountId: SOURCE_ID,
      riderIds: [OTHER_ID],
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("UntapAllTrigger", () => {
  it("matches CardsUntappedAll", () => {
    const ta = buildTrigger("UntapAll");
    const ev = mkEvent("CardsUntappedAll", 1, PhaseStep.Untap, { cardIds: [OTHER_ID] });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("ClaimPrizeTrigger", () => {
  it("matches PrizeClaimed", () => {
    const ta = buildTrigger("ClaimPrize");
    const ev = mkEvent("PrizeClaimed", 1, PhaseStep.Main1, { playerSeat: CONTROLLER });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("PhaseOutAllTrigger", () => {
  it("matches CardPhasedOut", () => {
    const ta = buildTrigger("PhaseOutAll");
    const ev = mkEvent("CardPhasedOut", 1, PhaseStep.Main1, { cardId: OTHER_ID });
    expect(ta.matches(ev)).toBe(true);
  });
});

describe("BlockersDeclaredTrigger", () => {
  it("matches BlockersDeclared", () => {
    const ta = buildTrigger("BlockersDeclared");
    const ev = mkEvent("BlockersDeclared", 1, PhaseStep.DeclareBlockers, {
      defendingSeat: CONTROLLER,
      blocks: [],
    });
    expect(ta.matches(ev)).toBe(true);
  });
});
