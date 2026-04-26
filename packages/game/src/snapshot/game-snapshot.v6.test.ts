// SPDX-License-Identifier: GPL-3.0-or-later
// SP2 Milestone X Task 75 — v6 schema round-trip coverage.
//
// The existing game-snapshot.test.ts suite covers the common-case round-trip
// and error paths. This file focuses on the v6-new state slots introduced
// by SP2: CopiableCharacteristics (Card.copiedFrom), FaceDownState tagged
// union, mutate pile / host+augment / meld bookkeeping, Ring state, team-
// life pool, control-change ledger, layer-engine effect arrays, pending-
// trigger queue, and the hardened schemaVersion rejection (v5 input).
import {
  CardType,
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  IncompatibleSnapshotVersionError,
  Layer,
  type LobbyPlayer,
  ManaCost,
  type PaperCard,
  type PlayerSeat,
  SeededRng,
  Supertype,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
  paperCardKey,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { CopiableCharacteristics } from "../copy/copiable-characteristics.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { restore, snapshot } from "./game-snapshot.js";

// === Shared fixtures ==============================================

const alice: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };

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
  appliedVariants: [],
};

const rules2HG: GameRules = { ...rules, appliedVariants: ["TwoHeadedGiant"] };

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "abc",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const paper: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "195",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const paperCards = new Map<string, PaperCard>([[paperCardKey(paper), paper]]);

const makeGame = (seed = 1n, gameRules: GameRules = rules): Game => {
  const g = new Game({
    lobbyPlayers: [alice, bob],
    rules: gameRules,
    meta,
    rng: new SeededRng(seed),
  });
  for (const p of g.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
  }
  return g;
};

const seedCard = (g: Game, owner: number, zone: ZoneType): Card => {
  const id = g.newEntityId();
  const c = new Card(id, paper, mkPlayerSeat(owner), mkPlayerSeat(owner), zone);
  g.cards.set(id, c);
  const p = g.players[owner];
  if (p) {
    const z = p.zones.get(zone);
    if (z) z.add(id);
  }
  return c;
};

const makeRestoreOpts = (gameRules: GameRules = rules) => ({
  lobbyPlayers: [alice, bob],
  rng: new SeededRng(1n),
  paperCards,
  rules: gameRules,
});

const roundTrip = (g: Game, gameRules: GameRules = rules): Game => {
  const snap = snapshot(g);
  const wire = JSON.parse(JSON.stringify(snap)) as typeof snap;
  return restore(wire, makeRestoreOpts(gameRules));
};

// === Tests ========================================================

