// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 81 — Effect handler TODO sweep round 2.
//
// Closes inline TODO(advanced) tails on six effect handlers:
//   * wave-21:RingTemptsYou — delegate to the shared `tempt()` helper so the
//     controller actually picks a Ring-bearer (chooseRingBearer decision)
//     and the canonical Ring level / ledger / RingTempted+RingLevelChanged
//     events all engage. Replaces the prior bump-counter-only MVP.
//   * wave-21:ExchangeLifeVariant — route through game.action.changeLife so
//     LifeChanged events fire (CR 119 replacements, Wave 70 gates, per-turn
//     life trackers all engage). Mirrors Wave 80's ExchangeLifeEffect fix.
//   * wave-22:ChooseEvenOdd — yield a typed `chooseEvenOdd` decision so the
//     controller picks; param-override (`Choice$ even`) preserves the
//     deterministic-pre-resolved path used by tests.
//   * wave-22:ChooseSector — yield a typed `chooseSector` decision; honors
//     `Sectors$` (comma-separated candidate set) and falls back to the
//     legacy `Sector$` deterministic param when no response is supplied.
//   * wave-19:LookAt — extend to opponent zones (`Defined$ Player.Opponent`)
//     and full-zone peeks (`LookAtAll$ True`) + cover the Hand zone case.
//   * wave-19:Discover — bottom the remaining exiled cards in random order
//     after the Discover N pick (CR 702.166c "rest go on bottom in a random
//     order"), via game.rng.shuffle.
import "./index.js";
import { parseCard } from "@mtg-forge-ts/cards";
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

