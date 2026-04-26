// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 42 — selector pack tests.
import type { LobbyPlayer, ManaCostAst, ManaCostJSON, PaperCard } from "@mtg-forge-ts/core";
import {
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

// Build a ManaCostAst (the wire-format) from a Forge-style cost string.
const mkManaCostAst = (raw: string): ManaCostAst => {
  const parsed = ManaCost.parse(raw);
  // ManaCostAst is a JSON-shaped { raw, symbols } pair; ManaCost.toJSON()
  // returns symbols + hasNoCost. The fixture only needs raw + symbols.
  const j: ManaCostJSON = parsed.toJSON();
  return { raw, symbols: j.symbols };
};

const mkCardPaper = (name: string, typeLine: string, manaCostRaw = ""): PaperCard => ({
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
  },
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

// --- Devotion ---------------------------------------------------------------

describe("Count$Devotion.<Color>", () => {
  it("zero permanents → 0", () => {
    const game = mkGame();
    expect(evalCount(game, "Devotion.Black")).toBe(0);
  });

  it("counts colored pips on controller's permanents", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    // BB creature (e.g., Phyrexian Obliterator partial fixture)
    game.cards.set(
      mkEntityId(100),
      new Card(
        mkEntityId(100),
        mkCardPaper("BB", "Creature — Demon", "BB"),
        seat,
        seat,
        ZoneType.Battlefield,
      ),
    );
    // {1}{B} card → 1 black pip
    game.cards.set(
      mkEntityId(101),
      new Card(
        mkEntityId(101),
        mkCardPaper("OneB", "Creature — Zombie", "1 B"),
        seat,
        seat,
        ZoneType.Battlefield,
      ),
    );
    expect(evalCount(game, "Devotion.Black")).toBe(3);
  });

  it("hybrid pips count for either half", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    // {B/G}{B/G} — devotion to Black AND devotion to Green both = 2.
    game.cards.set(
      mkEntityId(200),
      new Card(
        mkEntityId(200),
        mkCardPaper("BGBG", "Creature — Elf Shaman", "B/G B/G"),
        seat,
        seat,
        ZoneType.Battlefield,
      ),
    );
    expect(evalCount(game, "Devotion.Black")).toBe(2);
    expect(evalCount(game, "Devotion.Green")).toBe(2);
  });

  it("phyrexian pips count for their color", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    // {B/P}{B/P} — phyrexian Black; pays for itself or 2 life. CR 700.5
    // counts these toward devotion to Black.
    game.cards.set(
      mkEntityId(300),
      new Card(
        mkEntityId(300),
        mkCardPaper("BPBP", "Creature — Horror", "B/P B/P"),
        seat,
        seat,
        ZoneType.Battlefield,
      ),
    );
    expect(evalCount(game, "Devotion.Black")).toBe(2);
  });

  it("opponent's pips do NOT count", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    game.cards.set(
      mkEntityId(400),
      new Card(
        mkEntityId(400),
        mkCardPaper("BB", "Creature — Demon", "BB"),
        seat1,
        seat1,
        ZoneType.Battlefield,
      ),
    );
    expect(evalCount(game, "Devotion.Black", seat0)).toBe(0);
    expect(evalCount(game, "Devotion.Black", seat1)).toBe(2);
  });

  it("generic pips never count", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    game.cards.set(
      mkEntityId(500),
      new Card(mkEntityId(500), mkCardPaper("Three", "Artifact", "3"), seat, seat, ZoneType.Battlefield),
    );
    expect(evalCount(game, "Devotion.Black")).toBe(0);
  });
});

// --- CastTotalManaSpent -----------------------------------------------------

