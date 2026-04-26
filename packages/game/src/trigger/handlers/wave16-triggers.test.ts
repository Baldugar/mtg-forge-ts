// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 16 — corpus unknown triggers. One spec-style file covering registration
// + minimal match/no-match for all 19 new handlers (DamageDealtOnce already
// covered by damage-done-once-trigger.test.ts in Wave 12).
import type { TriggerAst } from "@mtg-forge-ts/core";
import { Color, PhaseStep, mkEntityId, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
// Side-effect import — registers all Wave 16 handlers.
import "./index.js";

const SOURCE_ID = mkEntityId(500);
const OTHER_ID = mkEntityId(501);
const TRIGGER_ID = mkEntityId(700);
const CONTROLLER = mkPlayerSeat(0);
const OPPONENT = mkPlayerSeat(1);

const mkCtx = (): TriggerBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: CONTROLLER,
  triggerId: TRIGGER_ID,
});

const mkAst = (mode: string, params: Record<string, string> = {}, executeKey = "TrigEffect"): TriggerAst => ({
  mode,
  params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, { kind: "literal", raw: v }])),
  effect: { handlerKey: executeKey, params: {} },
});

const buildTrigger = (mode: string, params: Record<string, string> = {}) => {
  const Cls = triggerHandlerRegistry.lookup(mode);
  if (!Cls) throw new Error(`No handler for mode ${mode}`);
  return new Cls().build(mkAst(mode, params), mkCtx());
};

