// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 87 — Effect handler TODO sweep round 8.
//
// Closes inline TODO(advanced) tails on six effect handlers:
//   * choose-player:Choices$ — the Forge `Choices$ Player.Opponent` /
//     `Player.You` filter is now validated against the response. Invalid
//     picks stamp `choosePlayer-restriction-violation` on
//     `game.decisionWarnings` and the effect lands on the canonical
//     deterministic fallback (controller for `You`/empty, opponent for
//     `Opponent`).
//   * repeat:RepeatPresent$ + RepeatSVarCompare$ — continuation predicates
//     halt the loop as soon as the predicate fails. RepeatPresent$ matches
//     a battlefield ValidCard; RepeatSVarCompare$ tests the printed SVar
//     numeric value against an `EQ`/`NE`/`LT`/`LE`/`GT`/`GE N` comparison.
//   * wave-22:MultiplePiles — invalid partition responses now stamp a
//     `dividePile-invalid-partition` record on game.decisionWarnings.
//     The engine still falls back to the engine-side even-split.
//   * assemble-contraption:Sprocket$ — yields a `chooseSprocket` decision
//     and stamps the chosen sprocket on the moved card's
//     `assignedSprocket` slot AND on the source's `lastAssembledSprocket`.
//   * game.consumePhaseSkip — pops one matching `player.phaseSkips` entry
//     and stamps a `phase-skipped` record on `game.decisionWarnings`.
//     Closes the SkipPhase turn-loop integration TODO.
//   * wave-22:OpenAttraction — when `player.attractionDeck` is non-empty
//     pops the top card onto the battlefield (mirrors AssembleContraption's
//     deck-pop branch); empty-deck path keeps the legacy counter-bump.
import "./index.js";
import type { LobbyPlayer, PaperCard, SVarAst } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
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
import { SpellAbility } from "../spell-ability.js";

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
const plainPaper: PaperCard = {
  name: "Test",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, p.seat));
  }
  return game;
};

const drainGen = (gen: Generator<unknown, void, unknown>): unknown[] => {
  const out: unknown[] = [];
  let r = gen.next();
  while (!r.done) {
    out.push(r.value);
    r = gen.next();
  }
  return out;
};

const mkSa = (
  handlerKey: string,
  params: Record<string, { kind: string; raw: string }>,
  sourceId = mkEntityId(10),
  controllerSeat = mkPlayerSeat(0),
  targets: ReturnType<typeof mkEntityId>[] = [],
  svars: Map<string, SVarAst> = new Map(),
) =>
  new SpellAbility(
    {
      kind: "spell",
      effect: { handlerKey, params: params as never },
      cost: { raw: "" },
    },
    sourceId,
    controllerSeat,
    svars,
    targets,
  );

const seedSourceCard = (game: Game, sourceId = mkEntityId(10)): Card => {
  const seat0 = mkPlayerSeat(0);
  const c = new Card(sourceId, plainPaper, seat0, seat0, ZoneType.Battlefield);
  game.cards.set(sourceId, c);
  const bf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);
  bf?.add(sourceId);
  return c;
};

// ---------------------------------------------------------------------------
// (1) ChoosePlayer — Choices$ filter validation
// ---------------------------------------------------------------------------

describe("Wave 87 — ChoosePlayer Choices$ validation", () => {
  it("rejects a You-restricted response that names the opponent and lands on the controller", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(6000);
    const source = seedSourceCard(game, sourceId);
    const sa = mkSa("ChoosePlayer", { Choices: { kind: "literal", raw: "Player.You" } }, sourceId, seat0);
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    gen.next();
    let r = gen.next({ kind: "choosePlayer", chosen: [seat1] });
    while (!r.done) r = gen.next();
    expect(source.chosenPlayers).toEqual([seat0]);
    const warn = game.decisionWarnings.find((w) => w.kind === "choosePlayer-restriction-violation");
    expect(warn).toBeDefined();
    expect(warn?.sourceId).toBe(sourceId);
  });

  it("accepts a Player.Opponent response that names the opponent without warning", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(6010);
    const source = seedSourceCard(game, sourceId);
    const sa = mkSa(
      "ChoosePlayer",
      { Choices: { kind: "literal", raw: "Player.Opponent" } },
      sourceId,
      seat0,
    );
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    gen.next();
    let r = gen.next({ kind: "choosePlayer", chosen: [seat1] });
    while (!r.done) r = gen.next();
    expect(source.chosenPlayers).toEqual([seat1]);
    const warn = game.decisionWarnings.find((w) => w.kind === "choosePlayer-restriction-violation");
    expect(warn).toBeUndefined();
  });

  it("on missing response Player.Opponent restriction lands on the opponent", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(6020);
    const source = seedSourceCard(game, sourceId);
    const sa = mkSa(
      "ChoosePlayer",
      { Choices: { kind: "literal", raw: "Player.Opponent" } },
      sourceId,
      seat0,
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(source.chosenPlayers).toEqual([seat1]);
  });
});

