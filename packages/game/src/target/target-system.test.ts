// SPDX-License-Identifier: GPL-3.0-or-later
// TargetSystem tests — CR 601/608 targeting at cast, resolve, and redirect.
// SP2 Milestone C Tasks 13, 14, 15.
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  CardType,
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaCost,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import type { EnumerationContext } from "./enumeration.js";
import type { TargetChoices, TargetRestriction } from "./restriction.js";
import { cardTarget } from "./restriction.js";

const alice: LobbyPlayer = { id: "P0", name: "P0", controllerKind: "human" };
const bob: LobbyPlayer = { id: "P1", name: "P1", controllerKind: "human" };

const rules: GameRules = {
  formatId: "standard",
  startingLife: 20,
  startingHandSize: 7,
  mulliganRule: "london",
  firstPlayerSkipsDraw: true,
  ruleOverrides: [],
  playerCount: { min: 2, max: 2 },
  poisonCountersToLose: 10,
  playForAnte: false,
  manaBurn: false,
  gamesPerMatch: 1,
  appliedVariants: [],
};

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "test",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "deadbeef",
};

const grizzlyBears: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "195",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const seedZones = (game: Game): void => {
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
};

const mkGame = (): Game => {
  const g = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xdeadbeefn),
  });
  seedZones(g);
  return g;
};

/**
 * Put a Card into the game, registering it in game.cards AND in the
 * appropriate zone for its controller seat. Optional `types` seed is
 * applied per-card via `card.copiedFrom` (Layer 1) so the computed
 * characteristics carry those CardTypes without global side effects on
 * other cards. Using Layer 4 typeEffects would leak across cards because
 * SP2's TypeChangeEffect has no per-card scoping.
 */
const addCard = (
  g: Game,
  id: number,
  controllerSeat: PlayerSeat,
  zone: ZoneType,
  types: readonly CardType[] = [],
): EntityId => {
  const cid = mkEntityId(id);
  const card = new Card(cid, grizzlyBears, controllerSeat, controllerSeat, zone);
  if (types.length > 0) {
    card.copiedFrom = {
      name: grizzlyBears.name ?? "",
      manaCost: ManaCost.parse(""),
      colorIndicator: null,
      supertypes: new Set(),
      types: new Set(types),
      subtypes: new Set(),
      colors: ColorSet.empty(),
      rulesText: "",
      power: null,
      toughness: null,
      loyalty: null,
      defense: null,
    };
  }
  g.cards.set(cid, card);
  const z = g.getPlayer(controllerSeat).zones.get(zone);
  if (!z) throw new Error(`test: missing zone ${zone} for seat ${controllerSeat}`);
  z.add(cid);
  g.layerEngine.bumpEpoch("test: seed card");
  return cid;
};

// ---------------------------------------------------------------------------
// enumerate
// ---------------------------------------------------------------------------

describe("TargetSystem.enumerate — zone filters", () => {
  it("returns cards in permitted zones only", () => {
    const g = mkGame();
    const cBf = addCard(g, 10, mkPlayerSeat(0), ZoneType.Battlefield);
    addCard(g, 11, mkPlayerSeat(0), ZoneType.Hand);
    addCard(g, 12, mkPlayerSeat(0), ZoneType.Library);
    const restriction: TargetRestriction = {
      controllerScope: "any",
      permitZones: new Set([ZoneType.Battlefield]),
      permitTypes: new Set(),
      forbidTypes: new Set(),
      minTargets: 1,
      maxTargets: 1,
      mayTargetPlayers: false,
    };
    const ctx: EnumerationContext = { sourceId: mkEntityId(999), sourceControllerSeat: mkPlayerSeat(0) };
    const eligible = g.targetSystem.enumerate(ctx, restriction);
    expect(eligible).toHaveLength(1);
    expect(eligible[0]).toEqual({ kind: "card", id: cBf });
  });

  it("permits multiple zones when restriction lists several", () => {
    const g = mkGame();
    const cBf = addCard(g, 20, mkPlayerSeat(0), ZoneType.Battlefield);
    const cGy = addCard(g, 21, mkPlayerSeat(0), ZoneType.Graveyard);
    addCard(g, 22, mkPlayerSeat(0), ZoneType.Library);
    const restriction: TargetRestriction = {
      controllerScope: "any",
      permitZones: new Set([ZoneType.Battlefield, ZoneType.Graveyard]),
      permitTypes: new Set(),
      forbidTypes: new Set(),
      minTargets: 1,
      maxTargets: 1,
      mayTargetPlayers: false,
    };
    const ctx: EnumerationContext = { sourceId: mkEntityId(999), sourceControllerSeat: mkPlayerSeat(0) };
    const eligible = g.targetSystem.enumerate(ctx, restriction);
    const ids = eligible.map((r) => (r.kind === "card" ? r.id : null));
    expect(ids).toContain(cBf);
    expect(ids).toContain(cGy);
    expect(ids).toHaveLength(2);
  });
});

