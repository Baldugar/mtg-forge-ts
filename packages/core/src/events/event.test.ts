// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { Color } from "../color.js";
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
  "CardAttached",
  "CardUnattached",
  "PhasedOut",
  "PhasedIn",
  "Flipped",
  "Transformed",
  "FaceDownStateChanged",
  "CardTurnedFaceUp",
  "Melded",
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
  // Zone change extensions (5)
  "Scry",
  "Surveil",
  "Shuffle",
  "CardPlotted",
  "TokenCreated",
  // Mana (1)
  "ManaEnteredPool",
  // Monarch/Initiative/Ring extensions (3)
  "DayTimeChanged",
  "DoorOpened",
  "SpeedLevelChanged",
  // Stack extensions (1)
  "ModeChosen",
  // Player extensions (2)
  "PlayerPoisoned",
  "PlayerRadiated",
  // Meta extensions (4)
  "FlipCoin",
  "RollDie",
  "SubgameStarted",
  "SubgameEnded",
  // Reveal (1) — Wave 4
  "CardsRevealed",
  // Targeting (1) — Wave 5
  "CardTargeted",
  // Engine-internal (11) — SP2 §B
  "EventPrevented",
  "TriggerQueued",
  "TriggerResolved",
  "ReplacementApplied",
  "StateBasedActionApplied",
  "StaticAbilityRegistered",
  "StaticAbilityUnregistered",
  "ContinuousEffectRegistered",
  "ContinuousEffectExpired",
  "CostPaid",
  "PhaseStepEnded",
  // Wave 16 — combat / mana / planar / scheme / mutate / monstrous (12)
  "AttackerUnblocked",
  "CardBecameMonstrous",
  "CardCranked",
  "CardMutated",
  "CrimeCommitted",
  "LandPlayed",
  "ManaSpent",
  "ManaTapped",
  "PlanarDieRolled",
  "PlaneswalkedTo",
  "PlayerCounterAdded",
  "SchemeSetInMotion",
  // Wave 18 — corpus-unknown trigger event extensions (6)
  "Mentored",
  "SearchedLibrary",
  "ElementalBend",
  "PayCumulativeUpkeep",
  "Exerted",
  "Enlisted",
];

// WHY: compile-time exhaustiveness — if a new kind is added to GameEvent
// without landing in ALL_KINDS_MAP, this `satisfies` fails. Bidirectional
// with EXPECTED_KINDS above (listed form) so a missing kind is caught on
// both sides.
const ALL_KINDS_MAP = {
  CardDrawn: true,
  CardDiscarded: true,
  CardMilled: true,
  CardDestroyed: true,
  CardExiled: true,
  CardSacrificed: true,
  CardReturned: true,
  CardCycled: true,
  CardForetold: true,
  CardChangedZone: true,
  LifeChanged: true,
  CounterAdded: true,
  CounterRemoved: true,
  CardTapped: true,
  CardUntapped: true,
  ControlChanged: true,
  AttachmentChanged: true,
  CardAttached: true,
  CardUnattached: true,
  PhasedOut: true,
  PhasedIn: true,
  Flipped: true,
  Transformed: true,
  FaceDownStateChanged: true,
  CardTurnedFaceUp: true,
  Melded: true,
  BecameMonarch: true,
  LostMonarch: true,
  BecameInitiative: true,
  RingTempted: true,
  RingLevelChanged: true,
  SpellCast: true,
  SpellPutOnStack: true,
  AbilityActivated: true,
  AbilityTriggered: true,
  StackItemResolving: true,
  StackItemResolved: true,
  StackItemCountered: true,
  StackItemCopied: true,
  CombatStarted: true,
  AttackersDeclared: true,
  BlockersDeclared: true,
  BlockerOrderSet: true,
  DamageAssigned: true,
  DamageDealt: true,
  DamagePrevented: true,
  AttackerBecomesBlocked: true,
  CombatEnded: true,
  CombatCreatureDied: true,
  TurnStarted: true,
  TurnEnded: true,
  PhaseStarted: true,
  StepStarted: true,
  StepEnded: true,
  PlayerLifeChanged: true,
  PlayerDrew: true,
  PlayerDiscarded: true,
  PlayerMilled: true,
  PlayerLost: true,
  PlayerWon: true,
  PlayerConceded: true,
  CityBlessingGained: true,
  GameStarted: true,
  MulliganTaken: true,
  GameEnded: true,
  CastAborted: true,
  ShortcutApplied: true,
  Scry: true,
  Surveil: true,
  Shuffle: true,
  CardPlotted: true,
  TokenCreated: true,
  ManaEnteredPool: true,
  DayTimeChanged: true,
  DoorOpened: true,
  SpeedLevelChanged: true,
  ModeChosen: true,
  PlayerPoisoned: true,
  PlayerRadiated: true,
  FlipCoin: true,
  RollDie: true,
  SubgameStarted: true,
  SubgameEnded: true,
  CardsRevealed: true,
  CardTargeted: true,
  EventPrevented: true,
  TriggerQueued: true,
  TriggerResolved: true,
  ReplacementApplied: true,
  StateBasedActionApplied: true,
  StaticAbilityRegistered: true,
  StaticAbilityUnregistered: true,
  ContinuousEffectRegistered: true,
  ContinuousEffectExpired: true,
  CostPaid: true,
  PhaseStepEnded: true,
  // Wave 16 — corpus-unknown trigger event extensions (pre-Wave-18)
  AttackerUnblocked: true,
  CardBecameMonstrous: true,
  CardCranked: true,
  CardMutated: true,
  CrimeCommitted: true,
  LandPlayed: true,
  ManaSpent: true,
  ManaTapped: true,
  PlanarDieRolled: true,
  PlaneswalkedTo: true,
  PlayerCounterAdded: true,
  SchemeSetInMotion: true,
  // Wave 18 — additional corpus-unknown trigger events (6)
  Mentored: true,
  SearchedLibrary: true,
  ElementalBend: true,
  PayCumulativeUpkeep: true,
  Exerted: true,
  Enlisted: true,
} as const satisfies Record<GameEventKind, true>;

