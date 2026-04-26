// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 51 — SVar selector pack tests:
//   (A) conditional ternary Count$<Flag>.<else>.<then>
//   (B) source-card probes (CardPower / CardCounters_<T> / etc.)
//   (C) per-turn / per-game stat selectors
//   (D) Count$Storm alias (StormCount)
import type { CardDefinition, LobbyPlayer, ManaCostAst, ManaCostJSON, PaperCard } from "@mtg-forge-ts/core";
import {
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaCost,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Exile } from "../../zone/zones/exile.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import type { SvarContext } from "../context.js";
import { evaluateExpression } from "../evaluator.js";
import "./count.js";
import "./wave42-selectors.js";
import "./conditions.js";
import "./card-state.js";
import "./turn-stats.js";

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
  cardDataSyncedAt: "2026-04-26T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
    player.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, player.seat));
  }
  return game;
};

const mkManaCostAst = (raw: string): ManaCostAst => {
  const parsed = ManaCost.parse(raw);
  const j: ManaCostJSON = parsed.toJSON();
  return { raw, symbols: j.symbols };
};

const mkCardPaper = (
  name: string,
  typeLine: string,
  manaCostRaw = "",
  power?: number,
  toughness?: number,
): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name,
    oracle: "",
    types: TypeLine.parse(typeLine),
    manaCost: mkManaCostAst(manaCostRaw),
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
    ...(power !== undefined && toughness !== undefined
      ? { pt: { power: String(power), toughness: String(toughness) } }
      : {}),
  } as CardDefinition,
});

const mkCtx = (
  game: Game,
  controller = mkPlayerSeat(0),
  sourceCardId?: number,
  targets?: readonly number[],
): SvarContext => ({
  game,
  svars: new Map(),
  controller,
  ...(sourceCardId !== undefined ? { sourceCardId: mkEntityId(sourceCardId) } : {}),
  ...(targets !== undefined ? { targets: targets.map((n) => mkEntityId(n)) } : {}),
});

const evalCount = (
  game: Game,
  arg: string,
  controller = mkPlayerSeat(0),
  sourceCardId?: number,
  targets?: readonly number[],
): number =>
  evaluateExpression(
    { kind: "Count", raw: `Count$${arg}`, args: [{ kind: "literal", raw: arg }] },
    mkCtx(game, controller, sourceCardId, targets),
  );

// ============================================================================
// (A) Conditional ternary Count$<Flag>.<else>.<then>
// ============================================================================

describe("Count$<Flag>.<else>.<then> conditional ternary — Hellbent", () => {
  it("hand empty → then", () => {
    const game = mkGame();
    expect(evalCount(game, "Hellbent.0.7")).toBe(7);
  });
  it("hand non-empty → else", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    game.cards.set(
      mkEntityId(1),
      new Card(mkEntityId(1), mkCardPaper("c", "Creature", "1"), seat, seat, ZoneType.Hand),
    );
    game.getPlayer(seat).zones.get(ZoneType.Hand)?.add(mkEntityId(1));
    expect(evalCount(game, "Hellbent.0.7")).toBe(0);
  });
});

describe("Count$<Flag>.<else>.<then> conditional ternary — Metalcraft", () => {
  it("≥3 artifacts → then", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    for (let i = 0; i < 3; i++) {
      const id = mkEntityId(100 + i);
      game.cards.set(id, new Card(id, mkCardPaper("a", "Artifact", "1"), seat, seat, ZoneType.Battlefield));
    }
    expect(evalCount(game, "Metalcraft.1.4")).toBe(4);
  });
  it("<3 artifacts → else", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    for (let i = 0; i < 2; i++) {
      const id = mkEntityId(110 + i);
      game.cards.set(id, new Card(id, mkCardPaper("a", "Artifact", "1"), seat, seat, ZoneType.Battlefield));
    }
    expect(evalCount(game, "Metalcraft.1.4")).toBe(1);
  });
});