describe("TargetSystem.enumerate — controller scope", () => {
  const mkBase = (scope: "you" | "opponent" | "any"): TargetRestriction => ({
    controllerScope: scope,
    permitZones: new Set([ZoneType.Battlefield]),
    permitTypes: new Set(),
    forbidTypes: new Set(),
    minTargets: 1,
    maxTargets: 1,
    mayTargetPlayers: false,
  });

  it("'you' returns only source-controller cards", () => {
    const g = mkGame();
    const mine = addCard(g, 30, mkPlayerSeat(0), ZoneType.Battlefield);
    addCard(g, 31, mkPlayerSeat(1), ZoneType.Battlefield);
    const ctx: EnumerationContext = { sourceId: mkEntityId(999), sourceControllerSeat: mkPlayerSeat(0) };
    const eligible = g.targetSystem.enumerate(ctx, mkBase("you"));
    expect(eligible).toEqual([{ kind: "card", id: mine }]);
  });

  it("'opponent' returns only non-source-controller cards", () => {
    const g = mkGame();
    addCard(g, 32, mkPlayerSeat(0), ZoneType.Battlefield);
    const theirs = addCard(g, 33, mkPlayerSeat(1), ZoneType.Battlefield);
    const ctx: EnumerationContext = { sourceId: mkEntityId(999), sourceControllerSeat: mkPlayerSeat(0) };
    const eligible = g.targetSystem.enumerate(ctx, mkBase("opponent"));
    expect(eligible).toEqual([{ kind: "card", id: theirs }]);
  });

  it("'any' returns cards from every controller", () => {
    const g = mkGame();
    addCard(g, 34, mkPlayerSeat(0), ZoneType.Battlefield);
    addCard(g, 35, mkPlayerSeat(1), ZoneType.Battlefield);
    const ctx: EnumerationContext = { sourceId: mkEntityId(999), sourceControllerSeat: mkPlayerSeat(0) };
    const eligible = g.targetSystem.enumerate(ctx, mkBase("any"));
    expect(eligible).toHaveLength(2);
  });
});

