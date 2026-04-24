// SPDX-License-Identifier: GPL-3.0-or-later
// CR 707.3-11 — copy-effect edge cases integrated through the full LayerEngine
// walk (not just the isolated pure function). Scope: what happens when copy
// layer interacts with token flag, DFC-like layered state, face-down override,
// and the order copy → face-down → Layers 2..7.
//
// Behaviors locked by these tests:
//   - Token copy: target.isToken persists through Layer 1 application.
//   - Token-of-token copy: capturing a token preserves its layered identity.
//   - "DFC" capture (modeled here as a layered state reflecting the currently
//     visible face): capture reads the layered view, not the PaperCard's base.
//   - Face-down source capture: the captured characteristics already reflect
//     the face-down override (Layer 1 runs before capture reads).
//   - Copy-then-face-down on target: face-down override wins (CR 707.11).
//   - Toggling target.faceDown back to "none" re-exposes the copy's values.
//   - Explicitly propagated face-down STATE: target stays face-down itself.
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  CardType,
  Color,
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
import { captureCopiable } from "../copy/capture.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";

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
  seed: "cafebabe",
};

const grizzly: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "195",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const delver: PaperCard = {
  name: "Delver of Secrets",
  edition: "ISD",
  collectorNumber: "51",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const generic: PaperCard = {
  name: "Clone",
  edition: "10E",
  collectorNumber: "67",
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
    rng: new SeededRng(0xcafebaben),
  });
  seedZones(g);
  return g;
};

const addCard = (g: Game, id: number, seat: PlayerSeat, paper: PaperCard = generic): EntityId => {
  const cid = mkEntityId(id);
  const card = new Card(cid, paper, seat, seat, ZoneType.Battlefield);
  g.cards.set(cid, card);
  const z = g.getPlayer(seat).zones.get(ZoneType.Battlefield);
  if (!z) throw new Error("missing battlefield");
  z.add(cid);
  g.layerEngine.bumpEpoch("seed");
  return cid;
};

/**
 * Stamp a vanilla Grizzly Bears layered identity (Creature, 2/2, Green) so
 * captureCopiable reads them from the layered view. The SP2 test layer
 * registers here are UNGATED — effects apply to every live card — so tests
 * that exercise face-down clearing (which needs Layer 5 to stay empty on the
 * face-down card) must not call this helper; they use `stampVanillaBearsPT`
 * instead, which sets only P/T + type and leaves colors out of the global
 * layer register.
 */
const stampVanillaBears = (g: Game, sourceId: EntityId): void => {
  g.layerEngine.typeEffects.push({
    kind: "add",
    cardType: CardType.Creature,
    isCda: false,
    timestamp: 1,
    sourceAbilityId: null,
  });
  g.layerEngine.pt7b.push({
    kind: "set",
    power: 2,
    toughness: 2,
    timestamp: 1,
    sourceAbilityId: null,
  });
  g.layerEngine.colorEffects.push({
    kind: "add",
    colors: ColorSet.of(Color.Green),
    isCda: false,
    timestamp: 1,
    sourceAbilityId: null,
  });
  g.layerEngine.bumpEpoch("stamp");
  void sourceId;
};

/**
 * Stamp type + P/T only (no color); use when a subsequent face-down override
 * must leave target.colors empty.
 */
const stampTypeAndPT = (g: Game): void => {
  g.layerEngine.typeEffects.push({
    kind: "add",
    cardType: CardType.Creature,
    isCda: false,
    timestamp: 1,
    sourceAbilityId: null,
  });
  g.layerEngine.pt7b.push({
    kind: "set",
    power: 2,
    toughness: 2,
    timestamp: 1,
    sourceAbilityId: null,
  });
  g.layerEngine.bumpEpoch("stamp");
};

