// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 65.B — flag-read derivations on stamped per-card flags.
// Verifies that the stamp/clear lifecycle is consulted by the engine
// at the right derivation point:
//
//   1. card.livingMetal (CR 702.158) — Layer 4 type addition of
//      "Creature" when card.controllerSeat === game.activePlayer.
//   2. card.warpedUntilEot (CR 702.180a) — End-of-turn sweep exiles
//      flagged cards.
//   3. card.compleatedPaidLife (CR 702.156) — Planeswalker ETB hook
//      subtracts 2 from initial loyalty when set.
//   4. Lifecycle: each flag clears after consumption (one-shot).
import type { CardDefinition, EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  CardType,
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  TypeLine,
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
import { Exile } from "../zone/zones/exile.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { sweepEndOfTurnWarpExile } from "./wave65-combat-gates.js";

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
const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "abc",
  cardDataSyncedAt: "2026-04-28T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "wave65b",
};

const ALICE = mkPlayerSeat(0);
const BOB = mkPlayerSeat(1);

const seedZones = (game: Game): void => {
  for (const p of game.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, p.seat));
  }
};

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  seedZones(game);
  game.activePlayer = ALICE;
  return game;
};

const drain = (g: Generator<unknown, void, unknown>): void => {
  let n = g.next();
  while (!n.done) n = g.next();
};

// ---------------------------------------------------------------------
// Read 1 — livingMetal: Layer 4 Creature-add when active turn matches
// controller, off when it doesn't.
// ---------------------------------------------------------------------

const mkVehicleDef = (name = "Mishra's Self-Replicator"): CardDefinition => ({
  name,
  oracle: "",
  // Vehicle subtype lives in the type-line subtypes; the printed type
  // line is "Artifact — Vehicle" until crewing / livingMetal flips it.
  types: TypeLine.parse("Artifact — Vehicle"),
  manaCost: { raw: "4", symbols: [] },
  abilities: [],
  triggers: [],
  replacements: [],
  statics: [],
  keywords: [],
  svars: new Map(),
});

const mkVehiclePaper = (def: CardDefinition): PaperCard => ({
  name: def.name,
  edition: "BRO",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: def,
});

const addBattlefieldCard = (game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
  game.cards.set(id, card);
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  if (!bf) throw new Error("test: missing battlefield");
  bf.add(id);
  return card;
};