describe("TargetSystem.enumerate — type filters", () => {
  it("permitTypes keeps only cards with a matching type", () => {
    const g = mkGame();
    const creature = addCard(g, 40, mkPlayerSeat(0), ZoneType.Battlefield, [CardType.Creature]);
    addCard(g, 41, mkPlayerSeat(0), ZoneType.Battlefield, [CardType.Land]);
    const restriction: TargetRestriction = {
      controllerScope: "any",
      permitZones: new Set([ZoneType.Battlefield]),
      permitTypes: new Set([CardType.Creature]),
      forbidTypes: new Set(),
      minTargets: 1,
      maxTargets: 1,
      mayTargetPlayers: false,
    };
    const ctx: EnumerationContext = { sourceId: mkEntityId(999), sourceControllerSeat: mkPlayerSeat(0) };
    const eligible = g.targetSystem.enumerate(ctx, restriction);
    expect(eligible).toEqual([{ kind: "card", id: creature }]);
  });

  it("forbidTypes drops the typed card but keeps untyped peers", () => {
    const g = mkGame();
    const creature = addCard(g, 60, mkPlayerSeat(0), ZoneType.Battlefield, [CardType.Creature]);
    const artifactCreature = addCard(g, 61, mkPlayerSeat(0), ZoneType.Battlefield, [
      CardType.Creature,
      CardType.Artifact,
    ]);
    const restriction: TargetRestriction = {
      controllerScope: "any",
      permitZones: new Set([ZoneType.Battlefield]),
      permitTypes: new Set([CardType.Creature]),
      forbidTypes: new Set([CardType.Artifact]),
      minTargets: 1,
      maxTargets: 1,
      mayTargetPlayers: false,
    };
    const ctx: EnumerationContext = { sourceId: mkEntityId(999), sourceControllerSeat: mkPlayerSeat(0) };
    const eligible = g.targetSystem.enumerate(ctx, restriction);
    const ids = eligible.map((r) => (r.kind === "card" ? r.id : null));
    expect(ids).toContain(creature);
    expect(ids).not.toContain(artifactCreature);
  });

  it("permitTypes is a disjunction: any one of the permitted types is enough", () => {
    const g = mkGame();
    const creature = addCard(g, 62, mkPlayerSeat(0), ZoneType.Battlefield, [CardType.Creature]);
    const planeswalker = addCard(g, 63, mkPlayerSeat(0), ZoneType.Battlefield, [CardType.Planeswalker]);
    addCard(g, 64, mkPlayerSeat(0), ZoneType.Battlefield, [CardType.Land]);
    const restriction: TargetRestriction = {
      controllerScope: "any",
      permitZones: new Set([ZoneType.Battlefield]),
      permitTypes: new Set([CardType.Creature, CardType.Planeswalker]),
      forbidTypes: new Set(),
      minTargets: 1,
      maxTargets: 1,
      mayTargetPlayers: false,
    };
    const ctx: EnumerationContext = { sourceId: mkEntityId(999), sourceControllerSeat: mkPlayerSeat(0) };
    const eligible = g.targetSystem.enumerate(ctx, restriction);
    const ids = eligible.map((r) => (r.kind === "card" ? r.id : null));
    expect(ids).toContain(creature);
    expect(ids).toContain(planeswalker);
    expect(ids).toHaveLength(2);
  });
});

describe("TargetSystem.enumerate — self-source rule", () => {
  it("forbidSelfSource excludes the source card from the eligibility set", () => {
    const g = mkGame();
    const src = addCard(g, 70, mkPlayerSeat(0), ZoneType.Battlefield);
    const other = addCard(g, 71, mkPlayerSeat(0), ZoneType.Battlefield);
    const restriction: TargetRestriction = {
      controllerScope: "any",
      permitZones: new Set([ZoneType.Battlefield]),
      permitTypes: new Set(),
      forbidTypes: new Set(),
      minTargets: 1,
      maxTargets: 1,
      mayTargetPlayers: false,
      forbidSelfSource: true,
    };
    const ctx: EnumerationContext = { sourceId: src, sourceControllerSeat: mkPlayerSeat(0) };
    const eligible = g.targetSystem.enumerate(ctx, restriction);
    expect(eligible).toEqual([{ kind: "card", id: other }]);
  });
});

describe("TargetSystem.enumerate — players", () => {
  it("includes players when mayTargetPlayers is true, filtered by scope", () => {
    const g = mkGame();
    const restrictionAny: TargetRestriction = {
      controllerScope: "any",
      permitZones: new Set([ZoneType.Battlefield]),
      permitTypes: new Set(),
      forbidTypes: new Set(),
      minTargets: 1,
      maxTargets: 1,
      mayTargetPlayers: true,
    };
    const ctx: EnumerationContext = { sourceId: mkEntityId(999), sourceControllerSeat: mkPlayerSeat(0) };
    const any = g.targetSystem.enumerate(ctx, restrictionAny);
    const seats = any.flatMap((r) => (r.kind === "player" ? [r.seat] : []));
    expect(seats).toHaveLength(2);

    const restrictionOpp: TargetRestriction = { ...restrictionAny, controllerScope: "opponent" };
    const opp = g.targetSystem.enumerate(ctx, restrictionOpp);
    const oppSeats = opp.flatMap((r) => (r.kind === "player" ? [r.seat] : []));
    expect(oppSeats).toEqual([mkPlayerSeat(1)]);
  });

  it("excludes players entirely when mayTargetPlayers is false", () => {
    const g = mkGame();
    addCard(g, 80, mkPlayerSeat(0), ZoneType.Battlefield);
    const restriction: TargetRestriction = {
      controllerScope: "any",
      permitZones: new Set([ZoneType.Battlefield]),
      permitTypes: new Set(),
      forbidTypes: new Set(),
      minTargets: 1,
      maxTargets: 1,
      mayTargetPlayers: false,
    };
    const ctx: EnumerationContext = { sourceId: mkEntityId(999), sourceControllerSeat: mkPlayerSeat(0) };
    const eligible = g.targetSystem.enumerate(ctx, restriction);
    expect(eligible.every((r) => r.kind === "card")).toBe(true);
  });
});