const creaturePaper = (name: string): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(
    `${[`Name:${name}`, "ManaCost:1 G", "Types:Creature Elf", "PT:1/1", "Oracle:Test"].join("\n")}\n`,
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
// (1) RingTemptsYou — delegates to tempt() (chooseRingBearer + level)
// ---------------------------------------------------------------------------

describe("Wave 81 — RingTemptsYou: delegates to tempt()", () => {
  it("yields chooseRingBearer when the controller controls a creature", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    seedSourceCard(game, mkEntityId(700));
    const elf = seedCardOnZone(game, creaturePaper("Elf"), ZoneType.Battlefield, seat, mkEntityId(701));

    const sa = mkSa("RingTemptsYou", {}, mkEntityId(700), seat);
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    const r = gen.next();
    expect(r.done).toBe(false);
    const decision = r.value as { kind: string; request: { kind: string; candidateIds: readonly unknown[] } };
    expect(decision.kind).toBe("decision");
    expect(decision.request.kind).toBe("chooseRingBearer");
    expect(decision.request.candidateIds).toContain(elf.id);

    let r2 = gen.next({ kind: "chooseRingBearer", bearerId: elf.id });
    while (!r2.done) r2 = gen.next();

    // Ring level on the seat is now 1; bearer is the elf.
    const state = game.ringState.get(seat);
    expect(state?.level).toBe(1);
    expect(state?.bearer).toBe(elf.id);
  });

  it("clamps level at 4 across repeated tempts", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    seedSourceCard(game, mkEntityId(710));
    seedCardOnZone(game, creaturePaper("Elf"), ZoneType.Battlefield, seat, mkEntityId(711));
    for (let i = 0; i < 6; i++) {
      const sa = mkSa("RingTemptsYou", {}, mkEntityId(710), seat);
      const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
      let r = gen.next();
      while (!r.done) {
        if ((r.value as { kind?: string }).kind === "decision") {
          r = gen.next({ kind: "chooseRingBearer", bearerId: mkEntityId(711) });
        } else {
          r = gen.next();
        }
      }
    }
    expect(game.ringState.get(seat)?.level).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// (2) ExchangeLifeVariant — routes through changeLife
// ---------------------------------------------------------------------------

describe("Wave 81 — ExchangeLifeVariant: routes through changeLife", () => {
  it("emits LifeChanged events for both seats when condition holds", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(720));
    const a = game.getPlayer(mkPlayerSeat(0));
    const b = game.getPlayer(mkPlayerSeat(1));
    a.life = 4;
    b.life = 28;
    const sa = mkSa(
      "ExchangeLifeVariant",
      { Condition: { kind: "literal", raw: "LowerLife" } },
      mkEntityId(720),
      mkPlayerSeat(0),
    );
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const lifeEvents = yields.filter(
      (y) => (y as { event?: { kind: string } }).event?.kind === "LifeChanged",
    );
    expect(lifeEvents.length).toBe(2);
    expect(a.life).toBe(28);
    expect(b.life).toBe(4);
  });

  it("noop when condition fails — neither seat's life changes", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(730));
    const a = game.getPlayer(mkPlayerSeat(0));
    const b = game.getPlayer(mkPlayerSeat(1));
    a.life = 30;
    b.life = 5;
    // Condition$ LowerLife requires a < b; here a >= b so it should not swap.
    const sa = mkSa(
      "ExchangeLifeVariant",
      { Condition: { kind: "literal", raw: "LowerLife" } },
      mkEntityId(730),
      mkPlayerSeat(0),
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(a.life).toBe(30);
    expect(b.life).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// (3) ChooseEvenOdd — typed decision yield
// ---------------------------------------------------------------------------

describe("Wave 81 — ChooseEvenOdd: typed decision yield", () => {
  it("yields a chooseEvenOdd decision when no Choice$ override is present", () => {
    const game = mkGame();
    const source = seedSourceCard(game, mkEntityId(740));
    const sa = mkSa("ChooseEvenOdd", {}, mkEntityId(740), mkPlayerSeat(0));
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    const r = gen.next();
    expect(r.done).toBe(false);
    const decision = r.value as { kind: string; request: { kind: string; playerSeat: unknown } };
    expect(decision.kind).toBe("decision");
    expect(decision.request.kind).toBe("chooseEvenOdd");

    let r2 = gen.next({ kind: "chooseEvenOdd", choice: "even" });
    while (!r2.done) r2 = gen.next();
    expect((source as unknown as { chosenEvenOdd?: string }).chosenEvenOdd).toBe("even");
  });

  it("respects Choice$ override without yielding a decision", () => {
    const game = mkGame();
    const source = seedSourceCard(game, mkEntityId(750));
    const sa = mkSa(
      "ChooseEvenOdd",
      { Choice: { kind: "literal", raw: "even" } },
      mkEntityId(750),
      mkPlayerSeat(0),
    );
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const decisions = yields.filter((y) => (y as { kind?: string }).kind === "decision");
    expect(decisions.length).toBe(0);
    expect((source as unknown as { chosenEvenOdd?: string }).chosenEvenOdd).toBe("even");
  });
});

// ---------------------------------------------------------------------------
// (4) ChooseSector — typed decision yield
// ---------------------------------------------------------------------------

describe("Wave 81 — ChooseSector: typed decision yield", () => {
  it("yields a chooseSector decision and stamps the chosen sector", () => {
    const game = mkGame();
    const source = seedSourceCard(game, mkEntityId(760));
    const sa = mkSa(
      "ChooseSector",
      { Sectors: { kind: "literal", raw: "1,2,3" } },
      mkEntityId(760),
      mkPlayerSeat(0),
    );
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    const r = gen.next();
    expect(r.done).toBe(false);
    const decision = r.value as { kind: string; request: { kind: string; sectorIds: readonly string[] } };
    expect(decision.kind).toBe("decision");
    expect(decision.request.kind).toBe("chooseSector");
    expect([...decision.request.sectorIds]).toEqual(["1", "2", "3"]);

    let r2 = gen.next({ kind: "chooseSector", sectorId: "2" });
    while (!r2.done) r2 = gen.next();
    expect((source as unknown as { chosenSector?: string }).chosenSector).toBe("2");
  });

  it("falls back to Sector$ legacy param on missing response", () => {
    const game = mkGame();
    const source = seedSourceCard(game, mkEntityId(770));
    const sa = mkSa(
      "ChooseSector",
      { Sector: { kind: "literal", raw: "5" } },
      mkEntityId(770),
      mkPlayerSeat(0),
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect((source as unknown as { chosenSector?: string }).chosenSector).toBe("5");
  });
});

// ---------------------------------------------------------------------------
// (5) LookAt — opponent + LookAtAll + Hand zones
// ---------------------------------------------------------------------------

describe("Wave 81 — LookAt: opponent + LookAtAll + Hand zones", () => {
  it("with Defined$ Player.Opponent peeks at opponent's library top", () => {
    const game = mkGame();
    const ctrl = mkPlayerSeat(0);
    const opp = mkPlayerSeat(1);
    seedSourceCard(game, mkEntityId(800));
    const oppTop = seedCardOnZone(game, goblinPaper("Top"), ZoneType.Library, opp, mkEntityId(801));

    const sa = mkSa(
      "LookAt",
      {
        Defined: { kind: "literal", raw: "Player.Opponent" },
        LookAtAmount: { kind: "literal", raw: "1" },
      },
      mkEntityId(800),
      ctrl,
    );
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const reveals = yields
      .filter((y) => (y as { event?: { kind: string } }).event?.kind === "CardsRevealed")
      .map(
        (y) =>
          (
            y as {
              event: {
                payload: {
                  revealedBy: unknown;
                  revealedTo: readonly unknown[];
                  cardIds: readonly unknown[];
                  fromZone: unknown;
                };
              };
            }
          ).event.payload,
      );
    expect(reveals.length).toBe(1);
    const ev = reveals[0] as {
      revealedBy: unknown;
      revealedTo: readonly unknown[];
      cardIds: readonly unknown[];
      fromZone: unknown;
    };
    expect(ev.revealedBy).toBe(opp);
    expect([...ev.revealedTo]).toEqual([ctrl]);
    expect([...ev.cardIds]).toContain(oppTop.id);
  });

  it("with LookAtAll$ True + Zone$ Hand reveals every card in the chosen player's hand", () => {
    const game = mkGame();
    const ctrl = mkPlayerSeat(0);
    const opp = mkPlayerSeat(1);
    seedSourceCard(game, mkEntityId(810));
    const h1 = seedCardOnZone(game, goblinPaper("H1"), ZoneType.Hand, opp, mkEntityId(811));
    const h2 = seedCardOnZone(game, islandPaper("H2"), ZoneType.Hand, opp, mkEntityId(812));

    const sa = mkSa(
      "LookAt",
      {
        Defined: { kind: "literal", raw: "Player.Opponent" },
        Zone: { kind: "literal", raw: "Hand" },
        LookAtAll: { kind: "literal", raw: "True" },
      },
      mkEntityId(810),
      ctrl,
    );
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const reveals = yields
      .filter((y) => (y as { event?: { kind: string } }).event?.kind === "CardsRevealed")
      .map(
        (y) =>
          (y as { event: { payload: { cardIds: readonly unknown[]; fromZone: unknown } } }).event.payload,
      );
    expect(reveals.length).toBe(1);
    const ev = reveals[0] as { cardIds: readonly unknown[]; fromZone: unknown };
    expect(ev.fromZone).toBe(ZoneType.Hand);
    expect([...ev.cardIds]).toEqual(expect.arrayContaining([h1.id, h2.id]));
    expect(ev.cardIds.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// (6) Discover — bottoms remaining exiled cards in random order
// ---------------------------------------------------------------------------

describe("Wave 81 — Discover: bottoms remaining exiled cards", () => {
  it("after picking a non-land, the rest get sent to the bottom of the library", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    seedSourceCard(game, mkEntityId(900));

    // Library top = 4 lands (no non-land within mv ≤ 1), then a goblin (the pick),
    // then a sentinel goblin we expect to remain on the library afterwards.
    // Library order: lands first (top), goblin (the pick) somewhere in the
    // exiled set. We seed lands so cmc filter still excludes them; the
    // discoverable goblin lands at the top of the milled set.
    const land1 = seedCardOnZone(game, islandPaper("L1"), ZoneType.Library, seat, mkEntityId(901));
    const land2 = seedCardOnZone(game, islandPaper("L2"), ZoneType.Library, seat, mkEntityId(902));
    const goblin = seedCardOnZone(game, goblinPaper("G"), ZoneType.Library, seat, mkEntityId(903));
    const sentinel = seedCardOnZone(game, islandPaper("Sentinel"), ZoneType.Library, seat, mkEntityId(904));

    // Discover N=1: walks from top of library, exiling lands until it finds a
    // non-land with cmc<=N. Lands have cmc 0 so they exile but don't trigger
    // the pick; the goblin (cmc 1) is the pick. After the pick, the lands
    // (which had been exiled in iteration order) should be moved BACK to the
    // bottom of the library (in shuffled order). The sentinel land was never
    // touched (it was below the goblin in stack order) and remains.
    const sa = mkSa("Discover", { Num: { kind: "literal", raw: "1" } }, mkEntityId(900), seat);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // Goblin is in hand.
    expect(game.cards.get(goblin.id)?.zone).toBe(ZoneType.Hand);

    // Lands that were exiled are now back in library (bottom).
    expect(game.cards.get(land1.id)?.zone).toBe(ZoneType.Library);
    expect(game.cards.get(land2.id)?.zone).toBe(ZoneType.Library);
    // Sentinel still in library.
    expect(game.cards.get(sentinel.id)?.zone).toBe(ZoneType.Library);

    // No card is left in exile.
    const exile = game.getPlayer(seat).zones.get(ZoneType.Exile);
    expect(exile?.size).toBe(0);
  });
});