describe("Count$<Flag>.<else>.<then> conditional ternary — Delirium", () => {
  it("4 distinct types in graveyard → then", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const types = ["Creature", "Artifact", "Enchantment", "Instant"];
    for (let i = 0; i < types.length; i++) {
      const id = mkEntityId(200 + i);
      const t = types[i];
      if (t === undefined) continue;
      const card = new Card(id, mkCardPaper(`g${i}`, t, "1"), seat, seat, ZoneType.Graveyard);
      game.cards.set(id, card);
      game.getPlayer(seat).zones.get(ZoneType.Graveyard)?.add(id);
    }
    expect(evalCount(game, "Delirium.0.5")).toBe(5);
  });
  it("3 distinct types → else", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const types = ["Creature", "Artifact", "Enchantment"];
    for (let i = 0; i < types.length; i++) {
      const id = mkEntityId(210 + i);
      const t = types[i];
      if (t === undefined) continue;
      const card = new Card(id, mkCardPaper(`g${i}`, t, "1"), seat, seat, ZoneType.Graveyard);
      game.cards.set(id, card);
      game.getPlayer(seat).zones.get(ZoneType.Graveyard)?.add(id);
    }
    expect(evalCount(game, "Delirium.0.5")).toBe(0);
  });
});

describe("Count$<Flag>.<else>.<then> conditional ternary — FatefulHour", () => {
  it("life ≤ 5 → then", () => {
    const game = mkGame();
    game.getPlayer(mkPlayerSeat(0)).life = 5;
    expect(evalCount(game, "FatefulHour.0.10")).toBe(10);
  });
  it("life > 5 → else", () => {
    const game = mkGame();
    game.getPlayer(mkPlayerSeat(0)).life = 6;
    expect(evalCount(game, "FatefulHour.0.10")).toBe(0);
  });
});

describe("Count$<Flag>.<else>.<then> conditional ternary — Landfall", () => {
  it("lands played this turn ≥ 1 → then", () => {
    const game = mkGame();
    game.flags.landsPlayedThisTurn.set(mkPlayerSeat(0), 1);
    expect(evalCount(game, "Landfall.0.3")).toBe(3);
  });
  it("no land → else", () => {
    const game = mkGame();
    expect(evalCount(game, "Landfall.0.3")).toBe(0);
  });
});

describe("Count$<Flag>.<else>.<then> conditional ternary — Revolt", () => {
  it("permanents left BF ≥ 1 → then", () => {
    const game = mkGame();
    game.flags.permanentsLeftBfThisTurn.set(mkPlayerSeat(0), 1);
    expect(evalCount(game, "Revolt.0.2")).toBe(2);
  });
  it("none → else", () => {
    const game = mkGame();
    expect(evalCount(game, "Revolt.0.2")).toBe(0);
  });
});

describe("Count$<Flag>.<else>.<then> conditional ternary — Threshold", () => {
  it("≥7 in graveyard → then", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    for (let i = 0; i < 7; i++) {
      const id = mkEntityId(300 + i);
      const card = new Card(id, mkCardPaper(`g${i}`, "Creature", "1"), seat, seat, ZoneType.Graveyard);
      game.cards.set(id, card);
      game.getPlayer(seat).zones.get(ZoneType.Graveyard)?.add(id);
    }
    expect(evalCount(game, "Threshold.0.4")).toBe(4);
  });
  it("<7 → else", () => {
    const game = mkGame();
    expect(evalCount(game, "Threshold.0.4")).toBe(0);
  });
});

describe("Count$<Flag>.<else>.<then> conditional ternary — Spellmastery", () => {
  it("≥2 instants/sorceries → then", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    for (let i = 0; i < 2; i++) {
      const id = mkEntityId(400 + i);
      const card = new Card(id, mkCardPaper(`s${i}`, "Instant", "1"), seat, seat, ZoneType.Graveyard);
      game.cards.set(id, card);
      game.getPlayer(seat).zones.get(ZoneType.Graveyard)?.add(id);
    }
    expect(evalCount(game, "Spellmastery.0.2")).toBe(2);
  });
  it("only 1 → else", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(410);
    const card = new Card(id, mkCardPaper("s", "Sorcery", "1"), seat, seat, ZoneType.Graveyard);
    game.cards.set(id, card);
    game.getPlayer(seat).zones.get(ZoneType.Graveyard)?.add(id);
    expect(evalCount(game, "Spellmastery.0.2")).toBe(0);
  });
});

describe("Count$<Flag>.<else>.<then> conditional ternary — Heroic (always true)", () => {
  it("returns then unconditionally", () => {
    const game = mkGame();
    expect(evalCount(game, "Heroic.0.3")).toBe(3);
  });
});

