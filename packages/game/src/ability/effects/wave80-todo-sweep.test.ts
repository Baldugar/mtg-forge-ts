// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 80 — TODO(advanced) sweep on effect handlers.
//
// Closes inline TODO(advanced) tails on six effect handlers:
//   * amass.ts            — yield chooseCard when controller has multiple
//     Armies; falls back to first by iteration on invalid responses.
//   * wave-21:Explore     — emit CardExplored event; on non-land branch
//     yield chooseOption (keep / grave) with deterministic fallback.
//   * wave-21:ExchangeLife — route through changeLife so LifeChanged events
//     fire (and replacement / trigger gates engage).
//   * wave-21:TwoPiles    — yield dividePileChoice + chooseCardsPile,
//     mirroring MultiplePilesEffect's pattern.
//   * wave-19:Connive     — yield chooseCard discard request; honor Num$
//     for multi-Connive cards (counter scales with non-lands discarded).
//   * reveal.ts           — extend coarse RevealValid$ filter to support
//     subtype + color qualifiers (Card.Goblin, Card.White+Creature, ...).
import "./index.js";
import { parseCard } from "@mtg-forge-ts/cards";
import type { LobbyPlayer, PaperCard, SVarAst } from "@mtg-forge-ts/core";
import {
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
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

const armyPaper = (name: string): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(
    `${[`Name:${name}`, "ManaCost:1 B", "Types:Creature Zombie Army", "PT:0/0", "Oracle:Test"].join("\n")}\n`,
    `${name}.txt`,
  ),
});

const goblinPaper = (name: string): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(
    `${[`Name:${name}`, "ManaCost:R", "Types:Creature Goblin", "PT:1/1", "Oracle:Test"].join("\n")}\n`,
    `${name}.txt`,
  ),
});

const islandPaper = (name: string): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(
    `${[`Name:${name}`, "Types:Basic Land Island", "Oracle:Test"].join("\n")}\n`,
    `${name}.txt`,
  ),
});