// ---------------------------------------------------------------------------
// 1) CrankContraption
// ---------------------------------------------------------------------------
describe("CrankContraptionTrigger", () => {
  it("is registered", () => {
    expect(triggerHandlerRegistry.has("CrankContraption")).toBe(true);
  });
  it("matches CardCranked for self", () => {
    const ta = buildTrigger("CrankContraption");
    const ev = mkEvent("CardCranked", 1, PhaseStep.Main1, {
      cardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(true);
  });
  it("does NOT match other card with Card.Self", () => {
    const ta = buildTrigger("CrankContraption");
    const ev = mkEvent("CardCranked", 1, PhaseStep.Main1, {
      cardId: OTHER_ID,
      controllerSeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2) PlaneswalkedTo
// ---------------------------------------------------------------------------
describe("PlaneswalkedToTrigger", () => {
  it("is registered", () => {
    expect(triggerHandlerRegistry.has("PlaneswalkedTo")).toBe(true);
  });
  it("matches PlaneswalkedTo for self plane", () => {
    const ta = buildTrigger("PlaneswalkedTo");
    const ev = mkEvent("PlaneswalkedTo", 1, PhaseStep.Main1, {
      planeCardId: SOURCE_ID,
      playerSeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(true);
  });
  it("does NOT match for a different plane (Card.Self)", () => {
    const ta = buildTrigger("PlaneswalkedTo");
    const ev = mkEvent("PlaneswalkedTo", 1, PhaseStep.Main1, {
      planeCardId: OTHER_ID,
      playerSeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3) Mutates
// ---------------------------------------------------------------------------
describe("MutatesTrigger", () => {
  it("is registered", () => {
    expect(triggerHandlerRegistry.has("Mutates")).toBe(true);
  });
  it("matches when self is host", () => {
    const ta = buildTrigger("Mutates");
    const ev = mkEvent("CardMutated", 1, PhaseStep.Main1, {
      mutatorId: OTHER_ID,
      hostId: SOURCE_ID,
      controllerSeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(true);
  });
  it("matches when self is mutator", () => {
    const ta = buildTrigger("Mutates");
    const ev = mkEvent("CardMutated", 1, PhaseStep.Main1, {
      mutatorId: SOURCE_ID,
      hostId: OTHER_ID,
      controllerSeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4) AttackersDeclaredOneTarget
// ---------------------------------------------------------------------------
describe("AttackersDeclaredOneTargetTrigger", () => {
  it("is registered", () => {
    expect(triggerHandlerRegistry.has("AttackersDeclaredOneTarget")).toBe(true);
  });
  it("matches when all attackers share a single defender", () => {
    const ta = buildTrigger("AttackersDeclaredOneTarget", { ValidPlayer: "Each" });
    const ev = mkEvent("AttackersDeclared", 1, PhaseStep.DeclareAttackers, {
      attackingSeat: OPPONENT,
      attackers: [
        { attackerId: mkEntityId(1), defender: { kind: "player", seat: CONTROLLER } },
        { attackerId: mkEntityId(2), defender: { kind: "player", seat: CONTROLLER } },
      ],
    });
    expect(ta.matches(ev)).toBe(true);
  });
  it("does NOT match when attackers split between two defenders", () => {
    const ta = buildTrigger("AttackersDeclaredOneTarget", { ValidPlayer: "Each" });
    const ev = mkEvent("AttackersDeclared", 1, PhaseStep.DeclareAttackers, {
      attackingSeat: OPPONENT,
      attackers: [
        { attackerId: mkEntityId(1), defender: { kind: "player", seat: CONTROLLER } },
        { attackerId: mkEntityId(2), defender: { kind: "player", seat: OPPONENT } },
      ],
    });
    expect(ta.matches(ev)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5) TapsForMana
// ---------------------------------------------------------------------------
describe("TapsForManaTrigger", () => {
  it("is registered", () => {
    expect(triggerHandlerRegistry.has("TapsForMana")).toBe(true);
  });
  it("matches ManaTapped for Card.Self", () => {
    const ta = buildTrigger("TapsForMana");
    const ev = mkEvent("ManaTapped", 1, PhaseStep.Main1, {
      cardId: SOURCE_ID,
      playerSeat: CONTROLLER,
      produced: "{G}",
    });
    expect(ta.matches(ev)).toBe(true);
  });
  it("does NOT match unrelated event", () => {
    const ta = buildTrigger("TapsForMana");
    const ev = mkEvent("CardTapped", 1, PhaseStep.Main1, { cardId: SOURCE_ID });
    expect(ta.matches(ev)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6) Attached
// ---------------------------------------------------------------------------
describe("AttachedTrigger", () => {
  it("is registered", () => {
    expect(triggerHandlerRegistry.has("Attached")).toBe(true);
  });
  it("matches CardAttached for self", () => {
    const ta = buildTrigger("Attached");
    const ev = mkEvent("CardAttached", 1, PhaseStep.Main1, {
      sourceId: SOURCE_ID,
      targetId: OTHER_ID,
      cause: "cast",
    });
    expect(ta.matches(ev)).toBe(true);
  });
  it("does NOT match attachment by another aura", () => {
    const ta = buildTrigger("Attached");
    const ev = mkEvent("CardAttached", 1, PhaseStep.Main1, {
      sourceId: OTHER_ID,
      targetId: mkEntityId(999),
      cause: "static",
    });
    expect(ta.matches(ev)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7) RolledDie
// ---------------------------------------------------------------------------
describe("RolledDieTrigger", () => {
  it("is registered", () => {
    expect(triggerHandlerRegistry.has("RolledDie")).toBe(true);
  });
  it("matches RollDie for controller", () => {
    const ta = buildTrigger("RolledDie");
    const ev = mkEvent("RollDie", 1, PhaseStep.Main1, {
      playerSeat: CONTROLLER,
      sides: 20,
      result: 17,
    });
    expect(ta.matches(ev)).toBe(true);
  });
  it("respects Sides$ filter", () => {
    const ta = buildTrigger("RolledDie", { Sides: "20" });
    const ev = mkEvent("RollDie", 1, PhaseStep.Main1, {
      playerSeat: CONTROLLER,
      sides: 6,
      result: 4,
    });
    expect(ta.matches(ev)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8) ManaExpend
// ---------------------------------------------------------------------------
describe("ManaExpendTrigger", () => {
  it("is registered", () => {
    expect(triggerHandlerRegistry.has("ManaExpend")).toBe(true);
  });
  it("matches ManaSpent for controller red", () => {
    const ta = buildTrigger("ManaExpend", { Color: "Red" });
    const ev = mkEvent("ManaSpent", 1, PhaseStep.Main1, {
      playerSeat: CONTROLLER,
      color: Color.Red,
      amount: 1,
    });
    expect(ta.matches(ev)).toBe(true);
  });
  it("does NOT match wrong color", () => {
    const ta = buildTrigger("ManaExpend", { Color: "Red" });
    const ev = mkEvent("ManaSpent", 1, PhaseStep.Main1, {
      playerSeat: CONTROLLER,
      color: Color.Blue,
      amount: 1,
    });
    expect(ta.matches(ev)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9) LandPlayed
// ---------------------------------------------------------------------------
describe("LandPlayedTrigger", () => {
  it("is registered", () => {
    expect(triggerHandlerRegistry.has("LandPlayed")).toBe(true);
  });
  it("matches LandPlayed for controller", () => {
    const ta = buildTrigger("LandPlayed", { ValidPlayer: "You" });
    const ev = mkEvent("LandPlayed", 1, PhaseStep.Main1, {
      cardId: OTHER_ID,
      playerSeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(true);
  });
  it("does NOT match opponent's land for ValidPlayer$ You", () => {
    const ta = buildTrigger("LandPlayed", { ValidPlayer: "You" });
    const ev = mkEvent("LandPlayed", 1, PhaseStep.Main1, {
      cardId: OTHER_ID,
      playerSeat: OPPONENT,
    });
    expect(ta.matches(ev)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10) AttackerUnblocked
// ---------------------------------------------------------------------------
describe("AttackerUnblockedTrigger", () => {
  it("is registered", () => {
    expect(triggerHandlerRegistry.has("AttackerUnblocked")).toBe(true);
  });
  it("matches AttackerUnblocked for self", () => {
    const ta = buildTrigger("AttackerUnblocked");
    const ev = mkEvent("AttackerUnblocked", 1, PhaseStep.DeclareBlockers, {
      attackerId: SOURCE_ID,
      attackingSeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(true);
  });
  it("does NOT match other attacker (Card.Self)", () => {
    const ta = buildTrigger("AttackerUnblocked");
    const ev = mkEvent("AttackerUnblocked", 1, PhaseStep.DeclareBlockers, {
      attackerId: OTHER_ID,
      attackingSeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 11) Untaps
// ---------------------------------------------------------------------------
describe("UntapsTrigger", () => {
  it("is registered", () => {
    expect(triggerHandlerRegistry.has("Untaps")).toBe(true);
  });
  it("matches CardUntapped for self", () => {
    const ta = buildTrigger("Untaps");
    const ev = mkEvent("CardUntapped", 1, PhaseStep.Untap, { cardId: SOURCE_ID });
    expect(ta.matches(ev)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 12) CounterPlayerAddedAll
// ---------------------------------------------------------------------------
describe("CounterPlayerAddedAllTrigger", () => {
  it("is registered", () => {
    expect(triggerHandlerRegistry.has("CounterPlayerAddedAll")).toBe(true);
  });
  it("matches PlayerCounterAdded for controller poison", () => {
    const ta = buildTrigger("CounterPlayerAddedAll", { CounterType: "POISON" });
    const ev = mkEvent("PlayerCounterAdded", 1, PhaseStep.Main1, {
      playerSeat: CONTROLLER,
      counterType: "POISON",
      amount: 1,
    });
    expect(ta.matches(ev)).toBe(true);
  });
  it("does NOT match different counter type", () => {
    const ta = buildTrigger("CounterPlayerAddedAll", { CounterType: "POISON" });
    const ev = mkEvent("PlayerCounterAdded", 1, PhaseStep.Main1, {
      playerSeat: CONTROLLER,
      counterType: "ENERGY",
      amount: 1,
    });
    expect(ta.matches(ev)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 13) TurnBegin
// ---------------------------------------------------------------------------
describe("TurnBeginTrigger", () => {
  it("is registered", () => {
    expect(triggerHandlerRegistry.has("TurnBegin")).toBe(true);
  });
  it("matches StepStarted Untap for controller", () => {
    const ta = buildTrigger("TurnBegin");
    const ev = mkEvent("StepStarted", 1, PhaseStep.Untap, {
      activeSeat: CONTROLLER,
      step: PhaseStep.Untap,
    });
    expect(ta.matches(ev)).toBe(true);
  });
  it("does NOT match StepStarted Upkeep", () => {
    const ta = buildTrigger("TurnBegin");
    const ev = mkEvent("StepStarted", 1, PhaseStep.Upkeep, {
      activeSeat: CONTROLLER,
      step: PhaseStep.Upkeep,
    });
    expect(ta.matches(ev)).toBe(false);
  });
  it("matches TurnStarted as synonym", () => {
    const ta = buildTrigger("TurnBegin");
    const ev = mkEvent("TurnStarted", 1, PhaseStep.Untap, { activeSeat: CONTROLLER });
    expect(ta.matches(ev)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 14) SpellCastOrCopy
// ---------------------------------------------------------------------------
describe("SpellCastOrCopyTrigger", () => {
  it("is registered", () => {
    expect(triggerHandlerRegistry.has("SpellCastOrCopy")).toBe(true);
  });
  it("matches SpellCast", () => {
    const ta = buildTrigger("SpellCastOrCopy", { ValidCard: "Card", ValidActivatingPlayer: "Each" });
    const ev = mkEvent("SpellCast", 1, PhaseStep.Main1, {
      stackItemId: mkEntityId(99),
      cardId: OTHER_ID,
      controllerSeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(true);
  });
  it("matches StackItemCopied", () => {
    const ta = buildTrigger("SpellCastOrCopy", { ValidCard: "Card", ValidActivatingPlayer: "Each" });
    const ev = mkEvent("StackItemCopied", 1, PhaseStep.Main1, {
      originalId: mkEntityId(99),
      copyId: mkEntityId(100),
      controllerSeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 15) Scry
// ---------------------------------------------------------------------------
describe("ScryTrigger", () => {
  it("is registered", () => {
    expect(triggerHandlerRegistry.has("Scry")).toBe(true);
  });
  it("matches Scry for controller", () => {
    const ta = buildTrigger("Scry");
    const ev = mkEvent("Scry", 1, PhaseStep.Main1, { playerSeat: CONTROLLER, count: 1 });
    expect(ta.matches(ev)).toBe(true);
  });
  it("does NOT match scry by opponent (default ValidPlayer$ You)", () => {
    const ta = buildTrigger("Scry");
    const ev = mkEvent("Scry", 1, PhaseStep.Main1, { playerSeat: OPPONENT, count: 1 });
    expect(ta.matches(ev)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 16) CommitCrime
// ---------------------------------------------------------------------------
describe("CommitCrimeTrigger", () => {
  it("is registered", () => {
    expect(triggerHandlerRegistry.has("CommitCrime")).toBe(true);
  });
  it("matches CrimeCommitted for controller targeting opponent", () => {
    const ta = buildTrigger("CommitCrime", { ValidVictim: "Opponent" });
    const ev = mkEvent("CrimeCommitted", 1, PhaseStep.Main1, {
      playerSeat: CONTROLLER,
      sourceCardId: SOURCE_ID,
      victimSeat: OPPONENT,
    });
    expect(ta.matches(ev)).toBe(true);
  });
  it("does NOT match if victim is self", () => {
    const ta = buildTrigger("CommitCrime", { ValidVictim: "Opponent" });
    const ev = mkEvent("CrimeCommitted", 1, PhaseStep.Main1, {
      playerSeat: CONTROLLER,
      sourceCardId: SOURCE_ID,
      victimSeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 17) CounterRemoved
// ---------------------------------------------------------------------------
describe("CounterRemovedTrigger", () => {
  it("is registered", () => {
    expect(triggerHandlerRegistry.has("CounterRemoved")).toBe(true);
  });
  it("matches CounterRemoved for self with correct type", () => {
    const ta = buildTrigger("CounterRemoved", { CounterType: "P1P1" });
    const ev = mkEvent("CounterRemoved", 1, PhaseStep.Main1, {
      cardId: SOURCE_ID,
      counterType: "P1P1",
      amount: 1,
    });
    expect(ta.matches(ev)).toBe(true);
  });
  it("does NOT match wrong counter type", () => {
    const ta = buildTrigger("CounterRemoved", { CounterType: "P1P1" });
    const ev = mkEvent("CounterRemoved", 1, PhaseStep.Main1, {
      cardId: SOURCE_ID,
      counterType: "LOYALTY",
      amount: 1,
    });
    expect(ta.matches(ev)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 18) BecomeMonstrous
// ---------------------------------------------------------------------------
describe("BecomeMonstrousTrigger", () => {
  it("is registered", () => {
    expect(triggerHandlerRegistry.has("BecomeMonstrous")).toBe(true);
  });
  it("matches CardBecameMonstrous for self", () => {
    const ta = buildTrigger("BecomeMonstrous");
    const ev = mkEvent("CardBecameMonstrous", 1, PhaseStep.Main1, {
      cardId: SOURCE_ID,
      controllerSeat: CONTROLLER,
    });
    expect(ta.matches(ev)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 19) RingTemptsYou
// ---------------------------------------------------------------------------
describe("RingTemptsYouTrigger", () => {
  it("is registered", () => {
    expect(triggerHandlerRegistry.has("RingTemptsYou")).toBe(true);
  });
  it("matches RingTempted for controller", () => {
    const ta = buildTrigger("RingTemptsYou");
    const ev = mkEvent("RingTempted", 1, PhaseStep.Main1, {
      playerSeat: CONTROLLER,
      cardId: OTHER_ID,
    });
    expect(ta.matches(ev)).toBe(true);
  });
  it("does NOT match RingTempted for opponent (ValidPlayer$ You default)", () => {
    const ta = buildTrigger("RingTemptsYou");
    const ev = mkEvent("RingTempted", 1, PhaseStep.Main1, {
      playerSeat: OPPONENT,
      cardId: OTHER_ID,
    });
    expect(ta.matches(ev)).toBe(false);
  });
});