describe("Count$<Flag>.<else>.<then> conditional ternary — Kicked / Foretold / Madness / Bargain / Adamant / Surged / Spectacle / Freerunning", () => {
  it("Kicked: card.wasKicked drives then", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(500);
    const card = new Card(id, mkCardPaper("c", "Creature", "1"), seat, seat, ZoneType.Battlefield);
    card.wasKicked = true;
    game.cards.set(id, card);
    expect(evalCount(game, "Kicked.0.7", seat, 500)).toBe(7);
  });
  it("Kicked: unset → else", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(501);
    const card = new Card(id, mkCardPaper("c", "Creature", "1"), seat, seat, ZoneType.Battlefield);
    game.cards.set(id, card);
    expect(evalCount(game, "Kicked.0.7", seat, 501)).toBe(0);
  });
  it("Foretold: card.foretold drives then", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(510);
    const card = new Card(id, mkCardPaper("c", "Creature", "1"), seat, seat, ZoneType.Battlefield);
    card.foretold = true;
    game.cards.set(id, card);
    expect(evalCount(game, "Foretold.0.4", seat, 510)).toBe(4);
  });
  it("Madness: card.madnessCast drives then", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(520);
    const card = new Card(id, mkCardPaper("c", "Creature", "1"), seat, seat, ZoneType.Battlefield);
    card.madnessCast = true;
    game.cards.set(id, card);
    expect(evalCount(game, "Madness.0.5", seat, 520)).toBe(5);
  });
  it("Bargain: card.bargainPaid drives then", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(530);
    const card = new Card(id, mkCardPaper("c", "Creature", "1"), seat, seat, ZoneType.Battlefield);
    card.bargainPaid = true;
    game.cards.set(id, card);
    expect(evalCount(game, "Bargain.1.3", seat, 530)).toBe(3);
  });
  it("Adamant: unset slot → else (TODO advanced)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(540);
    const card = new Card(id, mkCardPaper("c", "Creature", "1"), seat, seat, ZoneType.Battlefield);
    game.cards.set(id, card);
    expect(evalCount(game, "Adamant.0.2", seat, 540)).toBe(0);
  });
  it("Surged: unset slot → else", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(550);
    const card = new Card(id, mkCardPaper("c", "Creature", "1"), seat, seat, ZoneType.Battlefield);
    game.cards.set(id, card);
    expect(evalCount(game, "Surged.0.4", seat, 550)).toBe(0);
  });
  it("Surged: card.surgePaid drives then", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(551);
    const card = new Card(id, mkCardPaper("c", "Creature", "1"), seat, seat, ZoneType.Battlefield);
    card.surgePaid = true;
    game.cards.set(id, card);
    expect(evalCount(game, "Surged.0.4", seat, 551)).toBe(4);
  });
  it("Spectacle: card.spectacleCast drives then", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(560);
    const card = new Card(id, mkCardPaper("c", "Creature", "1"), seat, seat, ZoneType.Battlefield);
    card.spectacleCast = true;
    game.cards.set(id, card);
    expect(evalCount(game, "Spectacle.0.6", seat, 560)).toBe(6);
  });
  it("Freerunning: card.freerunningCast drives then", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(570);
    const card = new Card(id, mkCardPaper("c", "Creature", "1"), seat, seat, ZoneType.Battlefield);
    card.freerunningCast = true;
    game.cards.set(id, card);
    expect(evalCount(game, "Freerunning.0.3", seat, 570)).toBe(3);
  });
});

describe("Count$<Flag>.<else>.<then> conditional ternary — Morbid", () => {
  it("creaturesDiedThisTurn ≥ 1 → then", () => {
    const game = mkGame();
    game.flags.creaturesDiedThisTurn = 1;
    expect(evalCount(game, "Morbid.0.5")).toBe(5);
  });
  it("none → else", () => {
    const game = mkGame();
    expect(evalCount(game, "Morbid.0.5")).toBe(0);
  });
});

describe("Conditional ternary doesn't shadow other compound forms", () => {
  it("Devotion.Black still routes to Devotion handler", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    game.cards.set(
      mkEntityId(600),
      new Card(mkEntityId(600), mkCardPaper("BB", "Creature", "BB"), seat, seat, ZoneType.Battlefield),
    );
    expect(evalCount(game, "Devotion.Black")).toBe(2);
  });
});

// ============================================================================
// (B) Source-card probes
// ============================================================================