describe("Layer 1 edge cases — token/DFC/face-down copies (CR 707.3-11)", () => {
  it("token copy of a vanilla creature: isToken persists, characteristics reflect source", () => {
    const g = mkGame();
    const sourceId = addCard(g, 200, mkPlayerSeat(0), grizzly);
    stampVanillaBears(g, sourceId);
    // Target = token that's a copy of the source.
    const targetId = addCard(g, 201, mkPlayerSeat(0), generic);
    const target = g.cards.get(targetId);
    if (!target) throw new Error("missing target");
    target.isToken = true;
    target.copiedFrom = captureCopiable(sourceId, g);
    g.layerEngine.bumpEpoch("apply-copy");
    const chars = g.layerEngine.computeCharacteristics(targetId);
    expect(chars.name).toBe("Grizzly Bears");
    expect(chars.types.has(CardType.Creature)).toBe(true);
    expect(chars.power).toBe(2);
    expect(chars.toughness).toBe(2);
    expect(chars.colors.equals(ColorSet.of(Color.Green))).toBe(true);
    // Token-ness is a Card-level flag — untouched by Layer 1.
    expect(target.isToken).toBe(true);
  });

  it("token copy of a token: captured characteristics reflect source's layered state", () => {
    const g = mkGame();
    // Source is itself a token (isToken flag) — this doesn't alter capture's
    // behavior, but verifies the chain doesn't drop anything.
    const sourceId = addCard(g, 210, mkPlayerSeat(0), grizzly);
    const source = g.cards.get(sourceId);
    if (!source) throw new Error("missing source");
    source.isToken = true;
    stampVanillaBears(g, sourceId);
    // Capture from the token.
    const captured = captureCopiable(sourceId, g);
    expect(captured.name).toBe("Grizzly Bears");
    expect(captured.types.has(CardType.Creature)).toBe(true);
    expect(captured.power).toBe(2);
    // Apply to a second token.
    const targetId = addCard(g, 211, mkPlayerSeat(0), generic);
    const target = g.cards.get(targetId);
    if (!target) throw new Error("missing target");
    target.isToken = true;
    target.copiedFrom = captured;
    g.layerEngine.bumpEpoch("apply");
    const chars = g.layerEngine.computeCharacteristics(targetId);
    expect(chars.name).toBe("Grizzly Bears");
    expect(chars.power).toBe(2);
  });

  it("DFC-like capture reads the currently-visible layered face, not the PaperCard base", () => {
    const g = mkGame();
    const sourceId = addCard(g, 220, mkPlayerSeat(0), delver);
    // SP2 scope: DFC face-switching is deferred to Milestone Q. Here we model
    // the visible-face as whatever Layer 4/5/7 produce. Assume the layered
    // state represents the BACK face (e.g. Insectile Aberration: 3/2 blue
    // Human Insect).
    g.layerEngine.typeEffects.push({
      kind: "add",
      cardType: CardType.Creature,
      isCda: false,
      timestamp: 1,
      sourceAbilityId: null,
    });
    g.layerEngine.pt7b.push({
      kind: "set",
      power: 3,
      toughness: 2,
      timestamp: 1,
      sourceAbilityId: null,
    });
    g.layerEngine.colorEffects.push({
      kind: "add",
      colors: ColorSet.of(Color.Blue),
      isCda: false,
      timestamp: 1,
      sourceAbilityId: null,
    });
    g.layerEngine.bumpEpoch("face-flip");
    const captured = captureCopiable(sourceId, g);
    // Capture reflects the currently-visible (back) face.
    expect(captured.power).toBe(3);
    expect(captured.toughness).toBe(2);
    expect(captured.colors.equals(ColorSet.of(Color.Blue))).toBe(true);
    // Target: a normal (non-DFC) card copies this. CR 707.8: the copy is
    // not itself DFC; it simply has the copied face's characteristics.
    const targetId = addCard(g, 221, mkPlayerSeat(0), generic);
    const target = g.cards.get(targetId);
    if (!target) throw new Error("missing target");
    target.copiedFrom = captured;
    g.layerEngine.bumpEpoch("apply");
    const chars = g.layerEngine.computeCharacteristics(targetId);
    expect(chars.power).toBe(3);
    expect(chars.toughness).toBe(2);
  });

  it("face-down source capture: captured characteristics are the 2/2 override", () => {
    const g = mkGame();
    const sourceId = addCard(g, 230, mkPlayerSeat(0), grizzly);
    // Use PT-only stamp so face-down clearing leaves colors empty (Layer 5
    // color adds are ungated in this simplified test harness — a global
    // color-add would re-colorize the face-down card after Layer 1).
    stampTypeAndPT(g);
    const source = g.cards.get(sourceId);
    if (!source) throw new Error("missing source");
    source.faceDown = { kind: "morph", cost: ManaCost.parse("3") };
    g.layerEngine.bumpEpoch("flip-down");
    // Capture from a face-down source: face-down override already applied
    // by Layer 1 before capture reads.
    const captured = captureCopiable(sourceId, g);
    expect(captured.name).toBe("");
    expect(captured.colors.equals(ColorSet.empty())).toBe(true);
    expect(captured.power).toBe(2);
    expect(captured.toughness).toBe(2);
    expect(captured.types.size).toBe(1);
    expect(captured.types.has(CardType.Creature)).toBe(true);
    expect(captured.subtypes.size).toBe(0);
    // Target is face-up; copiedFrom carries the face-down values. Target
    // shows 2/2 vanilla but is NOT itself face-down (CR 707.11 scoping).
    const targetId = addCard(g, 231, mkPlayerSeat(0), generic);
    const target = g.cards.get(targetId);
    if (!target) throw new Error("missing target");
    target.copiedFrom = captured;
    g.layerEngine.bumpEpoch("apply");
    const chars = g.layerEngine.computeCharacteristics(targetId);
    expect(chars.name).toBe("");
    expect(chars.power).toBe(2);
    expect(chars.toughness).toBe(2);
    expect(target.faceDown.kind).toBe("none");
  });

  it("copy-then-face-down: face-down override wins over copied values (CR 707.11)", () => {
    const g = mkGame();
    const sourceId = addCard(g, 240, mkPlayerSeat(0), grizzly);
    // PT-only stamp — see face-down-source-capture test for rationale.
    stampTypeAndPT(g);
    const targetId = addCard(g, 241, mkPlayerSeat(0), generic);
    const target = g.cards.get(targetId);
    if (!target) throw new Error("missing target");
    target.copiedFrom = captureCopiable(sourceId, g);
    target.faceDown = { kind: "morph", cost: ManaCost.parse("3") };
    g.layerEngine.bumpEpoch("apply");
    const chars = g.layerEngine.computeCharacteristics(targetId);
    // Face-down override wins: name cleared, colorless.
    expect(chars.name).toBe("");
    expect(chars.colors.equals(ColorSet.empty())).toBe(true);
    // Flip back face-up: copy layer re-exposes Grizzly Bears's copiable
    // name; the target is a Creature with layered 2/2.
    target.faceDown = { kind: "none" };
    g.layerEngine.bumpEpoch("flip-up");
    const chars2 = g.layerEngine.computeCharacteristics(targetId);
    expect(chars2.name).toBe("Grizzly Bears");
    expect(chars2.power).toBe(2);
    expect(chars2.toughness).toBe(2);
  });

  it("inherited face-down state: explicitly propagating source.faceDown keeps target face-down", () => {
    const g = mkGame();
    const sourceId = addCard(g, 250, mkPlayerSeat(0), grizzly);
    stampVanillaBears(g, sourceId);
    const source = g.cards.get(sourceId);
    if (!source) throw new Error("missing source");
    source.faceDown = { kind: "manifest" };
    g.layerEngine.bumpEpoch("flip");
    const targetId = addCard(g, 251, mkPlayerSeat(0), generic);
    const target = g.cards.get(targetId);
    if (!target) throw new Error("missing target");
    target.copiedFrom = captureCopiable(sourceId, g);
    // Caller ALSO propagates source's face-down state.
    target.faceDown = source.faceDown;
    g.layerEngine.bumpEpoch("apply");
    const chars = g.layerEngine.computeCharacteristics(targetId);
    expect(chars.name).toBe("");
    expect(chars.power).toBe(2);
    expect(chars.toughness).toBe(2);
    expect(target.faceDown.kind).toBe("manifest");
  });
});

