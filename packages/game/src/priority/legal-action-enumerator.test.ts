// SPDX-License-Identifier: GPL-3.0-or-later
// enumerateLegalActions tests — SP2 Task 41. Exercises the per-card timing
// + restriction + land-drop logic that hydrates the `priority` decision's
// `legalActions` array.
import type {
  EntityId,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
  PriorityAction,
  StaticAbility,
} from "@mtg-forge-ts/core";
import {
  CardType,
  DEFAULT_PAPER_CARD_FLAGS,
  PhaseStep,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { ColorSet, ManaCost } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { CopiableCharacteristics } from "../copy/copiable-characteristics.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import type { Restriction } from "../statics/cant-must-may.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";
import { enumerateLegalActions } from "./legal-action-enumerator.js";

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
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const samplePaper: PaperCard = {
  name: "Test Card",
  edition: "LEA",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  game.phase = PhaseStep.Main1;
  return game;
};

// Inject a type onto a card by setting its `copiedFrom` slot with a
// CopiableCharacteristics containing the desired type set. Layer 1 then
// applies it during computeCharacteristics, so the enumerator sees the
// intended type without touching global layer-engine state.
const mkCopiable = (types: readonly CardType[]): CopiableCharacteristics => ({
  name: "Test",
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
});

const addCard = (
  game: Game,
  id: number,
  seat: PlayerSeat,
  zone: ZoneType,
  types: readonly CardType[],
): Card => {
  const cardId = mkEntityId(id);
  const card = new Card(cardId, samplePaper, seat, seat, zone);
  card.copiedFrom = mkCopiable(types);
  game.cards.set(cardId, card);
  const z = game.getPlayer(seat).zones.get(zone);
  if (!z) throw new Error("test: missing zone");
  z.add(cardId);
  return card;
};

// Plant a dummy StackItem to make `stack.isEmpty()` false. The item's
// content doesn't matter for enumeration — only stack size does.
const pushDummyStackItem = (game: Game): void => {
  game.sharedZones.stack.push({
    id: game.newEntityId(),
    sourceCardId: mkEntityId(9999),
    controllerSeat: mkPlayerSeat(0),
    kind: "spell",
    isCast: true,
    targets: null,
    modes: [],
    xValue: null,
    costPaid: null,
    provenance: {
      originZone: ZoneType.Hand,
      altCostUsed: null,
      additionalCostsPaid: [],
    },
  });
};

const registerCantCast = (game: Game, staticId: number, cardId: EntityId): void => {
  const restriction: Restriction = {
    sourceStaticId: mkEntityId(staticId),
    kind: "cantCast",
    subjectFilter: (subject) => subject === cardId,
  };
  const ability: StaticAbility = {
    id: mkEntityId(staticId),
    kind: "static",
    sourceCardId: mkEntityId(staticId + 1000),
    activeInZones: new Set([ZoneType.Battlefield]),
    timestamp: 1,
    controllerSeatAtReg: mkPlayerSeat(0),
    category: "cantMustMay",
    describe: () => restriction,
  };
  game.staticEffectRegistry.register(ability);
};

describe("enumerateLegalActions (SP2 Task 41)", () => {
  it("empty hand / empty battlefield → only pass", () => {
    const game = mkGame();
    const actions = enumerateLegalActions(game, game.activePlayer);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ kind: "pass" });
  });

  it("active player with a sorcery, main phase + empty stack → pass + castSpell", () => {
    const game = mkGame();
    const sorceryId = addCard(game, 10, game.activePlayer, ZoneType.Hand, [CardType.Sorcery]).id;
    const actions = enumerateLegalActions(game, game.activePlayer);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({ kind: "pass" });
    expect(actions[1]).toEqual({ kind: "castSpell", cardId: sorceryId, zone: ZoneType.Hand });
  });

  it("sorcery in hand but stack non-empty → only pass (sorcery timing fails)", () => {
    const game = mkGame();
    addCard(game, 10, game.activePlayer, ZoneType.Hand, [CardType.Sorcery]);
    pushDummyStackItem(game);
    const actions = enumerateLegalActions(game, game.activePlayer);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ kind: "pass" });
  });

  it("instant in hand at any phase → pass + castSpell even with non-empty stack", () => {
    const game = mkGame();
    const instantId = addCard(game, 10, game.activePlayer, ZoneType.Hand, [CardType.Instant]).id;
    pushDummyStackItem(game);
    const actions = enumerateLegalActions(game, game.activePlayer);
    expect(actions).toContainEqual({ kind: "pass" });
    expect(actions).toContainEqual({ kind: "castSpell", cardId: instantId, zone: ZoneType.Hand });
  });

  it("land in hand, active main phase + empty stack + no drop yet → pass + playLand", () => {
    const game = mkGame();
    const landId = addCard(game, 10, game.activePlayer, ZoneType.Hand, [CardType.Land]).id;
    const actions = enumerateLegalActions(game, game.activePlayer);
    expect(actions).toContainEqual({ kind: "pass" });
    expect(actions).toContainEqual({ kind: "playLand", cardId: landId });
  });

  it("land in hand but stack non-empty → only pass (special action gated)", () => {
    const game = mkGame();
    addCard(game, 10, game.activePlayer, ZoneType.Hand, [CardType.Land]);
    pushDummyStackItem(game);
    const actions = enumerateLegalActions(game, game.activePlayer);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ kind: "pass" });
  });

  it("land-drop already consumed → only pass", () => {
    const game = mkGame();
    addCard(game, 10, game.activePlayer, ZoneType.Hand, [CardType.Land]);
    game.flags.landsPlayedThisTurn.set(game.activePlayer, 1);
    const actions = enumerateLegalActions(game, game.activePlayer);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ kind: "pass" });
  });

  it("cantCast restriction excludes the restricted card's castSpell", () => {
    const game = mkGame();
    const allowedId = addCard(game, 10, game.activePlayer, ZoneType.Hand, [CardType.Sorcery]).id;
    const restrictedId = addCard(game, 11, game.activePlayer, ZoneType.Hand, [CardType.Sorcery]).id;
    registerCantCast(game, 5000, restrictedId);
    const actions = enumerateLegalActions(game, game.activePlayer);
    const spells = actions.filter((a: PriorityAction) => a.kind === "castSpell");
    expect(spells).toHaveLength(1);
    expect(spells[0]).toMatchObject({ kind: "castSpell", cardId: allowedId });
    expect(actions.find((a) => a.kind === "castSpell" && a.cardId === restrictedId)).toBeUndefined();
  });

  it("multi-card hand yields multiple castSpell entries", () => {
    const game = mkGame();
    const a = addCard(game, 10, game.activePlayer, ZoneType.Hand, [CardType.Sorcery]).id;
    const b = addCard(game, 11, game.activePlayer, ZoneType.Hand, [CardType.Instant]).id;
    const c = addCard(game, 12, game.activePlayer, ZoneType.Hand, [CardType.Instant]).id;
    const actions = enumerateLegalActions(game, game.activePlayer);
    const castIds = actions
      .filter((x: PriorityAction) => x.kind === "castSpell")
      .map((x) => (x.kind === "castSpell" ? x.cardId : null));
    expect(castIds).toEqual(expect.arrayContaining([a, b, c]));
    expect(castIds).toHaveLength(3);
  });

  it("non-main phase with an instant still allows castSpell for the instant", () => {
    const game = mkGame();
    game.phase = PhaseStep.Upkeep;
    const instantId = addCard(game, 10, game.activePlayer, ZoneType.Hand, [CardType.Instant]).id;
    const actions = enumerateLegalActions(game, game.activePlayer);
    expect(actions).toContainEqual({ kind: "castSpell", cardId: instantId, zone: ZoneType.Hand });
  });

  it("opponent's hand cards are not enumerated for the current seat", () => {
    const game = mkGame();
    // Put a castable sorcery in seat 1's hand; ask for seat 0's legal actions.
    const opponentSeat = mkPlayerSeat(1);
    addCard(game, 10, opponentSeat, ZoneType.Hand, [CardType.Sorcery]);
    const actions = enumerateLegalActions(game, game.activePlayer);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ kind: "pass" });
  });

  it("non-active player in their own main phase cannot cast sorcery (timing gate on active-ness)", () => {
    const game = mkGame();
    // Seat 0 is active; query seat 1's actions.
    const opponentSeat = mkPlayerSeat(1);
    addCard(game, 10, opponentSeat, ZoneType.Hand, [CardType.Sorcery]);
    const actions = enumerateLegalActions(game, opponentSeat);
    // Only pass — sorcery speed requires caster == active player.
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ kind: "pass" });
  });

  it("non-active player with an instant in their hand may cast it at instant speed", () => {
    const game = mkGame();
    const opponentSeat = mkPlayerSeat(1);
    const instantId = addCard(game, 10, opponentSeat, ZoneType.Hand, [CardType.Instant]).id;
    const actions = enumerateLegalActions(game, opponentSeat);
    expect(actions).toContainEqual({ kind: "castSpell", cardId: instantId, zone: ZoneType.Hand });
  });

  it("unknown seat → just pass (defensive early return)", () => {
    const game = mkGame();
    // Mint a seat that doesn't exist in the roster.
    const actions = enumerateLegalActions(game, mkPlayerSeat(99));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ kind: "pass" });
  });
});