describe("Count$CardPower / Count$CardToughness / Count$CardSumPT / Count$CardBasePower", () => {
  it("reads layered P/T from source", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(700);
    game.cards.set(
      id,
      new Card(id, mkCardPaper("c", "Creature", "1", 4, 5), seat, seat, ZoneType.Battlefield),
    );
    expect(evalCount(game, "CardPower", seat, 700)).toBe(4);
    expect(evalCount(game, "CardToughness", seat, 700)).toBe(5);
    expect(evalCount(game, "CardSumPT", seat, 700)).toBe(9);
    expect(evalCount(game, "CardBasePower", seat, 700)).toBe(4);
  });
  it("returns 0 with no source", () => {
    const game = mkGame();
    expect(evalCount(game, "CardPower")).toBe(0);
    expect(evalCount(game, "CardToughness")).toBe(0);
    expect(evalCount(game, "CardSumPT")).toBe(0);
    expect(evalCount(game, "CardBasePower")).toBe(0);
  });
});

describe("Count$CardNumColors", () => {
  it("counts source's distinct colors", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(710);
    game.cards.set(
      id,
      new Card(id, mkCardPaper("WUB", "Creature", "W U B"), seat, seat, ZoneType.Battlefield),
    );
    expect(evalCount(game, "CardNumColors", seat, 710)).toBe(3);
  });
});

describe("Count$CardCounters.<Type>", () => {
  it("reads counter map by type", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(720);
    const card = new Card(id, mkCardPaper("c", "Creature", "1"), seat, seat, ZoneType.Battlefield);
    card.counters.set(CounterType.PlusOnePlusOne, 3);
    card.counters.set(CounterType.Charge, 2);
    game.cards.set(id, card);
    expect(evalCount(game, "CardCounters.P1P1", seat, 720)).toBe(3);
    expect(evalCount(game, "CardCounters.CHARGE", seat, 720)).toBe(2);
    expect(evalCount(game, "CardCounters.MISSING", seat, 720)).toBe(0);
  });
});

describe("Count$CrewSize", () => {
  it("returns 0 when crew slot absent (TODO advanced)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(730);
    game.cards.set(id, new Card(id, mkCardPaper("v", "Artifact", "3"), seat, seat, ZoneType.Battlefield));
    expect(evalCount(game, "CrewSize", seat, 730)).toBe(0);
  });
  it("reads crewedBy length when slot present", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(731);
    const card = new Card(id, mkCardPaper("v", "Artifact", "3"), seat, seat, ZoneType.Battlefield);
    (card as unknown as { crewedBy: number[] }).crewedBy = [1, 2];
    game.cards.set(id, card);
    expect(evalCount(game, "CrewSize", seat, 731)).toBe(2);
  });
});

// ============================================================================
// (C) Per-turn / per-game stats
// ============================================================================

describe("Count$YouDrewThisTurn / LifeYouLostThisTurn / LifeYouGainedThisTurn / LifeOppsLostThisTurn", () => {
  it("reads game.flags maps", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    game.flags.cardsDrawnThisTurn.set(seat0, 3);
    game.flags.lifeLostThisTurn.set(seat0, 4);
    game.flags.lifeGainedThisTurn.set(seat0, 2);
    game.flags.lifeLostThisTurn.set(seat1, 5);
    expect(evalCount(game, "YouDrewThisTurn", seat0)).toBe(3);
    expect(evalCount(game, "LifeYouLostThisTurn", seat0)).toBe(4);
    expect(evalCount(game, "LifeYouGainedThisTurn", seat0)).toBe(2);
    expect(evalCount(game, "LifeOppsLostThisTurn", seat0)).toBe(5);
  });
});

describe("Count$ThisTurnCast / LastTurnCast / ThisTurnEntered / LastTurnEntered", () => {
  it("reads spell + entry counters", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    game.flags.spellsCastThisTurn.set(seat, 4);
    game.flags.lastTurnSpellsCast.set(seat, 3);
    game.flags.cardsEnteredThisTurn.set(seat, 2);
    game.flags.lastTurnCardsEntered.set(seat, 1);
    expect(evalCount(game, "ThisTurnCast", seat)).toBe(4);
    expect(evalCount(game, "LastTurnCast", seat)).toBe(3);
    expect(evalCount(game, "ThisTurnEntered", seat)).toBe(2);
    expect(evalCount(game, "LastTurnEntered", seat)).toBe(1);
  });
});