describe("TargetSystem.enumerate — hexproof / shroud", () => {
  it("hexproof skips opponent's cards but includes controller's own", () => {
    const g = mkGame();
    const mine = addCard(g, 90, mkPlayerSeat(0), ZoneType.Battlefield);
    addCard(g, 91, mkPlayerSeat(1), ZoneType.Battlefield);
    const restriction: TargetRestriction = {
      controllerScope: "any",
      permitZones: new Set([ZoneType.Battlefield]),
      permitTypes: new Set(),
      forbidTypes: new Set(),
      minTargets: 1,
      maxTargets: 1,
      mayTargetPlayers: false,
      hexproof: true,
    };
    const ctx: EnumerationContext = { sourceId: mkEntityId(999), sourceControllerSeat: mkPlayerSeat(0) };
    const eligible = g.targetSystem.enumerate(ctx, restriction);
    expect(eligible).toEqual([{ kind: "card", id: mine }]);
  });

  it("shroud skips every card regardless of controller", () => {
    const g = mkGame();
    addCard(g, 92, mkPlayerSeat(0), ZoneType.Battlefield);
    addCard(g, 93, mkPlayerSeat(1), ZoneType.Battlefield);
    const restriction: TargetRestriction = {
      controllerScope: "any",
      permitZones: new Set([ZoneType.Battlefield]),
      permitTypes: new Set(),
      forbidTypes: new Set(),
      minTargets: 1,
      maxTargets: 1,
      mayTargetPlayers: false,
      shroud: true,
    };
    const ctx: EnumerationContext = { sourceId: mkEntityId(999), sourceControllerSeat: mkPlayerSeat(0) };
    const eligible = g.targetSystem.enumerate(ctx, restriction);
    expect(eligible).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateAtCast
// ---------------------------------------------------------------------------

describe("TargetSystem.validateAtCast", () => {
  const mkCtx = (sourceId: EntityId): EnumerationContext => ({
    sourceId,
    sourceControllerSeat: mkPlayerSeat(0),
  });

  const singleTargetAnyBf = (): TargetRestriction => ({
    controllerScope: "any",
    permitZones: new Set([ZoneType.Battlefield]),
    permitTypes: new Set(),
    forbidTypes: new Set(),
    minTargets: 1,
    maxTargets: 1,
    mayTargetPlayers: false,
  });

  it("returns true for a legal single-target selection", () => {
    const g = mkGame();
    const id = addCard(g, 100, mkPlayerSeat(0), ZoneType.Battlefield);
    const choices: TargetChoices = { targets: [cardTarget(id)] };
    expect(g.targetSystem.validateAtCast(choices, mkCtx(mkEntityId(999)), singleTargetAnyBf())).toBe(true);
  });

  it("returns false when target count is below minTargets", () => {
    const g = mkGame();
    addCard(g, 101, mkPlayerSeat(0), ZoneType.Battlefield);
    const choices: TargetChoices = { targets: [] };
    expect(g.targetSystem.validateAtCast(choices, mkCtx(mkEntityId(999)), singleTargetAnyBf())).toBe(false);
  });

  it("returns false when target count exceeds maxTargets", () => {
    const g = mkGame();
    const a = addCard(g, 102, mkPlayerSeat(0), ZoneType.Battlefield);
    const b = addCard(g, 103, mkPlayerSeat(0), ZoneType.Battlefield);
    const choices: TargetChoices = { targets: [cardTarget(a), cardTarget(b)] };
    expect(g.targetSystem.validateAtCast(choices, mkCtx(mkEntityId(999)), singleTargetAnyBf())).toBe(false);
  });

  it("returns false for a target not in the eligibility set", () => {
    const g = mkGame();
    addCard(g, 104, mkPlayerSeat(0), ZoneType.Battlefield);
    // Target a card that exists but is in Hand (not Battlefield).
    const handCard = addCard(g, 105, mkPlayerSeat(0), ZoneType.Hand);
    const choices: TargetChoices = { targets: [cardTarget(handCard)] };
    expect(g.targetSystem.validateAtCast(choices, mkCtx(mkEntityId(999)), singleTargetAnyBf())).toBe(false);
  });

  it("returns false for duplicate targets (same card twice)", () => {
    const g = mkGame();
    const id = addCard(g, 106, mkPlayerSeat(0), ZoneType.Battlefield);
    const restriction: TargetRestriction = { ...singleTargetAnyBf(), minTargets: 2, maxTargets: 2 };
    const choices: TargetChoices = { targets: [cardTarget(id), cardTarget(id)] };
    expect(g.targetSystem.validateAtCast(choices, mkCtx(mkEntityId(999)), restriction)).toBe(false);
  });

  it("returns true when divideX sum equals amount", () => {
    const g = mkGame();
    const a = addCard(g, 107, mkPlayerSeat(0), ZoneType.Battlefield);
    const b = addCard(g, 108, mkPlayerSeat(0), ZoneType.Battlefield);
    const restriction: TargetRestriction = {
      ...singleTargetAnyBf(),
      minTargets: 1,
      maxTargets: 3,
      divideX: { amount: 3 },
    };
    const choices: TargetChoices = { targets: [cardTarget(a), cardTarget(b)], divisions: { 0: 2, 1: 1 } };
    expect(g.targetSystem.validateAtCast(choices, mkCtx(mkEntityId(999)), restriction)).toBe(true);
  });

  it("returns false when divideX sum differs from amount", () => {
    const g = mkGame();
    const a = addCard(g, 109, mkPlayerSeat(0), ZoneType.Battlefield);
    const b = addCard(g, 110, mkPlayerSeat(0), ZoneType.Battlefield);
    const restriction: TargetRestriction = {
      ...singleTargetAnyBf(),
      minTargets: 1,
      maxTargets: 3,
      divideX: { amount: 3 },
    };
    const choices: TargetChoices = { targets: [cardTarget(a), cardTarget(b)], divisions: { 0: 1, 1: 1 } };
    expect(g.targetSystem.validateAtCast(choices, mkCtx(mkEntityId(999)), restriction)).toBe(false);
  });

  it("returns false for negative or non-integer division amounts", () => {
    const g = mkGame();
    const a = addCard(g, 111, mkPlayerSeat(0), ZoneType.Battlefield);
    const b = addCard(g, 112, mkPlayerSeat(0), ZoneType.Battlefield);
    const restriction: TargetRestriction = {
      ...singleTargetAnyBf(),
      minTargets: 1,
      maxTargets: 3,
      divideX: { amount: 3 },
    };
    const negChoices: TargetChoices = {
      targets: [cardTarget(a), cardTarget(b)],
      divisions: { 0: -1, 1: 4 },
    };
    expect(g.targetSystem.validateAtCast(negChoices, mkCtx(mkEntityId(999)), restriction)).toBe(false);

    const floatChoices: TargetChoices = {
      targets: [cardTarget(a), cardTarget(b)],
      divisions: { 0: 1.5, 1: 1.5 },
    };
    expect(g.targetSystem.validateAtCast(floatChoices, mkCtx(mkEntityId(999)), restriction)).toBe(false);
  });

  it("passes empty choices for a zero-target restriction", () => {
    const g = mkGame();
    const restriction: TargetRestriction = {
      controllerScope: "any",
      permitZones: new Set([ZoneType.Battlefield]),
      permitTypes: new Set(),
      forbidTypes: new Set(),
      minTargets: 0,
      maxTargets: 0,
      mayTargetPlayers: false,
    };
    const choices: TargetChoices = { targets: [] };
    expect(g.targetSystem.validateAtCast(choices, mkCtx(mkEntityId(999)), restriction)).toBe(true);
  });
});
