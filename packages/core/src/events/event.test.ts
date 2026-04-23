// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { mkEntityId, mkPlayerSeat } from "../ids.js";
import { PhaseStep } from "../phase.js";
import { ZoneType } from "../zone.js";
import { type GameEvent, type GameEventKind, isEvent, mkEvent } from "./event.js";

// WHY: every expected kind enumerated here — any accidental rename or
// deletion in event.ts trips the exhaustiveness assertion below.
const EXPECTED_KINDS: readonly GameEventKind[] = [
  // Zone change (10)
  "CardDrawn",
  "CardDiscarded",
  "CardMilled",
  "CardDestroyed",
  "CardExiled",
  "CardSacrificed",
  "CardReturned",
  "CardCycled",
  "CardForetold",
  "CardChangedZone",
  // State change (12)
  "LifeChanged",
  "CounterAdded",
  "CounterRemoved",
  "CardTapped",
  "CardUntapped",
  "ControlChanged",
  "AttachmentChanged",
  "PhasedOut",
  "PhasedIn",
  "Flipped",
  "Transformed",
  "FaceDownStateChanged",
  // Monarch/Initiative/Ring (5)
  "BecameMonarch",
  "LostMonarch",
  "BecameInitiative",
  "RingTempted",
  "RingLevelChanged",
  // Stack (8)
  "SpellCast",
  "SpellPutOnStack",
  "AbilityActivated",
  "AbilityTriggered",
  "StackItemResolving",
  "StackItemResolved",
  "StackItemCountered",
  "StackItemCopied",
  // Combat (10)
  "CombatStarted",
  "AttackersDeclared",
  "BlockersDeclared",
  "BlockerOrderSet",
  "DamageAssigned",
  "DamageDealt",
  "DamagePrevented",
  "AttackerBecomesBlocked",
  "CombatEnded",
  "CombatCreatureDied",
  // Phase (5)
  "TurnStarted",
  "TurnEnded",
  "PhaseStarted",
  "StepStarted",
  "StepEnded",
  // Player (8)
  "PlayerLifeChanged",
  "PlayerDrew",
  "PlayerDiscarded",
  "PlayerMilled",
  "PlayerLost",
  "PlayerWon",
  "PlayerConceded",
  "CityBlessingGained",
  // Meta (5)
  "GameStarted",
  "MulliganTaken",
  "GameEnded",
  "CastAborted",
  "ShortcutApplied",
];

describe("GameEvent enumeration", () => {
  it("has 63 distinct kinds grouped across 8 families", () => {
    expect(EXPECTED_KINDS.length).toBe(63);
    expect(new Set(EXPECTED_KINDS).size).toBe(63);
  });
});