describe("Count$CastTotalManaSpent", () => {
  it("returns 0 when source card is missing", () => {
    const game = mkGame();
    expect(evalCount(game, "CastTotalManaSpent")).toBe(0);
  });

  it("reads card.manaSpentTotal", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(600);
    const card = new Card(id, mkCardPaper("X", "Creature", ""), seat, seat, ZoneType.Battlefield);
    card.manaSpentTotal = 5;
    game.cards.set(id, card);
    expect(evalCount(game, "CastTotalManaSpent", seat, 600)).toBe(5);
  });

  it("subtype variant returns 0 (TODO advanced)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(601);
    const card = new Card(id, mkCardPaper("X", "Creature", ""), seat, seat, ZoneType.Battlefield);
    card.manaSpentTotal = 7;
    game.cards.set(id, card);
    expect(evalCount(game, "CastTotalManaSpent Snow", seat, 601)).toBe(0);
  });
});

// --- NumColors --------------------------------------------------------------

describe("Count$NumColors", () => {
  it("returns 0 when no source/target", () => {
    const game = mkGame();
    expect(evalCount(game, "NumColors")).toBe(0);
  });

  it("counts source card's distinct colors", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const id = mkEntityId(700);
    // {W}{U}{B} card → 3 colors (Esper-shard).
    game.cards.set(
      id,
      new Card(id, mkCardPaper("WUB", "Creature", "W U B"), seat, seat, ZoneType.Battlefield),
    );
    expect(evalCount(game, "NumColors", seat, 700)).toBe(3);
  });

  it("prefers target over source when targets present", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const src = mkEntityId(800);
    const tgt = mkEntityId(801);
    game.cards.set(
      src,
      new Card(src, mkCardPaper("Mono", "Creature", "W"), seat, seat, ZoneType.Battlefield),
    );
    game.cards.set(
      tgt,
      new Card(tgt, mkCardPaper("Tri", "Creature", "W U B"), seat, seat, ZoneType.Battlefield),
    );
    expect(evalCount(game, "NumColors", seat, 800, [801])).toBe(3);
  });
});

// --- Basic-land subtype counts ---------------------------------------------

const mkLandPaper = (subtype: string): PaperCard =>
  mkCardPaper(`Basic ${subtype}`, `Basic Land — ${subtype}`, "");

describe("Count$Mountains / Plains / Islands / Swamps / Forests", () => {
  it("counts only the requested subtype on controller's battlefield", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    for (let i = 0; i < 3; i++) {
      const id = mkEntityId(900 + i);
      game.cards.set(id, new Card(id, mkLandPaper("Mountain"), seat, seat, ZoneType.Battlefield));
    }
    for (let i = 0; i < 2; i++) {
      const id = mkEntityId(910 + i);
      game.cards.set(id, new Card(id, mkLandPaper("Forest"), seat, seat, ZoneType.Battlefield));
    }
    expect(evalCount(game, "Mountains", seat)).toBe(3);
    expect(evalCount(game, "Forests", seat)).toBe(2);
    expect(evalCount(game, "Plains", seat)).toBe(0);
    expect(evalCount(game, "Islands", seat)).toBe(0);
    expect(evalCount(game, "Swamps", seat)).toBe(0);
  });

  it("ignores opponent's lands and non-battlefield zones", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    // Opponent's Mountain.
    game.cards.set(
      mkEntityId(1000),
      new Card(mkEntityId(1000), mkLandPaper("Mountain"), seat1, seat1, ZoneType.Battlefield),
    );
    // Own Mountain in graveyard.
    game.cards.set(
      mkEntityId(1001),
      new Card(mkEntityId(1001), mkLandPaper("Mountain"), seat0, seat0, ZoneType.Graveyard),
    );
    expect(evalCount(game, "Mountains", seat0)).toBe(0);
  });
});

// --- Storm ------------------------------------------------------------------

describe("Count$Storm", () => {
  it("returns 0 when no spells cast yet", () => {
    const game = mkGame();
    expect(evalCount(game, "Storm")).toBe(0);
  });

  it("returns the controller's spellsCastThisTurn", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    game.flags.spellsCastThisTurn.set(seat, 4);
    expect(evalCount(game, "Storm", seat)).toBe(4);
  });
});

// --- Valid grammar ----------------------------------------------------------