describe("GameSnapshot v6 (SP2 Milestone X Task 75)", () => {
  it("basic v6/v7 round-trip of an empty game (no cards, no registrations)", () => {
    const g = makeGame();
    const snap1 = snapshot(g);
    const restored = roundTrip(g);
    const snap2 = snapshot(restored);
    expect(snap2.state).toEqual(snap1.state);
    expect(snap2.header.schemaVersion).toBe(7);
  });

  it("rejects v6 input with a clear version-mismatch error (no auto-migration)", () => {
    const g = makeGame();
    const snap = snapshot(g);
    // Force the header to advertise v6 — restore must reject wholesale
    // rather than attempt a partial field-by-field fallback. Mirrors the
    // v5 rejection pattern.
    const v6 = { ...snap, header: { ...snap.header, schemaVersion: 6 } };
    expect(() => restore(v6, makeRestoreOpts())).toThrow(IncompatibleSnapshotVersionError);
    expect(() => restore(v6, makeRestoreOpts())).toThrow(/6.*7|auto-migration is not supported/);
  });

  it("Card.face + mutatedPile + mutatedInto + isAugment + meldedFrom round-trip", () => {
    const g = makeGame();
    const host = seedCard(g, 0, ZoneType.Battlefield);
    const top = seedCard(g, 0, ZoneType.Battlefield);
    const augment = seedCard(g, 0, ZoneType.Battlefield);
    const melded = seedCard(g, 0, ZoneType.Battlefield);
    host.face = "front";
    host.mutatedPile = [top.id, host.id];
    top.mutatedInto = host.id;
    augment.isAugment = true;
    augment.face = "back";
    melded.meldedFrom = [host.id, top.id];
    melded.face = "melded";
    const restored = roundTrip(g);
    const rHost = restored.cards.get(host.id);
    const rTop = restored.cards.get(top.id);
    const rAugment = restored.cards.get(augment.id);
    const rMelded = restored.cards.get(melded.id);
    expect(rHost?.face).toBe("front");
    expect(rHost?.mutatedPile).toEqual([top.id, host.id]);
    expect(rTop?.mutatedInto).toBe(host.id);
    expect(rAugment?.isAugment).toBe(true);
    expect(rAugment?.face).toBe("back");
    expect(rMelded?.meldedFrom).toEqual([host.id, top.id]);
    expect(rMelded?.face).toBe("melded");
  });

  it("Card token / emblem / SBA flags + keywords round-trip", () => {
    const g = makeGame();
    const token = seedCard(g, 0, ZoneType.Battlefield);
    const emblem = seedCard(g, 0, ZoneType.Battlefield);
    const saga = seedCard(g, 0, ZoneType.Battlefield);
    token.isToken = true;
    token.keywords = new Set(["trample", "haste"]);
    emblem.isEmblem = true;
    saga.sagaFinalChapterResolved = true;
    saga.bestowed = true;
    saga.isCommander = true;
    const restored = roundTrip(g);
    const rToken = restored.cards.get(token.id);
    const rEmblem = restored.cards.get(emblem.id);
    const rSaga = restored.cards.get(saga.id);
    expect(rToken?.isToken).toBe(true);
    expect([...(rToken?.keywords ?? [])].sort()).toEqual(["haste", "trample"]);
    expect(rEmblem?.isEmblem).toBe(true);
    expect(rSaga?.sagaFinalChapterResolved).toBe(true);
    expect(rSaga?.bestowed).toBe(true);
    expect(rSaga?.isCommander).toBe(true);
  });

  it("Card.copiedFrom (CopiableCharacteristics) deep round-trip via ManaCost + ColorSet", () => {
    const g = makeGame();
    const copier = seedCard(g, 0, ZoneType.Battlefield);
    const cc: CopiableCharacteristics = {
      name: "Clone Target",
      manaCost: ManaCost.parse("{2}{U}{U}"),
      colorIndicator: ColorSet.fromJSON(0x02),
      supertypes: new Set([Supertype.Legendary]),
      types: new Set([CardType.Creature, CardType.Artifact]),
      subtypes: new Set(["Golem", "Wizard"]),
      colors: ColorSet.fromJSON(0x02),
      rulesText: "Haste. When this enters the battlefield, draw a card.",
      power: 3,
      toughness: 4,
      loyalty: null,
      defense: null,
    };
    copier.copiedFrom = cc;
    const restored = roundTrip(g);
    const rCopier = restored.cards.get(copier.id);
    if (!rCopier) throw new Error("restored copier card missing");
    const r = rCopier.copiedFrom;
    if (r === null) throw new Error("restored copiedFrom unexpectedly null");
    expect(r.name).toBe("Clone Target");
    expect(r.manaCost.cmc()).toBe(4);
    expect(r.colorIndicator?.toJSON()).toBe(0x02);
    expect([...r.supertypes]).toEqual([Supertype.Legendary]);
    expect(new Set(r.types)).toEqual(new Set([CardType.Creature, CardType.Artifact]));
    expect(new Set(r.subtypes)).toEqual(new Set(["Golem", "Wizard"]));
    expect(r.colors.toJSON()).toBe(0x02);
    expect(r.rulesText).toBe("Haste. When this enters the battlefield, draw a card.");
    expect(r.power).toBe(3);
    expect(r.toughness).toBe(4);
    expect(r.loyalty).toBeNull();
    expect(r.defense).toBeNull();
  });

  it("Card.faceDown tagged-union round-trip (morph + disguise + manifest + foretell + cloak)", () => {
    const g = makeGame();
    const morph = seedCard(g, 0, ZoneType.Battlefield);
    const disg = seedCard(g, 0, ZoneType.Battlefield);
    const man = seedCard(g, 0, ZoneType.Battlefield);
    const fore = seedCard(g, 0, ZoneType.Exile);
    const cloak = seedCard(g, 0, ZoneType.Battlefield);
    morph.faceDown = { kind: "morph", cost: ManaCost.parse("{3}") };
    disg.faceDown = { kind: "disguise", wardAmount: 2 };
    man.faceDown = { kind: "manifest" };
    fore.faceDown = { kind: "foretell", castableFrom: "exile" };
    cloak.faceDown = { kind: "cloak" };
    const restored = roundTrip(g);
    const pull = (id: typeof morph.id) => {
      const c = restored.cards.get(id);
      if (!c) throw new Error(`restored card ${id as unknown as number} missing`);
      return c.faceDown;
    };
    const rm = pull(morph.id);
    const rd = pull(disg.id);
    const rman = pull(man.id);
    const rf = pull(fore.id);
    const rc = pull(cloak.id);
    expect(rm.kind).toBe("morph");
    if (rm.kind === "morph") expect(rm.cost.cmc()).toBe(3);
    expect(rd).toEqual({ kind: "disguise", wardAmount: 2 });
    expect(rman).toEqual({ kind: "manifest" });
    expect(rf).toEqual({ kind: "foretell", castableFrom: "exile" });
    expect(rc).toEqual({ kind: "cloak" });
  });

  it("Ring state (per-seat bearer + level) round-trips", () => {
    const g = makeGame();
    const bearer = seedCard(g, 0, ZoneType.Battlefield);
    g.ringState.set(mkPlayerSeat(0), { bearer: bearer.id, level: 3 });
    g.ringState.set(mkPlayerSeat(1), { bearer: null, level: 0 });
    const restored = roundTrip(g);
    const r0 = restored.ringState.get(mkPlayerSeat(0));
    const r1 = restored.ringState.get(mkPlayerSeat(1));
    expect(r0).toEqual({ bearer: bearer.id, level: 3 });
    expect(r1).toEqual({ bearer: null, level: 0 });
  });

  it("teamLife round-trips when 2HG variant is applied (null otherwise)", () => {
    // Non-2HG: teamLife is null on fresh games; round-trip preserves null.
    const g = makeGame();
    const r1 = roundTrip(g);
    expect(r1.teamLife).toBeNull();

    // 2HG: constructor mints a team pool per teamId; round-trip preserves it.
    const g2 = makeGame(1n, rules2HG);
    // Mutate one team's pool to prove values round-trip, not just keys.
    g2.teamLife?.set(0, 27);
    g2.teamLife?.set(1, 13);
    const r2 = roundTrip(g2, rules2HG);
    expect(r2.teamLife).not.toBeNull();
    expect(r2.teamLife?.get(0)).toBe(27);
    expect(r2.teamLife?.get(1)).toBe(13);
  });

  it("pendingControlReverts + companions + controlChangeLedger round-trip", () => {
    const g = makeGame();
    const cardA = seedCard(g, 0, ZoneType.Battlefield);
    const companion = seedCard(g, 1, ZoneType.Command);
    g.pendingControlReverts.push(cardA.id);
    g.companions.set(mkPlayerSeat(0), null);
    g.companions.set(mkPlayerSeat(1), companion.id);
    g.controlChangeLedger.record(cardA.id, mkPlayerSeat(0), { kind: "untilEndOfTurn" }, 7);
    const restored = roundTrip(g);
    expect(restored.pendingControlReverts).toEqual([cardA.id]);
    expect(restored.companions.get(mkPlayerSeat(0))).toBeNull();
    expect(restored.companions.get(mkPlayerSeat(1))).toBe(companion.id);
    const entry = restored.controlChangeLedger.get(cardA.id);
    expect(entry).toBeDefined();
    expect(entry?.priorController).toBe(mkPlayerSeat(0));
    expect(entry?.duration).toEqual({ kind: "untilEndOfTurn" });
    expect(entry?.registeredAtTurn).toBe(7);
  });

  it("LayerEngine effect arrays (text / type / color / ability / pt7a-7e) round-trip", () => {
    const g = makeGame();
    const source = seedCard(g, 0, ZoneType.Battlefield);
    g.layerEngine.textSubstitutions.push({ from: "Goblin", to: "Elf", timestamp: 1 });
    g.layerEngine.typeEffects.push({
      kind: "add",
      cardType: CardType.Creature,
      isCda: false,
      timestamp: 2,
      sourceAbilityId: null,
    });
    g.layerEngine.typeEffects.push({
      kind: "becomes",
      types: new Set([CardType.Artifact, CardType.Land]),
      isCda: true,
      timestamp: 3,
      sourceAbilityId: source.id,
    });
    g.layerEngine.colorEffects.push({
      kind: "set",
      colors: ColorSet.fromJSON(0x15), // WRG
      isCda: false,
      timestamp: 4,
      sourceAbilityId: null,
    });
    g.layerEngine.abilityEffects.push({
      kind: "add",
      abilityId: mkEntityId(1001),
      grantedBy: source.id,
      origin: "layer6",
      timestamp: 5,
      targetCardId: source.id,
    });
    g.layerEngine.pt7a.push({
      kind: "cdaSet",
      power: 2,
      toughness: 3,
      timestamp: 6,
      sourceAbilityId: null,
    });
    g.layerEngine.pt7b.push({
      kind: "set",
      power: 4,
      toughness: 4,
      timestamp: 7,
      sourceAbilityId: null,
    });
    g.layerEngine.pt7c.push({
      kind: "modify",
      powerDelta: 1,
      toughnessDelta: 0,
      timestamp: 8,
      sourceAbilityId: null,
    });
    g.layerEngine.pt7d.push({
      kind: "plusOnePlusOne",
      count: 3,
      timestamp: 9,
      sourceAbilityId: null,
    });
    g.layerEngine.pt7e.push({ kind: "switch", timestamp: 10, sourceAbilityId: null });
    const restored = roundTrip(g);
    expect(restored.layerEngine.textSubstitutions).toEqual([{ from: "Goblin", to: "Elf", timestamp: 1 }]);
    expect(restored.layerEngine.typeEffects).toHaveLength(2);
    expect(restored.layerEngine.typeEffects[0]?.kind).toBe("add");
    const becomes = restored.layerEngine.typeEffects[1];
    if (becomes?.kind !== "becomes") throw new Error("expected becomes");
    expect(new Set(becomes.types)).toEqual(new Set([CardType.Artifact, CardType.Land]));
    expect(restored.layerEngine.colorEffects[0]?.colors.toJSON()).toBe(0x15);
    expect(restored.layerEngine.abilityEffects[0]?.timestamp).toBe(5);
    expect(restored.layerEngine.pt7a[0]?.power).toBe(2);
    expect(restored.layerEngine.pt7b[0]?.power).toBe(4);
    expect(restored.layerEngine.pt7c[0]?.powerDelta).toBe(1);
    expect(restored.layerEngine.pt7d[0]?.kind).toBe("plusOnePlusOne");
    expect(restored.layerEngine.pt7e[0]?.kind).toBe("switch");
  });

  it("continuous-effect payload round-trips through the v6 pipeline", () => {
    const g = makeGame();
    const source = seedCard(g, 0, ZoneType.Battlefield);
    g.continuousEffects.push({
      id: mkEntityId(500),
      sourceCardId: source.id,
      layer: Layer.L7c_PTModify,
      timestamp: 1,
      duration: { kind: "untilEndOfTurn" },
      payload: { kind: "pt-modify", effect: { power: 2, toughness: 2 } },
    });
    const restored = roundTrip(g);
    expect(restored.continuousEffects).toHaveLength(1);
    expect(restored.continuousEffects[0]?.duration).toEqual({ kind: "untilEndOfTurn" });
    expect(restored.continuousEffects[0]?.payload).toEqual({
      kind: "pt-modify",
      effect: { power: 2, toughness: 2 },
    });
  });

  it("StackItem event + triggerId + lki optional slots round-trip; resolver is dropped", () => {
    const g = makeGame();
    const source = seedCard(g, 0, ZoneType.Battlefield);
    // Minimal GameEvent payload the triggered-ability path uses.
    // WHY: using a real kind (CardDrawn) so future strictness of GameEvent's
    // discriminant doesn't reject the fixture on a later revision.
    g.sharedZones.stack.push({
      id: mkEntityId(777),
      sourceCardId: source.id,
      controllerSeat: mkPlayerSeat(0),
      kind: "triggeredAbility",
      isCast: false,
      targets: null,
      modes: [],
      xValue: null,
      costPaid: null,
      provenance: { originZone: ZoneType.Battlefield, altCostUsed: null, additionalCostsPaid: [] },
      triggerId: mkEntityId(888),
      event: {
        kind: "CardDrawn",
        version: 1,
        turn: 1,
        phase: g.phase,
        payload: { cardId: source.id, playerSeat: mkPlayerSeat(0) },
      },
      lki: null,
      // resolver is a live generator fn — intentionally supplied here to
      // assert the snapshot pipeline drops it rather than serialize it.
      resolver: {
        *resolve() {
          // no-op
        },
      },
    });
    const restored = roundTrip(g);
    const top = restored.sharedZones.stack.top();
    expect(top?.id).toBe(mkEntityId(777));
    expect(top?.triggerId).toBe(mkEntityId(888));
    expect(top?.event?.kind).toBe("CardDrawn");
    expect(top?.lki).toBeNull();
    expect(top?.resolver).toBeUndefined();
  });

  it("terminalState.losses round-trips through v6 when populated", () => {
    const g = makeGame();
    g.terminalState = {
      endedAt: { turn: 9, phase: g.phase },
      outcome: { kind: "win", winner: mkPlayerSeat(0), reason: "last-standing" },
      concededSeats: [mkPlayerSeat(1)] as PlayerSeat[],
      losses: [{ seat: mkPlayerSeat(1), reason: "concede" }],
    };
    const restored = roundTrip(g);
    expect(restored.terminalState?.outcome).toEqual({
      kind: "win",
      winner: mkPlayerSeat(0),
      reason: "last-standing",
    });
    expect(restored.terminalState?.concededSeats).toEqual([mkPlayerSeat(1)]);
    expect(restored.terminalState?.losses).toHaveLength(1);
    expect(restored.terminalState?.losses?.[0]?.reason).toBe("concede");
  });
});