describe("mkEvent — family representatives", () => {
  it("builds a Zone-change event (CardDrawn) with correct envelope + payload", () => {
    const e = mkEvent("CardDrawn", 1, PhaseStep.Draw, {
      playerSeat: mkPlayerSeat(0),
      cardId: mkEntityId(42),
    });
    expect(e.kind).toBe("CardDrawn");
    expect(e.version).toBe(1);
    expect(e.turn).toBe(1);
    expect(e.phase).toBe(PhaseStep.Draw);
    expect(e.payload.playerSeat).toBe(mkPlayerSeat(0));
    expect(e.payload.cardId).toBe(mkEntityId(42));

    const round = JSON.parse(JSON.stringify(e)) as GameEvent;
    expect(round).toEqual(e);
  });

  it("builds a State-change event (LifeChanged)", () => {
    const e = mkEvent("LifeChanged", 3, PhaseStep.Upkeep, {
      playerSeat: mkPlayerSeat(1),
      oldLife: 20,
      newLife: 17,
      delta: -3,
      cause: "damage",
    });
    expect(e.kind).toBe("LifeChanged");
    expect(e.payload.delta).toBe(-3);
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });

  it("builds a Monarch/Ring event (RingLevelChanged)", () => {
    const e = mkEvent("RingLevelChanged", 5, PhaseStep.PreCombatMain, {
      playerSeat: mkPlayerSeat(0),
      oldLevel: 1,
      newLevel: 2,
    });
    expect(e.kind).toBe("RingLevelChanged");
    expect(e.payload.newLevel).toBe(2);
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });

  it("builds a Stack event (SpellCast) with optional xValue", () => {
    const e = mkEvent("SpellCast", 2, PhaseStep.PreCombatMain, {
      stackItemId: mkEntityId(100),
      cardId: mkEntityId(7),
      controllerSeat: mkPlayerSeat(0),
      xValue: 4,
    });
    expect(e.kind).toBe("SpellCast");
    expect(e.payload.xValue).toBe(4);
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });

  it("builds a Combat event (DamageDealt) with tagged target", () => {
    const e = mkEvent("DamageDealt", 4, PhaseStep.CombatDamage, {
      sourceId: mkEntityId(11),
      targetKind: "player",
      targetId: mkPlayerSeat(1),
      amount: 3,
      isCombat: true,
    });
    expect(e.kind).toBe("DamageDealt");
    expect(e.payload.targetKind).toBe("player");
    expect(e.payload.isCombat).toBe(true);
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });

  it("builds a Combat event (DamagePrevented) with tagged target and preventor", () => {
    const e = mkEvent("DamagePrevented", 4, PhaseStep.CombatDamage, {
      sourceId: mkEntityId(11),
      targetKind: "creature",
      targetId: mkEntityId(12),
      amount: 2,
      preventorId: mkEntityId(99),
    });
    expect(e.kind).toBe("DamagePrevented");
    expect(e.payload.targetKind).toBe("creature");
    expect(e.payload.preventorId).toBe(mkEntityId(99));
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });

  it("builds a Combat event (AttackersDeclared) with nested defender union", () => {
    const e = mkEvent("AttackersDeclared", 2, PhaseStep.DeclareAttackers, {
      attackingSeat: mkPlayerSeat(0),
      attackers: [
        { attackerId: mkEntityId(30), defender: { kind: "player", seat: mkPlayerSeat(1) } },
        { attackerId: mkEntityId(31), defender: { kind: "planeswalker", id: mkEntityId(77) } },
      ],
    });
    expect(e.payload.attackers.length).toBe(2);
    expect(e.payload.attackers[0]?.defender.kind).toBe("player");
    expect(e.payload.attackers[1]?.defender.kind).toBe("planeswalker");
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });

  it("builds a Phase event (StepStarted)", () => {
    const e = mkEvent("StepStarted", 1, PhaseStep.Upkeep, {
      activeSeat: mkPlayerSeat(0),
      step: PhaseStep.Upkeep,
    });
    expect(e.kind).toBe("StepStarted");
    expect(e.payload.step).toBe(PhaseStep.Upkeep);
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });

  it("builds a Player event (PlayerLost) with reason enum", () => {
    const e = mkEvent("PlayerLost", 8, PhaseStep.EndStep, {
      playerSeat: mkPlayerSeat(1),
      reason: "life",
    });
    expect(e.kind).toBe("PlayerLost");
    expect(e.payload.reason).toBe("life");
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });

  it("builds a Meta event (GameStarted) with optional seed", () => {
    const e = mkEvent("GameStarted", 0, PhaseStep.Untap, {
      seats: [mkPlayerSeat(0), mkPlayerSeat(1)],
      firstPlayer: mkPlayerSeat(0),
      seed: "deadbeefcafebabe",
    });
    expect(e.kind).toBe("GameStarted");
    expect(e.payload.seats.length).toBe(2);
    expect(e.payload.seed).toBe("deadbeefcafebabe");
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });

  it("builds a zone-agnostic fallback (CardChangedZone) with all optional fields", () => {
    const e = mkEvent("CardChangedZone", 1, PhaseStep.PreCombatMain, {
      cardId: mkEntityId(5),
      fromZone: ZoneType.Hand,
      toZone: ZoneType.Graveyard,
      fromSeat: mkPlayerSeat(0),
      toSeat: mkPlayerSeat(0),
      cause: "discard",
    });
    expect(e.payload.fromZone).toBe(ZoneType.Hand);
    expect(e.payload.toZone).toBe(ZoneType.Graveyard);
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });
});

describe("isEvent type guard", () => {
  it("narrows a GameEvent to a specific variant", () => {
    const e: GameEvent = mkEvent("CardDrawn", 1, PhaseStep.Draw, {
      playerSeat: mkPlayerSeat(0),
      cardId: mkEntityId(99),
    });
    if (isEvent(e, "CardDrawn")) {
      // Compiler should permit `.payload.cardId` here without a cast.
      expect(e.payload.cardId).toBe(mkEntityId(99));
    } else {
      throw new Error("isEvent should have matched");
    }
    expect(isEvent(e, "LifeChanged")).toBe(false);
  });
});

describe("mkEvent — compile-time payload checking", () => {
  it("rejects malformed payloads at the type level", () => {
    // @ts-expect-error payload missing cardId
    mkEvent("CardDrawn", 1, PhaseStep.Draw, { playerSeat: mkPlayerSeat(0) });
    // Bad literal `cause`: directive must live on the offending line itself
    // because TS attributes the error to the object-literal property, not the
    // outer call expression.
    mkEvent("CardDiscarded", 1, PhaseStep.Draw, {
      playerSeat: mkPlayerSeat(0),
      cardId: mkEntityId(1),
      // @ts-expect-error wrong cause value
      cause: "nope",
    });
    // Sanity: runtime path still constructs a valid CardDrawn when payload is
    // correct — keeps vitest from treating the suppressed lines as dead code.
    expect(
      mkEvent("CardDrawn", 1, PhaseStep.Draw, {
        playerSeat: mkPlayerSeat(0),
        cardId: mkEntityId(1),
      }).kind,
    ).toBe("CardDrawn");
  });
});