describe("Count$Valid <filter>", () => {
  it("counts battlefield permanents matching the filter", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    // 2 creatures + 1 artifact under our control; opponent has 1 creature.
    game.cards.set(
      mkEntityId(1100),
      new Card(mkEntityId(1100), mkCardPaper("C1", "Creature", "1"), seat, seat, ZoneType.Battlefield),
    );
    game.cards.set(
      mkEntityId(1101),
      new Card(mkEntityId(1101), mkCardPaper("C2", "Creature", "1"), seat, seat, ZoneType.Battlefield),
    );
    game.cards.set(
      mkEntityId(1102),
      new Card(mkEntityId(1102), mkCardPaper("A", "Artifact", "1"), seat, seat, ZoneType.Battlefield),
    );
    const seat1 = mkPlayerSeat(1);
    game.cards.set(
      mkEntityId(1103),
      new Card(mkEntityId(1103), mkCardPaper("EC", "Creature", "1"), seat1, seat1, ZoneType.Battlefield),
    );
    // "Valid Creature.YouCtrl" → 2.
    expect(evalCount(game, "Valid Creature.YouCtrl", seat, 1100)).toBe(2);
    // "Valid Creature" (any controller) → 3.
    expect(evalCount(game, "Valid Creature", seat, 1100)).toBe(3);
  });

  it("supports comma-OR alternatives", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    game.cards.set(
      mkEntityId(1200),
      new Card(mkEntityId(1200), mkCardPaper("C", "Creature", "1"), seat, seat, ZoneType.Battlefield),
    );
    game.cards.set(
      mkEntityId(1201),
      new Card(mkEntityId(1201), mkCardPaper("A", "Artifact", "1"), seat, seat, ZoneType.Battlefield),
    );
    // Creature OR Artifact → 2.
    expect(evalCount(game, "Valid Creature,Artifact", seat, 1200)).toBe(2);
  });
});

describe("Count$ValidGraveyard / ValidExile / ValidHand / ValidLibrary <filter>", () => {
  it("ValidGraveyard counts cards in graveyards (any owner)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    game.cards.set(
      mkEntityId(1300),
      new Card(mkEntityId(1300), mkCardPaper("G1", "Creature", "1"), seat0, seat0, ZoneType.Graveyard),
    );
    game.cards.set(
      mkEntityId(1301),
      new Card(mkEntityId(1301), mkCardPaper("G2", "Creature", "1"), seat1, seat1, ZoneType.Graveyard),
    );
    // Source card so YouCtrl can resolve.
    game.cards.set(
      mkEntityId(1302),
      new Card(mkEntityId(1302), mkCardPaper("Src", "Artifact", "1"), seat0, seat0, ZoneType.Battlefield),
    );
    expect(evalCount(game, "ValidGraveyard Creature", seat0, 1302)).toBe(2);
    expect(evalCount(game, "ValidGraveyard Creature.YouCtrl", seat0, 1302)).toBe(1);
  });

  it("ValidExile / ValidHand / ValidLibrary route to the correct zone", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    game.cards.set(
      mkEntityId(1400),
      new Card(mkEntityId(1400), mkCardPaper("E", "Creature", "1"), seat, seat, ZoneType.Exile),
    );
    game.cards.set(
      mkEntityId(1401),
      new Card(mkEntityId(1401), mkCardPaper("H", "Creature", "1"), seat, seat, ZoneType.Hand),
    );
    game.cards.set(
      mkEntityId(1402),
      new Card(mkEntityId(1402), mkCardPaper("L", "Creature", "1"), seat, seat, ZoneType.Library),
    );
    game.cards.set(
      mkEntityId(1403),
      new Card(mkEntityId(1403), mkCardPaper("Src", "Artifact", "1"), seat, seat, ZoneType.Battlefield),
    );
    expect(evalCount(game, "ValidExile Creature", seat, 1403)).toBe(1);
    expect(evalCount(game, "ValidHand Creature", seat, 1403)).toBe(1);
    expect(evalCount(game, "ValidLibrary Creature", seat, 1403)).toBe(1);
  });

  it("rejects empty filter", () => {
    const game = mkGame();
    expect(evalCount(game, "Valid")).toBe(0);
  });
});