// ---------------------------------------------------------------------------
// (2) Repeat — RepeatPresent$ + RepeatSVarCompare$ continuation predicates
// ---------------------------------------------------------------------------

describe("Wave 87 — Repeat continuation predicates", () => {
  it("RepeatPresent$ Creature halts the loop when no creature is on battlefield", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(6100);
    seedSourceCard(game, sourceId);
    const svars = new Map<string, SVarAst>([
      [
        "DBLife",
        {
          kind: "ability",
          raw: "",
          ability: {
            handlerKey: "GainLife",
            params: { LifeAmount: { kind: "literal", raw: "1" } },
          },
        } as unknown as SVarAst,
      ],
    ]);
    const sa = mkSa(
      "Repeat",
      {
        RepeatSubAbility: { kind: "literal", raw: "DBLife" },
        MaxRepeat: { kind: "literal", raw: "5" },
        RepeatPresent: { kind: "literal", raw: "Creature" },
      },
      sourceId,
      seat0,
      [],
      svars,
    );
    const lifeBefore = game.getPlayer(seat0).life;
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    // No creature on the battlefield → predicate fails immediately, no
    // iterations run, life unchanged.
    expect(game.getPlayer(seat0).life).toBe(lifeBefore);
  });

  it("RepeatSVarCompare$ X GE 1 with a numeric SVar set to 0 halts before iteration", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(6110);
    seedSourceCard(game, sourceId);
    const svars = new Map<string, SVarAst>([
      [
        "DBLife",
        {
          kind: "ability",
          raw: "",
          ability: {
            handlerKey: "GainLife",
            params: { LifeAmount: { kind: "literal", raw: "1" } },
          },
        } as unknown as SVarAst,
      ],
      ["X", { kind: "value", raw: "0" } as unknown as SVarAst],
    ]);
    const sa = mkSa(
      "Repeat",
      {
        RepeatSubAbility: { kind: "literal", raw: "DBLife" },
        MaxRepeat: { kind: "literal", raw: "5" },
        RepeatSVarCompare: { kind: "literal", raw: "X GE 1" },
      },
      sourceId,
      seat0,
      [],
      svars,
    );
    const lifeBefore = game.getPlayer(seat0).life;
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.getPlayer(seat0).life).toBe(lifeBefore);
  });

  it("RepeatSVarCompare$ X LT 5 with X=2 still iterates (predicate satisfied)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(6120);
    seedSourceCard(game, sourceId);
    const svars = new Map<string, SVarAst>([
      [
        "DBLife",
        {
          kind: "ability",
          raw: "",
          ability: {
            handlerKey: "GainLife",
            params: { LifeAmount: { kind: "literal", raw: "1" } },
          },
        } as unknown as SVarAst,
      ],
      ["X", { kind: "value", raw: "2" } as unknown as SVarAst],
    ]);
    const sa = mkSa(
      "Repeat",
      {
        RepeatSubAbility: { kind: "literal", raw: "DBLife" },
        MaxRepeat: { kind: "literal", raw: "3" },
        RepeatSVarCompare: { kind: "literal", raw: "X LT 5" },
      },
      sourceId,
      seat0,
      [],
      svars,
    );
    const lifeBefore = game.getPlayer(seat0).life;
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    // The continuation switches the loop to HARD_CAP-bounded; X stays
    // constant at 2, so the predicate holds for HARD_CAP iterations and
    // life increases by HARD_CAP. Verify it advanced by at least
    // MaxRepeat (3) — the iteration count exceeds the legacy cap because
    // continuation lifts the cap for "while predicate holds" loops.
    expect(game.getPlayer(seat0).life).toBeGreaterThanOrEqual(lifeBefore + 3);
  });
});

// ---------------------------------------------------------------------------
// (3) MultiplePiles — invalid partition warning
// ---------------------------------------------------------------------------

describe("Wave 87 — MultiplePiles invalid-partition warning", () => {
  it("stamps a dividePile-invalid-partition record when the splitter response is malformed", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(6200);
    seedSourceCard(game, sourceId);
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    if (!lib) throw new Error("no library");
    for (let i = 0; i < 4; i++) {
      const id = mkEntityId(6210 + i);
      const c = new Card(id, plainPaper, seat0, seat0, ZoneType.Library);
      game.cards.set(id, c);
      lib.add(id);
    }
    const sa = mkSa(
      "MultiplePiles",
      {
        Num: { kind: "literal", raw: "4" },
        Piles: { kind: "literal", raw: "2" },
      },
      sourceId,
      seat0,
    );
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    // Find the dividePileChoice request.
    while (
      !r.done &&
      !(
        typeof r.value === "object" &&
        r.value !== null &&
        (r.value as { request?: { kind?: string } }).request?.kind === "dividePileChoice"
      )
    ) {
      r = gen.next();
    }
    expect(r.done).toBe(false);
    // Respond with a bogus partition (only 1 pile when 2 are required).
    r = gen.next({ kind: "dividePileChoice", piles: [[]] });
    while (!r.done) r = gen.next();
    const warn = game.decisionWarnings.find((w) => w.kind === "dividePile-invalid-partition");
    expect(warn).toBeDefined();
    expect(warn?.sourceId).toBe(sourceId);
  });
});