describe("GameEvent enumeration", () => {
  it("has 114 distinct kinds grouped across 9 families (Wave 16 + 12, Wave 18 + 6)", () => {
    expect(EXPECTED_KINDS.length).toBe(114);
    expect(new Set(EXPECTED_KINDS).size).toBe(114);
    // ALL_KINDS_MAP satisfies Record<GameEventKind, true> already enforces
    // compile-time exhaustiveness; this asserts the two lists stay aligned.
    expect(Object.keys(ALL_KINDS_MAP).sort()).toEqual([...EXPECTED_KINDS].sort());
  });
});

describe("Event taxonomy lock — version:1 sweep", () => {
  // WHY: SP2 §B pins every variant at version:1. Any regression where a
  // newly-added variant forgets the literal — or is accidentally authored
  // at v2 — trips this sweep before it reaches the registries.
  //
  // Payload fixtures kept minimal: just enough structure to satisfy
  // mkEvent's payload type for each kind. Values are type-system-only;
  // semantics are exercised by the family tests above.
  const seat0 = mkPlayerSeat(0);
  const seat1 = mkPlayerSeat(1);
  const id = (n: number) => mkEntityId(n);

  const PAYLOADS: {
    [K in GameEventKind]: Extract<GameEvent, { kind: K }>["payload"];
  } = {
    CardDrawn: { playerSeat: seat0, cardId: id(1) },
    CardDiscarded: { playerSeat: seat0, cardId: id(1), cause: "discard" },
    CardMilled: { playerSeat: seat0, cardId: id(1) },
    CardDestroyed: { cardId: id(1), cause: "sba" },
    CardExiled: { cardId: id(1), fromZone: ZoneType.Battlefield },
    CardSacrificed: { cardId: id(1), playerSeat: seat0 },
    CardReturned: { cardId: id(1), fromZone: ZoneType.Graveyard, toZone: ZoneType.Hand },
    CardCycled: { cardId: id(1), playerSeat: seat0 },
    CardForetold: { cardId: id(1), playerSeat: seat0 },
    CardChangedZone: { cardId: id(1), fromZone: ZoneType.Hand, toZone: ZoneType.Graveyard },
    LifeChanged: { playerSeat: seat0, oldLife: 20, newLife: 18, delta: -2, cause: "damage" },
    CounterAdded: { cardId: id(1), counterType: "+1/+1", amount: 1 },
    CounterRemoved: { cardId: id(1), counterType: "+1/+1", amount: 1 },
    CardTapped: { cardId: id(1) },
    CardUntapped: { cardId: id(1) },
    ControlChanged: { cardId: id(1), oldController: seat0, newController: seat1 },
    AttachmentChanged: { cardId: id(1) },
    CardAttached: { sourceId: id(1), targetId: id(2), cause: "cast" },
    CardUnattached: { sourceId: id(1), reason: "effect" },
    PhasedOut: { cardId: id(1), direct: true },
    PhasedIn: { cardId: id(1), direct: true },
    Flipped: { cardId: id(1) },
    Transformed: { cardId: id(1), toFace: "back" },
    Melded: { meldedId: id(1), sourceIds: [id(2), id(3)] },
    FaceDownStateChanged: { cardId: id(1), faceDown: true },
    CardTurnedFaceUp: { cardId: id(1), previousKind: "morph" },
    BecameMonarch: { playerSeat: seat0 },
    LostMonarch: { playerSeat: seat0 },
    BecameInitiative: { playerSeat: seat0 },
    RingTempted: { playerSeat: seat0, cardId: id(1) },
    RingLevelChanged: { playerSeat: seat0, oldLevel: 0, newLevel: 1 },
    SpellCast: { stackItemId: id(1), cardId: id(2), controllerSeat: seat0 },
    SpellPutOnStack: { stackItemId: id(1), cardId: id(2), controllerSeat: seat0 },
    AbilityActivated: {
      stackItemId: id(1),
      sourceCardId: id(2),
      controllerSeat: seat0,
      abilityKind: "activated",
    },
    AbilityTriggered: {
      stackItemId: id(1),
      sourceCardId: id(2),
      controllerSeat: seat0,
      triggerMode: "etb",
    },
    StackItemResolving: { stackItemId: id(1) },
    StackItemResolved: { stackItemId: id(1), fizzled: false },
    StackItemCountered: { stackItemId: id(1) },
    StackItemCopied: { originalId: id(1), copyId: id(2), controllerSeat: seat0 },
    CombatStarted: { attackingSeat: seat0 },
    AttackersDeclared: { attackingSeat: seat0, attackers: [] },
    BlockersDeclared: { defendingSeat: seat1, blocks: [] },
    BlockerOrderSet: { attackerId: id(1), blockerOrder: [] },
    DamageAssigned: { sourceId: id(1), targetKind: "player", targetId: seat1, amount: 2 },
    DamageDealt: {
      sourceId: id(1),
      targetKind: "player",
      targetId: seat1,
      amount: 2,
      isCombat: true,
    },
    DamagePrevented: { sourceId: id(1), targetKind: "player", targetId: seat1, amount: 1 },
    AttackerBecomesBlocked: { attackerId: id(1) },
    CombatEnded: { attackingSeat: seat0 },
    CombatCreatureDied: { cardId: id(1), cause: "damage" },
    TurnStarted: { activeSeat: seat0 },
    TurnEnded: { activeSeat: seat0 },
    PhaseStarted: { activeSeat: seat0, phase: PhaseStep.Main1 },
    StepStarted: { activeSeat: seat0, step: PhaseStep.Upkeep },
    StepEnded: { activeSeat: seat0, step: PhaseStep.Upkeep },
    PlayerLifeChanged: { playerSeat: seat0, oldLife: 20, newLife: 19, delta: -1 },
    PlayerDrew: { playerSeat: seat0, count: 1 },
    PlayerDiscarded: { playerSeat: seat0, cardIds: [], cause: "discard" },
    PlayerMilled: { playerSeat: seat0, count: 3 },
    PlayerLost: { playerSeat: seat0, reason: "life" },
    PlayerWon: { playerSeat: seat0 },
    PlayerConceded: { playerSeat: seat0 },
    CityBlessingGained: { playerSeat: seat0 },
    GameStarted: { seats: [seat0, seat1], firstPlayer: seat0 },
    MulliganTaken: { playerSeat: seat0, handBefore: 7, handAfter: 6, rule: "london" },
    GameEnded: { winners: [seat0], reason: "victory" },
    CastAborted: { playerSeat: seat0, cardId: id(1), reason: "illegal targets" },
    ShortcutApplied: { description: "keep untapping", affected: [] },
    Scry: { playerSeat: seat0, count: 1 },
    Surveil: { playerSeat: seat0, count: 1 },
    Shuffle: { playerSeat: seat0, zoneShuffled: ZoneType.Library },
    CardPlotted: { playerSeat: seat0, cardId: id(1) },
    TokenCreated: { controllerSeat: seat0, tokenCardId: id(1) },
    ManaEnteredPool: { playerSeat: seat0, color: null, sourceId: null, amount: 1 },
    DayTimeChanged: { oldValue: "day", newValue: "night" },
    DoorOpened: { cardId: id(1) },
    SpeedLevelChanged: { playerSeat: seat0, oldLevel: 1, newLevel: 2 },
    ModeChosen: { sourceId: id(1), modeIds: [] },
    PlayerPoisoned: { playerSeat: seat0, amount: 1 },
    PlayerRadiated: { playerSeat: seat0, amount: 1 },
    FlipCoin: { playerSeat: seat0, resultHeads: true },
    RollDie: { playerSeat: seat0, sides: 6, result: 4 },
    SubgameStarted: { parentTurn: 1 },
    SubgameEnded: { parentTurn: 1, outcome: "win" },
    // Reveal (1) — Wave 4
    CardsRevealed: {
      revealedBy: seat0,
      revealedTo: "all" as const,
      cardIds: [id(1)],
      fromZone: ZoneType.Library,
    },
    // Targeting (1) — Wave 5
    CardTargeted: { targetId: id(1), sourceCardId: id(2), targetingSeat: seat0 },
    // Engine-internal (11) — SP2 §B
    EventPrevented: { original: { kind: "test" } },
    TriggerQueued: { triggerId: id(1), sourceCardId: id(2) },
    TriggerResolved: { triggerId: id(1) },
    ReplacementApplied: {
      replacementId: id(1),
      original: { kind: "before" },
      replaced: { kind: "after" },
    },
    StateBasedActionApplied: { actionCount: 1 },
    StaticAbilityRegistered: { staticId: id(1), sourceCardId: id(2) },
    StaticAbilityUnregistered: { staticId: id(1) },
    ContinuousEffectRegistered: { effectId: id(1) },
    ContinuousEffectExpired: { effectId: id(1) },
    CostPaid: { stackItemId: id(1), payerSeat: seat0 },
    PhaseStepEnded: { step: PhaseStep.EndStep },
    // Wave 16 missing payloads
    AttackerUnblocked: { attackerId: id(1), attackingSeat: seat0 },
    CardBecameMonstrous: { cardId: id(1), controllerSeat: seat0 },
    CardCranked: { cardId: id(1), controllerSeat: seat0 },
    CardMutated: { mutatorId: id(1), hostId: id(2), controllerSeat: seat0 },
    CrimeCommitted: { playerSeat: seat0, sourceCardId: id(1) },
    LandPlayed: { cardId: id(1), playerSeat: seat0 },
    ManaSpent: { playerSeat: seat0, color: null, amount: 1 },
    ManaTapped: { cardId: id(1), playerSeat: seat0, produced: "G" },
    PlanarDieRolled: { rollingSeat: seat0, result: "chaos" },
    PlaneswalkedTo: { planeCardId: id(1), playerSeat: seat0 },
    PlayerCounterAdded: { playerSeat: seat0, counterType: "poison", amount: 1 },
    SchemeSetInMotion: { schemeCardId: id(1), archenemySeat: seat0 },
    // Wave 18 payloads
    Mentored: { mentorCardId: id(1), mentoredCardId: id(2), playerSeat: seat0 },
    SearchedLibrary: { playerSeat: seat0, searchedSeat: seat0 },
    ElementalBend: { cardId: id(1), playerSeat: seat0 },
    PayCumulativeUpkeep: { cardId: id(1), playerSeat: seat0 },
    Exerted: { cardId: id(1), playerSeat: seat0 },
    Enlisted: { cardId: id(1), enlisterCardId: id(2) },
  };

  for (const kind of EXPECTED_KINDS) {
    it(`mkEvent(${kind}) pins version:1`, () => {
      const payload = PAYLOADS[kind];
      const e = mkEvent(kind, 1, PhaseStep.Main1, payload as never);
      expect(e.version).toBe(1);
      expect(e.kind).toBe(kind);
      expect(e.turn).toBe(1);
      expect(e.phase).toBe(PhaseStep.Main1);
      // Round-trip JSON — locked schema must stringify cleanly.
      expect(JSON.parse(JSON.stringify(e))).toEqual(e);
    });
  }
});

