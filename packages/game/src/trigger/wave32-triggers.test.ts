// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 32 — smoke tests for Battalion / Constellation / Revolt trigger
// gates added to AttacksTrigger and ChangesZoneTrigger. Each test stubs
// just enough Game shape (cards Map, flags map) to drive the handler's
// `matches()` predicate; full registration / resolution coverage lives
// in the subsystem tests.
import type { TriggerAst } from "@mtg-forge-ts/core";
import { CardType, PhaseStep, ZoneType, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { AttacksTrigger } from "./handlers/attacks-trigger.js";
import { ChangesZoneTrigger } from "./handlers/changes-zone-trigger.js";

const SOURCE_ID = mkEntityId(40);
const ATTACKER_2 = mkEntityId(41);
const ATTACKER_3 = mkEntityId(42);
const OTHER_CARD = mkEntityId(43);
const TRIGGER_ID = mkEntityId(2);
const CONTROLLER = mkPlayerSeat(0);
const OPPONENT = mkPlayerSeat(1);

interface StubCard {
  readonly id: ReturnType<typeof mkEntityId>;
  readonly zone: ZoneType;
  readonly controllerSeat: ReturnType<typeof mkPlayerSeat>;
  readonly tapped: boolean;
  readonly paperCard: {
    readonly definition: {
      readonly types: { has: (t: string) => boolean; hasSubtype: (s: string) => boolean };
    };
    readonly name: string;
  };
}

const mkCreature = (
  id: ReturnType<typeof mkEntityId>,
  controllerSeat: ReturnType<typeof mkPlayerSeat>,
): StubCard => ({
  id,
  zone: ZoneType.Battlefield,
  controllerSeat,
  tapped: false,
  paperCard: {
    definition: {
      types: {
        has: (t: string) => t === CardType.Creature,
        hasSubtype: () => false,
      },
    },
    name: `Creature-${id as number}`,
  },
});

const mkEnchantment = (
  id: ReturnType<typeof mkEntityId>,
  controllerSeat: ReturnType<typeof mkPlayerSeat>,
): StubCard => ({
  id,
  zone: ZoneType.Battlefield,
  controllerSeat,
  tapped: false,
  paperCard: {
    definition: {
      types: {
        has: (t: string) => t === CardType.Enchantment,
        hasSubtype: () => false,
      },
    },
    name: `Enchant-${id as number}`,
  },
});

const mkGameStub = (
  cards: ReadonlyArray<StubCard>,
  permanentsLeft: ReadonlyMap<ReturnType<typeof mkPlayerSeat>, number> = new Map(),
) => {
  const cardMap = new Map<number, StubCard>();
  for (const c of cards) cardMap.set(c.id as number, c);
  return {
    cards: cardMap,
    flags: { permanentsLeftBfThisTurn: new Map(permanentsLeft) },
  } as never;
};

const mkAttackersDeclared = (
  attackerIds: ReadonlyArray<ReturnType<typeof mkEntityId>>,
  attackingSeat: ReturnType<typeof mkPlayerSeat> = CONTROLLER,
) =>
  mkEvent("AttackersDeclared", 1, PhaseStep.DeclareAttackers, {
    attackingSeat,
    attackers: attackerIds.map((id) => ({
      attackerId: id,
      defender: { kind: "player" as const, seat: OPPONENT },
    })),
  });

const mkCardChangedZone = (cardId: ReturnType<typeof mkEntityId>, fromZone: ZoneType, toZone: ZoneType) =>
  mkEvent("CardChangedZone", 1, PhaseStep.Main1, {
    cardId,
    fromZone,
    toZone,
  });

describe("Wave 32 — Battalion via AttacksTrigger IsPresent$/PresentCompare$", () => {
  const battalionAst: TriggerAst = {
    mode: "Attacks",
    params: {
      ValidCard: { kind: "literal", raw: "Card.Self" },
      IsPresent: { kind: "literal", raw: "Creature.attacking+Other" },
      PresentCompare: { kind: "literal", raw: "GE2" },
    },
    effect: { handlerKey: "TrigPump", params: {} },
  };

  it("fires when self + at least 2 OTHER creatures attack", () => {
    const game = mkGameStub([
      mkCreature(SOURCE_ID, CONTROLLER),
      mkCreature(ATTACKER_2, CONTROLLER),
      mkCreature(ATTACKER_3, CONTROLLER),
    ]);
    const ta = new AttacksTrigger().build(battalionAst, {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      triggerId: TRIGGER_ID,
    });
    expect(ta.matches(mkAttackersDeclared([SOURCE_ID, ATTACKER_2, ATTACKER_3]))).toBe(true);
  });

  it("does NOT fire when only self + 1 other creature attacks (GE2 unsatisfied)", () => {
    const game = mkGameStub([mkCreature(SOURCE_ID, CONTROLLER), mkCreature(ATTACKER_2, CONTROLLER)]);
    const ta = new AttacksTrigger().build(battalionAst, {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      triggerId: TRIGGER_ID,
    });
    expect(ta.matches(mkAttackersDeclared([SOURCE_ID, ATTACKER_2]))).toBe(false);
  });

  it("does NOT fire when self does not attack (ValidCard$ Card.Self fails)", () => {
    const game = mkGameStub([
      mkCreature(SOURCE_ID, CONTROLLER),
      mkCreature(ATTACKER_2, CONTROLLER),
      mkCreature(ATTACKER_3, CONTROLLER),
    ]);
    const ta = new AttacksTrigger().build(battalionAst, {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      triggerId: TRIGGER_ID,
    });
    // Self not attacking — ValidCard$ Card.Self short-circuits to false.
    expect(ta.matches(mkAttackersDeclared([ATTACKER_2, ATTACKER_3]))).toBe(false);
  });
});

describe("Wave 32 — Constellation via ChangesZoneTrigger comma-OR ValidCard$", () => {
  const constellationAst: TriggerAst = {
    mode: "ChangesZone",
    params: {
      Origin: { kind: "literal", raw: "Any" },
      Destination: { kind: "literal", raw: "Battlefield" },
      ValidCard: { kind: "literal", raw: "Card.Self,Enchantment.Other+YouCtrl" },
    },
    effect: { handlerKey: "TrigDraw", params: {} },
  };

  it("fires when SELF enters the battlefield (first comma alternative)", () => {
    const game = mkGameStub([mkEnchantment(SOURCE_ID, CONTROLLER)]);
    const ta = new ChangesZoneTrigger().build(constellationAst, {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      triggerId: TRIGGER_ID,
    });
    expect(ta.matches(mkCardChangedZone(SOURCE_ID, ZoneType.Hand, ZoneType.Battlefield))).toBe(true);
  });

  it("fires when ANOTHER enchantment YouCtrl enters (second alternative)", () => {
    const game = mkGameStub([mkEnchantment(SOURCE_ID, CONTROLLER), mkEnchantment(OTHER_CARD, CONTROLLER)]);
    const ta = new ChangesZoneTrigger().build(constellationAst, {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      triggerId: TRIGGER_ID,
    });
    expect(ta.matches(mkCardChangedZone(OTHER_CARD, ZoneType.Hand, ZoneType.Battlefield))).toBe(true);
  });

  it("does NOT fire when an opponent's enchantment enters (YouCtrl filter)", () => {
    const game = mkGameStub([mkEnchantment(SOURCE_ID, CONTROLLER), mkEnchantment(OTHER_CARD, OPPONENT)]);
    const ta = new ChangesZoneTrigger().build(constellationAst, {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      triggerId: TRIGGER_ID,
    });
    expect(ta.matches(mkCardChangedZone(OTHER_CARD, ZoneType.Hand, ZoneType.Battlefield))).toBe(false);
  });

  it("does NOT fire when a non-enchantment creature enters", () => {
    const game = mkGameStub([mkEnchantment(SOURCE_ID, CONTROLLER), mkCreature(OTHER_CARD, CONTROLLER)]);
    const ta = new ChangesZoneTrigger().build(constellationAst, {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      triggerId: TRIGGER_ID,
    });
    expect(ta.matches(mkCardChangedZone(OTHER_CARD, ZoneType.Hand, ZoneType.Battlefield))).toBe(false);
  });
});

describe("Wave 32 — Revolt$ True gate via permanentsLeftBfThisTurn", () => {
  const revoltAst: TriggerAst = {
    mode: "ChangesZone",
    params: {
      Origin: { kind: "literal", raw: "Any" },
      Destination: { kind: "literal", raw: "Battlefield" },
      ValidCard: { kind: "literal", raw: "Card.Self" },
      Revolt: { kind: "literal", raw: "True" },
    },
    effect: { handlerKey: "TrigDestroy", params: {} },
  };

  it("does NOT fire on ETB when no permanent left BF this turn", () => {
    const game = mkGameStub([mkCreature(SOURCE_ID, CONTROLLER)]);
    const ta = new ChangesZoneTrigger().build(revoltAst, {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      triggerId: TRIGGER_ID,
    });
    expect(ta.matches(mkCardChangedZone(SOURCE_ID, ZoneType.Hand, ZoneType.Battlefield))).toBe(false);
  });

  it("fires when controller's permanentsLeftBfThisTurn ≥ 1", () => {
    const game = mkGameStub([mkCreature(SOURCE_ID, CONTROLLER)], new Map([[CONTROLLER, 1]]));
    const ta = new ChangesZoneTrigger().build(revoltAst, {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      triggerId: TRIGGER_ID,
    });
    expect(ta.matches(mkCardChangedZone(SOURCE_ID, ZoneType.Hand, ZoneType.Battlefield))).toBe(true);
  });

  it("does NOT fire when only an opponent's permanent left BF (per-controller scope)", () => {
    const game = mkGameStub([mkCreature(SOURCE_ID, CONTROLLER)], new Map([[OPPONENT, 1]]));
    const ta = new ChangesZoneTrigger().build(revoltAst, {
      game,
      sourceCardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
      triggerId: TRIGGER_ID,
    });
    expect(ta.matches(mkCardChangedZone(SOURCE_ID, ZoneType.Hand, ZoneType.Battlefield))).toBe(false);
  });
});