describe("Layer 1 ordering — copy before face-down before Layers 2..7", () => {
  it("static P/T modifiers in Layer 7 still apply on top of a face-down copy", () => {
    const g = mkGame();
    const sourceId = addCard(g, 260, mkPlayerSeat(0), grizzly);
    // Source stamped with 2/2; target copies + is face-down + gets +1/+1
    // counter. Expectation: 3/3 (face-down 2/2 → +1/+1 from Layer 7d).
    g.layerEngine.typeEffects.push({
      kind: "add",
      cardType: CardType.Creature,
      isCda: false,
      timestamp: 1,
      sourceAbilityId: null,
    });
    g.layerEngine.pt7b.push({
      kind: "set",
      power: 2,
      toughness: 2,
      timestamp: 1,
      sourceAbilityId: null,
    });
    g.layerEngine.bumpEpoch("stamp");
    const targetId = addCard(g, 261, mkPlayerSeat(0), generic);
    const target = g.cards.get(targetId);
    if (!target) throw new Error("missing target");
    target.copiedFrom = captureCopiable(sourceId, g);
    target.faceDown = { kind: "morph", cost: ManaCost.parse("3") };
    g.layerEngine.pt7d.push({
      kind: "plusOnePlusOne",
      count: 1,
      timestamp: 2,
      sourceAbilityId: null,
    });
    g.layerEngine.bumpEpoch("apply");
    const chars = g.layerEngine.computeCharacteristics(targetId);
    // Face-down override wins at Layer 1 (2/2 override), then Layer 7d
    // adds +1/+1, producing 3/3.
    expect(chars.power).toBe(3);
    expect(chars.toughness).toBe(3);
  });
});