const angelPaper = (name: string): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(
    `${[`Name:${name}`, "ManaCost:3 W W", "Types:Creature Angel", "PT:4/4", "Oracle:Test"].join("\n")}\n`,
    `${name}.txt`,
  ),
});

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
  svars?: ReadonlyMap<string, SVarAst>,
) =>
  new SpellAbility(
    {
      kind: "spell",
      effect: { handlerKey, params: params as never },
      cost: { raw: "" },
    },
    sourceId,
    controllerSeat,
    svars ?? new Map(),
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

const seedCardOnZone = (
  game: Game,
  paper: PaperCard,
  zone: ZoneType,
  seat = mkPlayerSeat(0),
  id = mkEntityId(20),
): Card => {
  const c = new Card(id, paper, seat, seat, zone);
  game.cards.set(id, c);
  const z = game.getPlayer(seat).zones.get(zone);
  z?.add(id);
  return c;
};

// ---------------------------------------------------------------------------
// (1) Amass — chooseCard for multiple Armies
// ---------------------------------------------------------------------------

describe("Wave 80 — Amass: chooseCard for multiple Armies", () => {
  it("yields a chooseCard request when the controller controls 2+ Armies", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const armyA = seedCardOnZone(game, armyPaper("Army A"), ZoneType.Battlefield, seat, mkEntityId(101));
    const armyB = seedCardOnZone(game, armyPaper("Army B"), ZoneType.Battlefield, seat, mkEntityId(102));
    seedSourceCard(game, mkEntityId(100));

    const sa = mkSa(
      "Amass",
      { Type: { kind: "literal", raw: "Zombie" }, Num: { kind: "literal", raw: "2" } },
      mkEntityId(100),
      seat,
      [],
    );
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    const r = gen.next();
    expect(r.done).toBe(false);
    const decision = r.value as { kind: string; request: { kind: string; pool: readonly unknown[] } };
    expect(decision.kind).toBe("decision");
    expect(decision.request.kind).toBe("chooseCard");
    expect(decision.request.pool.length).toBe(2);

    // Pick armyB.
    let r2 = gen.next({ kind: "chooseCard", chosen: [armyB.id] });
    while (!r2.done) r2 = gen.next();
    expect(armyB.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(2);
    expect(armyA.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(0);
  });

  it("with a single Army the path is forced — no chooseCard yielded", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const armyA = seedCardOnZone(game, armyPaper("Army A"), ZoneType.Battlefield, seat, mkEntityId(110));
    seedSourceCard(game, mkEntityId(111));
    const sa = mkSa(
      "Amass",
      { Type: { kind: "literal", raw: "Zombie" }, Num: { kind: "literal", raw: "1" } },
      mkEntityId(111),
      seat,
    );
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const decisions = yields.filter((y) => (y as { kind?: string }).kind === "decision");
    expect(decisions.length).toBe(0);
    expect(armyA.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (2) ExchangeLife — routes through changeLife
// ---------------------------------------------------------------------------

describe("Wave 80 — ExchangeLife: routes through changeLife", () => {
  it("emits LifeChanged events for both players (so triggers/replacements engage)", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(200));
    const a = game.getPlayer(mkPlayerSeat(0));
    const b = game.getPlayer(mkPlayerSeat(1));
    a.life = 5;
    b.life = 30;
    const sa = mkSa("ExchangeLife", {}, mkEntityId(200), mkPlayerSeat(0));
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const lifeEvents = yields.filter(
      (y) => (y as { event?: { kind: string } }).event?.kind === "LifeChanged",
    );
    expect(lifeEvents.length).toBe(2);
    expect(a.life).toBe(30);
    expect(b.life).toBe(5);
  });

  it("noop when both totals are equal (delta 0 = no events)", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(210));
    const a = game.getPlayer(mkPlayerSeat(0));
    const b = game.getPlayer(mkPlayerSeat(1));
    a.life = 20;
    b.life = 20;
    const sa = mkSa("ExchangeLife", {}, mkEntityId(210), mkPlayerSeat(0));
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const lifeEvents = yields.filter(
      (y) => (y as { event?: { kind: string } }).event?.kind === "LifeChanged",
    );
    expect(lifeEvents.length).toBe(0);
    expect(a.life).toBe(20);
    expect(b.life).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// (3) Connive — chooseCard discard + Num$
// ---------------------------------------------------------------------------

describe("Wave 80 — Connive: chooseCard discard + Num$", () => {
  it("yields chooseCard for the discard step + scales counter by non-lands discarded", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const source = seedSourceCard(game, mkEntityId(300));

    // Seed library top with a couple goblins (so draw produces non-land cards).
    seedCardOnZone(game, goblinPaper("Top1"), ZoneType.Library, seat, mkEntityId(301));
    seedCardOnZone(game, goblinPaper("Top2"), ZoneType.Library, seat, mkEntityId(302));

    const sa = mkSa("Connive", { Num: { kind: "literal", raw: "1" } }, mkEntityId(300), seat, [source.id]);
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    // First yield from drawCards is a card-draw event. Skip non-decision yields.
    while (!r.done && (r.value as { kind?: string }).kind !== "decision") {
      r = gen.next();
    }
    expect(r.done).toBe(false);
    const decision = r.value as { kind: string; request: { kind: string; pool: readonly unknown[] } };
    expect(decision.kind).toBe("decision");
    expect(decision.request.kind).toBe("chooseCard");
    expect(decision.request.pool.length).toBeGreaterThanOrEqual(1);

    // Pick the first card in the pool (a goblin) — non-land = counter applies.
    const discardId = decision.request.pool[0] as ReturnType<typeof mkEntityId>;
    let r2 = gen.next({ kind: "chooseCard", chosen: [discardId] });
    while (!r2.done) r2 = gen.next();
    expect(source.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// (4) Explore — emits CardExplored event + chooser
// ---------------------------------------------------------------------------

describe("Wave 80 — Explore: emit CardExplored + chooser", () => {
  it("emits CardExplored with resultPutIntoHand=true when top is a land", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const source = seedSourceCard(game, mkEntityId(400));
    seedCardOnZone(game, islandPaper("Island"), ZoneType.Library, seat, mkEntityId(401));

    const sa = mkSa("Explore", {}, mkEntityId(400), seat, [source.id]);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const explores = yields.filter((y) => (y as { event?: { kind: string } }).event?.kind === "CardExplored");
    expect(explores.length).toBe(1);
    const ev = (explores[0] as { event: { payload: { resultPutIntoHand: boolean } } }).event;
    expect(ev.payload.resultPutIntoHand).toBe(true);
  });

  it("non-land path yields chooseOption (keep/grave); on grave the card moves to graveyard + counter applies", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const source = seedSourceCard(game, mkEntityId(410));
    const top = seedCardOnZone(game, goblinPaper("TopGoblin"), ZoneType.Library, seat, mkEntityId(411));

    const sa = mkSa("Explore", {}, mkEntityId(410), seat, [source.id]);
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    // The +1/+1 counter applies before the chooseOption is yielded.
    while (!r.done && (r.value as { kind?: string }).kind !== "decision") {
      r = gen.next();
    }
    expect(r.done).toBe(false);
    const decision = r.value as { request: { kind: string; options: readonly { id: string }[] } };
    expect(decision.request.kind).toBe("chooseOption");
    expect(decision.request.options.map((o) => o.id)).toEqual(["keep", "grave"]);

    let r2 = gen.next({ kind: "chooseOption", optionId: "grave" });
    while (!r2.done) r2 = gen.next();
    expect(top.zone).toBe(ZoneType.Graveyard);
    expect(source.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// (5) TwoPiles — dividePileChoice + chooseCardsPile
// ---------------------------------------------------------------------------

describe("Wave 80 — TwoPiles: dividePileChoice + chooseCardsPile", () => {
  it("yields dividePileChoice to the splitter, then chooseCardsPile to the chooser", () => {
    const game = mkGame();
    const ctrlSeat = mkPlayerSeat(0);
    seedSourceCard(game, mkEntityId(500));
    const ids = [mkEntityId(501), mkEntityId(502), mkEntityId(503), mkEntityId(504)];
    for (const id of ids) {
      seedCardOnZone(game, goblinPaper(`Top-${id}`), ZoneType.Library, ctrlSeat, id);
    }

    const sa = mkSa("TwoPiles", { Amount: { kind: "literal", raw: "4" } }, mkEntityId(500), ctrlSeat);
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    const r1 = gen.next();
    expect(r1.done).toBe(false);
    const split = (r1.value as { request: { kind: string; numPiles: number } }).request;
    expect(split.kind).toBe("dividePileChoice");
    expect(split.numPiles).toBe(2);

    // Splitter picks: pileA = [501, 502], pileB = [503, 504].
    const r2 = gen.next({
      kind: "dividePileChoice",
      piles: [
        [ids[0], ids[1]],
        [ids[2], ids[3]],
      ],
    });
    expect(r2.done).toBe(false);
    const pick = (
      r2.value as { request: { kind: string; pileA: readonly unknown[]; pileB: readonly unknown[] } }
    ).request;
    expect(pick.kind).toBe("chooseCardsPile");
    expect(pick.pileA.length).toBe(2);
    expect(pick.pileB.length).toBe(2);

    // Chooser picks pile B (graveyard pile A, hand pile B).
    let r3 = gen.next({ kind: "chooseCardsPile", chosen: "b" });
    while (!r3.done) r3 = gen.next();
    expect(game.cards.get(ids[2] as ReturnType<typeof mkEntityId>)?.zone).toBe(ZoneType.Hand);
    expect(game.cards.get(ids[3] as ReturnType<typeof mkEntityId>)?.zone).toBe(ZoneType.Hand);
    expect(game.cards.get(ids[0] as ReturnType<typeof mkEntityId>)?.zone).toBe(ZoneType.Graveyard);
    expect(game.cards.get(ids[1] as ReturnType<typeof mkEntityId>)?.zone).toBe(ZoneType.Graveyard);
  });

  it("falls back to even-split partition on invalid divider response", () => {
    const game = mkGame();
    const ctrlSeat = mkPlayerSeat(0);
    seedSourceCard(game, mkEntityId(520));
    const ids = [mkEntityId(521), mkEntityId(522)];
    for (const id of ids) {
      seedCardOnZone(game, goblinPaper(`Top-${id}`), ZoneType.Library, ctrlSeat, id);
    }
    const sa = mkSa("TwoPiles", { Amount: { kind: "literal", raw: "2" } }, mkEntityId(520), ctrlSeat);
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    const r1 = gen.next();
    expect(r1.done).toBe(false);
    // Invalid divider response (wrong kind).
    const r2 = gen.next({ kind: "chooseOption", optionId: "ignore" });
    // Still yields chooseCardsPile with the engine fallback even split.
    expect(r2.done).toBe(false);
    const pick = (
      r2.value as { request: { kind: string; pileA: readonly unknown[]; pileB: readonly unknown[] } }
    ).request;
    expect(pick.kind).toBe("chooseCardsPile");
    expect(pick.pileA.length + pick.pileB.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// (6) Reveal — extended coarse filter (subtypes + colors)
// ---------------------------------------------------------------------------

describe("Wave 80 — Reveal: extended filter (subtypes + colors)", () => {
  it("RevealValid$ Card.Goblin reveals goblin-subtype hand cards but not non-goblins", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const source = seedSourceCard(game, mkEntityId(600));
    const goblin = seedCardOnZone(game, goblinPaper("HandGoblin"), ZoneType.Hand, seat, mkEntityId(601));
    const angel = seedCardOnZone(game, angelPaper("HandAngel"), ZoneType.Hand, seat, mkEntityId(602));

    const sa = mkSa("Reveal", { RevealValid: { kind: "literal", raw: "Card.Goblin" } }, source.id, seat);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const revealed = yields
      .filter((y) => (y as { event?: { kind: string } }).event?.kind === "CardsRevealed")
      .map((y) => (y as { event: { payload: { cardIds: readonly unknown[] } } }).event.payload.cardIds);
    expect(revealed.length).toBe(1);
    expect(revealed[0]).toContain(goblin.id);
    expect(revealed[0]).not.toContain(angel.id);
  });

  it("RevealValid$ Card.White+Creature matches white creatures only", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const source = seedSourceCard(game, mkEntityId(610));
    const angel = seedCardOnZone(game, angelPaper("WhiteAngel"), ZoneType.Hand, seat, mkEntityId(611));
    const goblin = seedCardOnZone(game, goblinPaper("RedGoblin"), ZoneType.Hand, seat, mkEntityId(612));
    const island = seedCardOnZone(game, islandPaper("BasicIsland"), ZoneType.Hand, seat, mkEntityId(613));

    const sa = mkSa(
      "Reveal",
      { RevealValid: { kind: "literal", raw: "Card.White+Creature" } },
      source.id,
      seat,
    );
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const revealed = yields
      .filter((y) => (y as { event?: { kind: string } }).event?.kind === "CardsRevealed")
      .map((y) => (y as { event: { payload: { cardIds: readonly unknown[] } } }).event.payload.cardIds);
    expect(revealed.length).toBe(1);
    expect(revealed[0]).toContain(angel.id);
    expect(revealed[0]).not.toContain(goblin.id);
    expect(revealed[0]).not.toContain(island.id);
  });
});
