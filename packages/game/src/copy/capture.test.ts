// SPDX-License-Identifier: GPL-3.0-or-later
// CR 707.2 — captureCopiable produces a frozen snapshot of a source's
// layered copiable characteristics. Tests cover:
//   1. baseline capture (no layered effects) reflects PaperCard-derived state
//   2. capture after a Layer 4 type-add + Layer 7b P/T set reflects layered
//      state (not base state)
//   3. capture from a card with +1/+1 counters (Layer 7d) reflects the
//      counter bonuses (this exposes why capture reads LAYERED characteristics
//      — P/T counters are not stored on the base)
//   4. captured Sets are independent instances — mutating them doesn't touch
//      the source's characteristics or subsequent captures
//   5. capture from a face-down card reflects the 2/2 colorless typeless
//      override (face-down state flows through Layer 1)
//   6. multiple captures return equivalent but distinct instances
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
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { captureCopiable } from "./capture.js";

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

const addCard = (g: Game, id: number, seat: PlayerSeat, paper: PaperCard = grizzly): EntityId => {
  const cid = mkEntityId(id);
  const card = new Card(cid, paper, seat, seat, ZoneType.Battlefield);
  g.cards.set(cid, card);
  const z = g.getPlayer(seat).zones.get(ZoneType.Battlefield);
  if (!z) throw new Error("missing battlefield");
  z.add(cid);
  g.layerEngine.bumpEpoch("seed");
  return cid;
};

describe("captureCopiable (CR 707.2)", () => {
  it("baseline capture reflects PaperCard-derived state (no layered effects)", () => {
    const g = mkGame();
    const cid = addCard(g, 100, mkPlayerSeat(0));
    const cap = captureCopiable(cid, g);
    // deriveBaseCharacteristics pulls name from PaperCard; everything else
    // stays at empty baseline until SP4's CardDb populates PaperCard.definition.
    expect(cap.name).toBe("Grizzly Bears");
    expect(cap.types.size).toBe(0);
    expect(cap.subtypes.size).toBe(0);
    expect(cap.supertypes.size).toBe(0);
    expect(cap.colors.equals(ColorSet.empty())).toBe(true);
    expect(cap.colorIndicator).toBeNull();
    expect(cap.rulesText).toBe("");
    expect(cap.power).toBeNull();
    expect(cap.toughness).toBeNull();
    expect(cap.loyalty).toBeNull();
    expect(cap.defense).toBeNull();
    expect(cap.manaCost.isNoCost()).toBe(true);
  });

  it("capture after a Layer 4 type-add + Layer 7b P/T set reflects layered state", () => {
    const g = mkGame();
    const cid = addCard(g, 101, mkPlayerSeat(0));
    // Simulate a static that adds Creature + 3/3 (e.g. Opalescence-style).
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
      toughness: 3,
      timestamp: 1,
      sourceAbilityId: null,
    });
    g.layerEngine.bumpEpoch("test");
    const cap = captureCopiable(cid, g);
    expect(cap.types.has(CardType.Creature)).toBe(true);
    expect(cap.power).toBe(3);
    expect(cap.toughness).toBe(3);
  });

  it("capture with +1/+1 counters (Layer 7d) reflects the counter bonuses", () => {
    const g = mkGame();
    const cid = addCard(g, 102, mkPlayerSeat(0));
    // Establish a base P/T via Layer 7b so 7d has something to augment.
    g.layerEngine.pt7b.push({
      kind: "set",
      power: 2,
      toughness: 2,
      timestamp: 1,
      sourceAbilityId: null,
    });
    g.layerEngine.pt7d.push({
      kind: "plusOnePlusOne",
      count: 3,
      timestamp: 2,
      sourceAbilityId: null,
    });
    g.layerEngine.bumpEpoch("test");
    const cap = captureCopiable(cid, g);
    expect(cap.power).toBe(5);
    expect(cap.toughness).toBe(5);
  });

  it("captured Sets are independent instances (mutating capture doesn't affect source)", () => {
    const g = mkGame();
    const cid = addCard(g, 103, mkPlayerSeat(0));
    g.layerEngine.typeEffects.push({
      kind: "add",
      cardType: CardType.Creature,
      isCda: false,
      timestamp: 1,
      sourceAbilityId: null,
    });
    g.layerEngine.bumpEpoch("test");
    const cap = captureCopiable(cid, g);
    expect(cap.types.has(CardType.Creature)).toBe(true);
    // CopiableCharacteristics.types is ReadonlySet<CardType>. Cast through
    // the underlying Set to prove independence from the layered source.
    (cap.types as Set<CardType>).add(CardType.Artifact);
    const live = g.layerEngine.computeCharacteristics(cid);
    expect(live.types.has(CardType.Artifact)).toBe(false);
  });

  it("capture from a face-down card reflects the 2/2 colorless typeless override", () => {
    const g = mkGame();
    const cid = addCard(g, 104, mkPlayerSeat(0));
    const card = g.cards.get(cid);
    if (!card) throw new Error("missing card");
    card.faceDown = { kind: "morph", cost: ManaCost.parse("3") };
    g.layerEngine.bumpEpoch("flip-down");
    const cap = captureCopiable(cid, g);
    // Face-down override: empty name, colorless, Creature type only, 2/2.
    expect(cap.name).toBe("");
    expect(cap.colors.equals(ColorSet.empty())).toBe(true);
    expect(cap.types.size).toBe(1);
    expect(cap.types.has(CardType.Creature)).toBe(true);
    expect(cap.subtypes.size).toBe(0);
    expect(cap.supertypes.size).toBe(0);
    expect(cap.power).toBe(2);
    expect(cap.toughness).toBe(2);
    expect(cap.rulesText).toBe("");
    expect(cap.manaCost.isNoCost()).toBe(true);
  });

  it("multiple captures return equivalent but distinct instances", () => {
    const g = mkGame();
    const cid = addCard(g, 105, mkPlayerSeat(0));
    g.layerEngine.typeEffects.push({
      kind: "add",
      cardType: CardType.Creature,
      isCda: false,
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
    g.layerEngine.bumpEpoch("test");
    const a = captureCopiable(cid, g);
    const b = captureCopiable(cid, g);
    // Equivalent contents.
    expect(a.name).toBe(b.name);
    expect(a.types.size).toBe(b.types.size);
    expect(a.colors.equals(b.colors)).toBe(true);
    // Distinct Set instances so downstream mutations don't alias.
    expect(a.types).not.toBe(b.types);
    expect(a.subtypes).not.toBe(b.subtypes);
    expect(a.supertypes).not.toBe(b.supertypes);
  });
});