describe("mkEvent — SP2 §B engine-internal additions", () => {
  it("builds EventPrevented with opaque original intent", () => {
    const e = mkEvent("EventPrevented", 2, PhaseStep.Main1, {
      original: { kind: "DamageAssigned", sourceId: mkEntityId(1) },
    });
    expect(e.kind).toBe("EventPrevented");
    expect(e.version).toBe(1);
  });

  it("builds TriggerQueued + TriggerResolved pair", () => {
    const q = mkEvent("TriggerQueued", 3, PhaseStep.EndStep, {
      triggerId: mkEntityId(50),
      sourceCardId: mkEntityId(10),
    });
    expect(q.payload.triggerId).toBe(mkEntityId(50));
    const r = mkEvent("TriggerResolved", 3, PhaseStep.EndStep, {
      triggerId: mkEntityId(50),
    });
    expect(r.payload.triggerId).toBe(mkEntityId(50));
  });

  it("builds ReplacementApplied with before/after intents", () => {
    const e = mkEvent("ReplacementApplied", 4, PhaseStep.Main2, {
      replacementId: mkEntityId(7),
      original: { kind: "CardDestroyed", cardId: mkEntityId(12) },
      replaced: { kind: "CardExiled", cardId: mkEntityId(12) },
    });
    expect(e.payload.replacementId).toBe(mkEntityId(7));
  });

  it("builds StateBasedActionApplied with actionCount", () => {
    const e = mkEvent("StateBasedActionApplied", 1, PhaseStep.CombatDamage, {
      actionCount: 3,
    });
    expect(e.payload.actionCount).toBe(3);
  });

  it("builds StaticAbilityRegistered + Unregistered bookkeeping", () => {
    const reg = mkEvent("StaticAbilityRegistered", 1, PhaseStep.Main1, {
      staticId: mkEntityId(1),
      sourceCardId: mkEntityId(2),
    });
    expect(reg.payload.staticId).toBe(mkEntityId(1));
    const un = mkEvent("StaticAbilityUnregistered", 1, PhaseStep.Main1, {
      staticId: mkEntityId(1),
    });
    expect(un.payload.staticId).toBe(mkEntityId(1));
  });

  it("builds ContinuousEffectRegistered + Expired bookkeeping", () => {
    const reg = mkEvent("ContinuousEffectRegistered", 2, PhaseStep.Main1, {
      effectId: mkEntityId(30),
    });
    expect(reg.payload.effectId).toBe(mkEntityId(30));
    const exp = mkEvent("ContinuousEffectExpired", 2, PhaseStep.EndStep, {
      effectId: mkEntityId(30),
    });
    expect(exp.payload.effectId).toBe(mkEntityId(30));
  });

  it("builds CostPaid with stackItem + payer", () => {
    const e = mkEvent("CostPaid", 2, PhaseStep.Main1, {
      stackItemId: mkEntityId(5),
      payerSeat: mkPlayerSeat(0),
    });
    expect(e.payload.payerSeat).toBe(mkPlayerSeat(0));
  });

  it("builds PhaseStepEnded", () => {
    const e = mkEvent("PhaseStepEnded", 3, PhaseStep.EndStep, {
      step: PhaseStep.EndStep,
    });
    expect(e.payload.step).toBe(PhaseStep.EndStep);
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
    const e = mkEvent("RingLevelChanged", 5, PhaseStep.Main1, {
      playerSeat: mkPlayerSeat(0),
      oldLevel: 1,
      newLevel: 2,
    });
    expect(e.kind).toBe("RingLevelChanged");
    expect(e.payload.newLevel).toBe(2);
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });

  it("builds a Stack event (SpellCast) with optional xValue", () => {
    const e = mkEvent("SpellCast", 2, PhaseStep.Main1, {
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
    const e = mkEvent("CardChangedZone", 1, PhaseStep.Main1, {
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

describe("mkEvent — post-audit extensions", () => {
  it("builds Scry / Surveil / Shuffle (Zone-change extensions)", () => {
    const scry = mkEvent("Scry", 1, PhaseStep.Main1, {
      playerSeat: mkPlayerSeat(0),
      count: 3,
    });
    expect(scry.payload.count).toBe(3);
    const surv = mkEvent("Surveil", 1, PhaseStep.Main1, {
      playerSeat: mkPlayerSeat(1),
      count: 2,
    });
    expect(surv.payload.count).toBe(2);
    const shuf = mkEvent("Shuffle", 1, PhaseStep.Draw, {
      playerSeat: mkPlayerSeat(0),
      zoneShuffled: ZoneType.Library,
    });
    expect(shuf.payload.zoneShuffled).toBe(ZoneType.Library);
  });

  it("builds CardPlotted + TokenCreated", () => {
    const plot = mkEvent("CardPlotted", 4, PhaseStep.Main1, {
      playerSeat: mkPlayerSeat(0),
      cardId: mkEntityId(99),
    });
    expect(plot.payload.cardId).toBe(mkEntityId(99));
    const tok = mkEvent("TokenCreated", 4, PhaseStep.Main1, {
      controllerSeat: mkPlayerSeat(0),
      tokenCardId: mkEntityId(500),
      definitionId: "goblin_1_1_red",
    });
    expect(tok.payload.definitionId).toBe("goblin_1_1_red");
  });

  it("builds ManaEnteredPool with optional color + source", () => {
    const e = mkEvent("ManaEnteredPool", 2, PhaseStep.Main1, {
      playerSeat: mkPlayerSeat(0),
      color: Color.Red,
      sourceId: mkEntityId(10),
      amount: 1,
    });
    expect(e.payload.color).toBe(Color.Red);
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });

  it("builds DayTimeChanged / DoorOpened / SpeedLevelChanged", () => {
    const day = mkEvent("DayTimeChanged", 3, PhaseStep.Upkeep, {
      oldValue: "day",
      newValue: "night",
    });
    expect(day.payload.newValue).toBe("night");
    const door = mkEvent("DoorOpened", 3, PhaseStep.Main1, {
      cardId: mkEntityId(50),
      doorId: "front",
    });
    expect(door.payload.doorId).toBe("front");
    const sp = mkEvent("SpeedLevelChanged", 3, PhaseStep.EndStep, {
      playerSeat: mkPlayerSeat(0),
      oldLevel: 1,
      newLevel: 2,
    });
    expect(sp.payload.newLevel).toBe(2);
  });

  it("builds ModeChosen on Stack", () => {
    const e = mkEvent("ModeChosen", 1, PhaseStep.Main1, {
      sourceId: mkEntityId(77),
      modeIds: ["a", "c"],
    });
    expect(e.payload.modeIds.length).toBe(2);
  });

  it("builds PlayerPoisoned + PlayerRadiated", () => {
    const pois = mkEvent("PlayerPoisoned", 2, PhaseStep.CombatDamage, {
      playerSeat: mkPlayerSeat(1),
      amount: 2,
    });
    expect(pois.payload.amount).toBe(2);
    const rad = mkEvent("PlayerRadiated", 2, PhaseStep.EndStep, {
      playerSeat: mkPlayerSeat(1),
      amount: 1,
    });
    expect(rad.payload.amount).toBe(1);
  });

  it("builds FlipCoin / RollDie / SubgameStarted / SubgameEnded", () => {
    const coin = mkEvent("FlipCoin", 1, PhaseStep.Main1, {
      playerSeat: mkPlayerSeat(0),
      resultHeads: true,
    });
    expect(coin.payload.resultHeads).toBe(true);
    const die = mkEvent("RollDie", 1, PhaseStep.Main1, {
      playerSeat: mkPlayerSeat(0),
      sides: 6,
      result: 4,
    });
    expect(die.payload.result).toBe(4);
    const sub1 = mkEvent("SubgameStarted", 5, PhaseStep.Main1, { parentTurn: 5 });
    expect(sub1.payload.parentTurn).toBe(5);
    const sub2 = mkEvent("SubgameEnded", 5, PhaseStep.Main1, {
      parentTurn: 5,
      outcome: "win",
    });
    expect(sub2.payload.outcome).toBe("win");
  });
});

describe("mkEvent — Wave 4 CardsRevealed", () => {
  it("builds CardsRevealed with revealedTo='all' (library peek)", () => {
    const e = mkEvent("CardsRevealed", 1, PhaseStep.Main1, {
      revealedBy: mkPlayerSeat(0),
      revealedTo: "all",
      cardIds: [mkEntityId(1), mkEntityId(2)],
      fromZone: ZoneType.Library,
    });
    expect(e.kind).toBe("CardsRevealed");
    expect(e.version).toBe(1);
    expect(e.payload.revealedTo).toBe("all");
    expect(e.payload.cardIds).toHaveLength(2);
    expect(e.payload.fromZone).toBe(ZoneType.Library);
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });

  it("builds CardsRevealed with revealedTo=[seat] (hand reveal to opponents)", () => {
    const e = mkEvent("CardsRevealed", 2, PhaseStep.Main2, {
      revealedBy: mkPlayerSeat(1),
      revealedTo: [mkPlayerSeat(0)],
      cardIds: [mkEntityId(10), mkEntityId(11), mkEntityId(12)],
      fromZone: ZoneType.Hand,
    });
    expect(e.payload.revealedBy).toBe(mkPlayerSeat(1));
    expect(Array.isArray(e.payload.revealedTo)).toBe(true);
    expect((e.payload.revealedTo as number[]).length).toBe(1);
    expect(e.payload.fromZone).toBe(ZoneType.Hand);
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