describe("Wave 65.B — Read 1: card.livingMetal (Layer 4 Creature add)", () => {
  it("Vehicle with livingMetal IS a creature on its controller's turn", () => {
    const game = mkGame();
    const id = mkEntityId(1);
    const card = addBattlefieldCard(game, mkVehiclePaper(mkVehicleDef()), ALICE, id);
    card.livingMetal = true;
    // Active player is Alice (controller).
    game.activePlayer = ALICE;
    // Bump epoch so the layer engine re-derives.
    game.layerEngine.bumpEpoch("test");
    const chars = game.layerEngine.computeCharacteristics(id);
    expect(chars.types.has(CardType.Creature)).toBe(true);
    // Still an artifact — the addition is additive, not a replacement.
    expect(chars.types.has(CardType.Artifact)).toBe(true);
    expect(chars.subtypes.has("Vehicle")).toBe(true);
  });

  it("Vehicle with livingMetal is NOT a creature on the opponent's turn", () => {
    const game = mkGame();
    const id = mkEntityId(2);
    const card = addBattlefieldCard(game, mkVehiclePaper(mkVehicleDef()), ALICE, id);
    card.livingMetal = true;
    // Active player flipped to Bob.
    game.activePlayer = BOB;
    game.layerEngine.bumpEpoch("test");
    const chars = game.layerEngine.computeCharacteristics(id);
    expect(chars.types.has(CardType.Creature)).toBe(false);
    // Still an artifact / Vehicle baseline.
    expect(chars.types.has(CardType.Artifact)).toBe(true);
    expect(chars.subtypes.has("Vehicle")).toBe(true);
  });

  it("Vehicle WITHOUT livingMetal stays non-creature regardless of active turn", () => {
    const game = mkGame();
    const id = mkEntityId(3);
    addBattlefieldCard(game, mkVehiclePaper(mkVehicleDef()), ALICE, id);
    // No livingMetal flag.
    game.activePlayer = ALICE;
    game.layerEngine.bumpEpoch("test");
    const chars = game.layerEngine.computeCharacteristics(id);
    expect(chars.types.has(CardType.Creature)).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Read 2 — warpedUntilEot: end-of-turn sweep exiles flagged cards.
// ---------------------------------------------------------------------

const mkCreatureDef = (name = "Warpcast Spell"): CardDefinition => ({
  name,
  oracle: "",
  types: TypeLine.parse("Creature — Alien"),
  manaCost: { raw: "1U", symbols: [] },
  pt: { power: "2", toughness: "2" },
  abilities: [],
  triggers: [],
  replacements: [],
  statics: [],
  keywords: [],
  svars: new Map(),
});

describe("Wave 65.B — Read 2: card.warpedUntilEot (EndStep exile sweep)", () => {
  it("warpedUntilEot card is exiled by sweepEndOfTurnWarpExile", () => {
    const game = mkGame();
    const id = mkEntityId(10);
    const card = addBattlefieldCard(
      game,
      {
        name: "Warpcast Spell",
        edition: "EOE",
        collectorNumber: "001",
        language: "en",
        foil: false,
        flags: DEFAULT_PAPER_CARD_FLAGS,
        definition: mkCreatureDef(),
      },
      ALICE,
      id,
    );
    card.warpedUntilEot = true;
    expect(card.zone).toBe(ZoneType.Battlefield);
    drain(sweepEndOfTurnWarpExile(game));
    expect(card.zone).toBe(ZoneType.Exile);
    // Flag cleared after sweep.
    expect(card.warpedUntilEot).toBeUndefined();
  });

  it("non-warped card is unaffected by the EndStep sweep", () => {
    const game = mkGame();
    const id = mkEntityId(11);
    const card = addBattlefieldCard(
      game,
      {
        name: "Bystander",
        edition: "EOE",
        collectorNumber: "002",
        language: "en",
        foil: false,
        flags: DEFAULT_PAPER_CARD_FLAGS,
        definition: mkCreatureDef("Bystander"),
      },
      ALICE,
      id,
    );
    drain(sweepEndOfTurnWarpExile(game));
    expect(card.zone).toBe(ZoneType.Battlefield);
    expect(card.warpedUntilEot).toBeUndefined();
  });

  it("warpedUntilEot lifecycle: warp altcost stamps; sweep clears (one-shot)", () => {
    const game = mkGame();
    const id = mkEntityId(12);
    const card = addBattlefieldCard(
      game,
      {
        name: "Warpcast Spell",
        edition: "EOE",
        collectorNumber: "003",
        language: "en",
        foil: false,
        flags: DEFAULT_PAPER_CARD_FLAGS,
        definition: mkCreatureDef(),
      },
      ALICE,
      id,
    );
    card.warpedUntilEot = true;
    drain(sweepEndOfTurnWarpExile(game));
    expect(card.warpedUntilEot).toBeUndefined();
    // Second sweep is a no-op (flag cleared).
    drain(sweepEndOfTurnWarpExile(game));
    expect(card.zone).toBe(ZoneType.Exile);
  });
});

// ---------------------------------------------------------------------
// Read 3 — compleatedPaidLife: PW ETB subtracts 2 loyalty.
// ---------------------------------------------------------------------

const mkPlaneswalkerDef = (loyalty: string, name = "Tamiyo, Compleated Sage"): CardDefinition => ({
  name,
  oracle: "",
  types: TypeLine.parse("Legendary Planeswalker — Tamiyo"),
  manaCost: { raw: "1GU", symbols: [] },
  loyalty,
  abilities: [],
  triggers: [],
  replacements: [],
  statics: [],
  keywords: [],
  svars: new Map(),
});

const mkPwPaper = (def: CardDefinition): PaperCard => ({
  name: def.name,
  edition: "NEO",
  collectorNumber: "238",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: def,
});

const addCardInHand = (game: Game, paper: PaperCard, seat: PlayerSeat, id: EntityId): Card => {
  const card = new Card(id, paper, seat, seat, ZoneType.Hand);
  game.cards.set(id, card);
  const hand = game.getPlayer(seat).zones.get(ZoneType.Hand);
  if (!hand) throw new Error("test: missing hand");
  hand.add(id);
  return card;
};

describe("Wave 65.B — Read 3: card.compleatedPaidLife (PW ETB loyalty -2)", () => {
  it("PW ETBs with loyalty - 2 when compleatedPaidLife is set", () => {
    const game = mkGame();
    const id = mkEntityId(20);
    // Tamiyo, Compleated Sage prints with 4 loyalty; paid-life Φ → 2.
    const pw = addCardInHand(game, mkPwPaper(mkPlaneswalkerDef("4")), ALICE, id);
    pw.compleatedPaidLife = true;
    drain(game.action.moveTo(id, ZoneType.Battlefield, { toSeat: ALICE }));
    expect(pw.zone).toBe(ZoneType.Battlefield);
    expect(pw.counters.get(CounterType.Loyalty)).toBe(2);
    // Flag cleared after consumption.
    expect(pw.compleatedPaidLife).toBeUndefined();
  });

  it("PW ETBs with FULL loyalty when compleatedPaidLife is NOT set", () => {
    const game = mkGame();
    const id = mkEntityId(21);
    const pw = addCardInHand(game, mkPwPaper(mkPlaneswalkerDef("4")), ALICE, id);
    drain(game.action.moveTo(id, ZoneType.Battlefield, { toSeat: ALICE }));
    expect(pw.counters.get(CounterType.Loyalty)).toBe(4);
  });

  it("compleatedPaidLife clamps at 0 — loyalty 1 paid-life ETBs with 0 counters", () => {
    const game = mkGame();
    const id = mkEntityId(22);
    // Hypothetical 1-loyalty PW; paid-life subtracts 2, clamps at 0.
    const pw = addCardInHand(game, mkPwPaper(mkPlaneswalkerDef("1")), ALICE, id);
    pw.compleatedPaidLife = true;
    drain(game.action.moveTo(id, ZoneType.Battlefield, { toSeat: ALICE }));
    // No counters are stamped (Math.max(0, 1-2) = 0; the stamping skips
    // when starting === 0 to avoid the "amount must be positive" guard
    // in addCounter).
    expect(pw.counters.get(CounterType.Loyalty) ?? 0).toBe(0);
    // Flag still cleared.
    expect(pw.compleatedPaidLife).toBeUndefined();
  });
});