describe("Count$YouSurveilThisTurn / YouFlipThisTurn / YouCastThisGame", () => {
  it("reads each tracker", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    game.flags.surveiledThisTurn.set(seat, 3);
    game.flags.flippedCoinsThisTurn.set(seat, 2);
    game.flags.spellsCastThisGame.set(seat, 9);
    expect(evalCount(game, "YouSurveilThisTurn", seat)).toBe(3);
    expect(evalCount(game, "YouFlipThisTurn", seat)).toBe(2);
    expect(evalCount(game, "YouCastThisGame", seat)).toBe(9);
  });
});

describe("Count$YouRolledThisTurn(_<face>)", () => {
  it("reads per-face count when suffix present", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    game.flags.rolledDiceThisTurn.set(seat, [1, 6, 6, 4]);
    expect(evalCount(game, "YouRolledThisTurn_6", seat)).toBe(2);
    expect(evalCount(game, "YouRolledThisTurn_1", seat)).toBe(1);
    expect(evalCount(game, "YouRolledThisTurn_3", seat)).toBe(0);
  });
  it("with no suffix returns total rolls", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    game.flags.rolledDiceThisTurn.set(seat, [1, 2, 3]);
    expect(evalCount(game, "YouRolledThisTurn", seat)).toBe(3);
  });
});

describe("Count$AttackersDeclared / LeftBattlefieldThisTurn / LeftGraveyardThisTurn / CountersAddedThisTurn / CountersRemovedThisTurn", () => {
  it("reads from flags", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    game.flags.attackersDeclaredThisTurn.set(seat, 3);
    game.flags.leftBattlefieldThisTurn.add(mkEntityId(800));
    game.flags.leftBattlefieldThisTurn.add(mkEntityId(801));
    game.flags.leftGraveyardThisTurn.add(mkEntityId(802));
    game.flags.countersAddedThisTurn.set(mkEntityId(803), 5);
    game.flags.countersRemovedThisTurn = 4;
    expect(evalCount(game, "AttackersDeclared", seat)).toBe(3);
    expect(evalCount(game, "LeftBattlefieldThisTurn", seat)).toBe(2);
    expect(evalCount(game, "LeftGraveyardThisTurn", seat)).toBe(1);
    expect(evalCount(game, "CountersAddedThisTurn", seat)).toBe(5);
    expect(evalCount(game, "CountersRemovedThisTurn", seat)).toBe(4);
  });
});

describe("Count$UnlockedDoors / DistinctUnlockedDoors", () => {
  it("returns 0 when no card carries the slot (TODO advanced)", () => {
    const game = mkGame();
    expect(evalCount(game, "UnlockedDoors")).toBe(0);
    expect(evalCount(game, "DistinctUnlockedDoors")).toBe(0);
  });
});

// ============================================================================
// (D) StormCount alias + multi-filter Valid
// ============================================================================

describe("Count$StormCount alias", () => {
  it("returns spellsCastThisTurn (same as Count$Storm)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    game.flags.spellsCastThisTurn.set(seat, 6);
    expect(evalCount(game, "Storm", seat)).toBe(6);
    expect(evalCount(game, "StormCount", seat)).toBe(6);
  });
});

describe("Count$Valid <A>,<B> — multi-filter Valid (Tolarian Terror)", () => {
  it("comma-OR sums matches across both filters", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    // 2 Instants in graveyard + 1 Sorcery + 1 unrelated Creature.
    game.cards.set(
      mkEntityId(900),
      new Card(mkEntityId(900), mkCardPaper("i1", "Instant", "1"), seat, seat, ZoneType.Graveyard),
    );
    game.cards.set(
      mkEntityId(901),
      new Card(mkEntityId(901), mkCardPaper("i2", "Instant", "1"), seat, seat, ZoneType.Graveyard),
    );
    game.cards.set(
      mkEntityId(902),
      new Card(mkEntityId(902), mkCardPaper("s1", "Sorcery", "1"), seat, seat, ZoneType.Graveyard),
    );
    game.cards.set(
      mkEntityId(903),
      new Card(mkEntityId(903), mkCardPaper("c1", "Creature", "1"), seat, seat, ZoneType.Graveyard),
    );
    // Source on battlefield so YouCtrl resolves.
    game.cards.set(
      mkEntityId(904),
      new Card(mkEntityId(904), mkCardPaper("src", "Artifact", "1"), seat, seat, ZoneType.Battlefield),
    );
    expect(evalCount(game, "ValidGraveyard Instant.YouCtrl,Sorcery.YouCtrl", seat, 904)).toBe(3);
  });
});