// ---------------------------------------------------------------------------
// (4) AssembleContraption — chooseSprocket lands on assignedSprocket
// ---------------------------------------------------------------------------

describe("Wave 87 — AssembleContraption Sprocket$ choice", () => {
  it("yields chooseSprocket and stamps the response on lastAssembledSprocket", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(6300);
    const source = seedSourceCard(game, sourceId);
    const sa = mkSa("AssembleContraption", { Amount: { kind: "literal", raw: "1" } }, sourceId, seat0);
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    const first = gen.next();
    expect(first.done).toBe(false);
    const yielded = first.value as { kind: string; request?: { kind: string; sprockets: readonly number[] } };
    expect(yielded.kind).toBe("decision");
    expect(yielded.request?.kind).toBe("chooseSprocket");
    expect(yielded.request?.sprockets).toEqual([1, 2, 3]);
    let r = gen.next({ kind: "chooseSprocket", sprocket: 2 });
    while (!r.done) r = gen.next();
    expect((source as { lastAssembledSprocket?: number }).lastAssembledSprocket).toBe(2);
  });

  it("falls back to sprocket 1 on missing response", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(6310);
    const source = seedSourceCard(game, sourceId);
    const sa = mkSa("AssembleContraption", { Amount: { kind: "literal", raw: "1" } }, sourceId, seat0);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect((source as { lastAssembledSprocket?: number }).lastAssembledSprocket).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (5) game.consumePhaseSkip — pops + decisionWarnings record
// ---------------------------------------------------------------------------

describe("Wave 87 — game.consumePhaseSkip helper", () => {
  it("pops a matching skip and stamps phase-skipped on decisionWarnings", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const player = game.getPlayer(seat0);
    (player as { phaseSkips?: string[] }).phaseSkips = ["Combat"];
    expect(game.consumePhaseSkip(seat0, "Combat")).toBe(true);
    expect((player as { phaseSkips?: string[] }).phaseSkips).toEqual([]);
    const warn = game.decisionWarnings.find((w) => w.kind === "phase-skipped");
    expect(warn).toBeDefined();
  });

  it("returns false (and stamps nothing) when no matching skip is queued", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const player = game.getPlayer(seat0);
    (player as { phaseSkips?: string[] }).phaseSkips = ["Draw"];
    expect(game.consumePhaseSkip(seat0, "Combat")).toBe(false);
    expect((player as { phaseSkips?: string[] }).phaseSkips).toEqual(["Draw"]);
    const warn = game.decisionWarnings.find((w) => w.kind === "phase-skipped");
    expect(warn).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (6) OpenAttraction — pops top of player.attractionDeck onto battlefield
// ---------------------------------------------------------------------------

describe("Wave 87 — OpenAttraction attractionDeck pop", () => {
  it("pops the top of attractionDeck onto the battlefield + stamps openedAttractions", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(6400);
    seedSourceCard(game, sourceId);
    // Stand up an attraction deck with one card.
    const player = game.getPlayer(seat0);
    const deck = new Library(ZoneType.Library, seat0);
    const attractionId = mkEntityId(6410);
    const attractionCard = new Card(attractionId, plainPaper, seat0, seat0, ZoneType.Library);
    game.cards.set(attractionId, attractionCard);
    deck.add(attractionId);
    player.attractionDeck = deck;
    const sa = mkSa("OpenAttraction", { Amount: { kind: "literal", raw: "1" } }, sourceId, seat0);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    // The attraction card should now live on the battlefield.
    const bf = player.zones.get(ZoneType.Battlefield);
    expect(bf?.toArray()).toContain(attractionId);
    expect(deck.size).toBe(0);
    // The ContraptionAssembled pulse should carry cardId.
    const pulse = yields.find(
      (y): y is { kind: "event"; event: { kind: string; payload: { cardId?: unknown } } } =>
        typeof y === "object" &&
        y !== null &&
        (y as { kind?: string }).kind === "event" &&
        (y as { event?: { kind?: string } }).event?.kind === "ContraptionAssembled",
    );
    expect(pulse?.event.payload.cardId).toBe(attractionId);
    // openedAttractions should be 1.
    const rec = game.flags.attractions.get(seat0) as { openedAttractions?: number } | undefined;
    expect(rec?.openedAttractions).toBe(1);
  });

  it("falls back to the legacy counter-bump path when attractionDeck is undefined", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(6420);
    seedSourceCard(game, sourceId);
    const sa = mkSa("OpenAttraction", { Amount: { kind: "literal", raw: "2" } }, sourceId, seat0);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const rec = game.flags.attractions.get(seat0) as { openedAttractions?: number } | undefined;
    expect(rec?.openedAttractions).toBe(2);
    const source = game.cards.get(sourceId);
    expect(source?.attractions).toBe(2);
  });
});
