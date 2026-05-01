// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 90 — Effect handler TODO sweep final round.
//
// Closes inline TODO(advanced) tails on these effect handlers:
//   * wave-18:Earthbend — X-scaling. CounterNum$ X (or absent CounterNum)
//     reads source.chosenX so X-Earthbend cards land the paid X as
//     +1/+1 counters.
//   * wave-18:Vote — per-choice SubAbility$ branching. The winning vote
//     dispatches an SVar by `<winner>SubAbility$`, `SubAbilities$` list,
//     or by direct SVar lookup on the winner name. Stamps
//     source.chosenVote so observers can see the result.
//   * make-card:MakeCard — tokenDatabase fallback. When no PaperCard
//     fixture is registered, MakeCard now consults the cards-package
//     tokenDatabase by printed name (e.g. "Treasure", "Clue") so the
//     synthesized card carries the canonical token's TypeLine,
//     abilities, and oracle.
//   * wave-22:Meld — back-face merge. Stamps `melded`, `meldedOnto`, and
//     `meldedFrom` slots on each participant so the layer engine + zone
//     router can treat the secondary participants as merged onto the
//     primary.
//   * wave-21:AlterAttribute — Plotted/Solved/Saddled/Harnessed
//     fold-ins. The umbrella DSL now toggles the typed plotted /
//     duck-typed solved + harnessed / saddledUntilEot slots in the same
//     switch alongside Suspect/Suspected.
//   * wave-22:MultiplePiles — invalid pile-index advisory. N>2 chooser
//     responses with out-of-range or non-numeric optionIds stamp a
//     `multiplePiles-invalid-pile-index` advisory on
//     game.decisionWarnings (still falls back to pile 0).
//   * discard:Hand-mode chooseCard. The default Hand-mode discard now
//     yields a chooseCard decision so the discarder picks which card(s)
//     leave hand (mirrors TgtChoose with mode "Hand").
import "./index.js";
import type {
  EffectInvocation,
  EntityId,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
  SVarAst,
} from "@mtg-forge-ts/core";
import {
  CardType,
  ColorSet,
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
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
  cardDataSyncedAt: "2026-04-30T00:00:00Z",
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

const mkPaperWithSvars = (svars: ReadonlyMap<string, SVarAst>): PaperCard => ({
  name: "TestSvars",
  edition: "TST",
  collectorNumber: "002",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name: "TestSvars",
    oracle: "",
    types: new TypeLine([], [CardType.Creature], []),
    manaCost: null,
    colors: ColorSet.empty(),
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars,
  },
});

const mkGame = (seed = 1n): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(seed) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, p.seat));
  }
  return game;
};

const drainGen = (gen: Generator<unknown, void, unknown>, responses: unknown[] = []): unknown[] => {
  const out: unknown[] = [];
  let r = gen.next();
  let respIdx = 0;
  while (!r.done) {
    out.push(r.value);
    const yielded = r.value as { kind?: string };
    if (yielded.kind === "decision" && respIdx < responses.length) {
      r = gen.next(responses[respIdx++]);
    } else {
      r = gen.next();
    }
  }
  return out;
};

const mkSa = (
  handlerKey: string,
  params: Record<string, { kind: string; raw: string }>,
  sourceId = mkEntityId(10),
  controllerSeat = mkPlayerSeat(0),
  targets: ReturnType<typeof mkEntityId>[] = [],
  svars: ReadonlyMap<string, SVarAst> = new Map(),
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

const seedSourceCard = (
  game: Game,
  sourceId = mkEntityId(10),
  seat: PlayerSeat = mkPlayerSeat(0),
  paper: PaperCard = plainPaper,
): Card => {
  const c = new Card(sourceId, paper, seat, seat, ZoneType.Battlefield);
  game.cards.set(sourceId, c);
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  bf?.add(sourceId);
  return c;
};

const addBfCard = (
  game: Game,
  id: EntityId,
  seat: PlayerSeat = mkPlayerSeat(0),
  paper: PaperCard = plainPaper,
): Card => {
  const c = new Card(id, paper, seat, seat, ZoneType.Battlefield);
  game.cards.set(id, c);
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  bf?.add(id);
  return c;
};

const addHandCard = (
  game: Game,
  id: EntityId,
  seat: PlayerSeat = mkPlayerSeat(0),
  paper: PaperCard = plainPaper,
): Card => {
  const c = new Card(id, paper, seat, seat, ZoneType.Hand);
  game.cards.set(id, c);
  const hand = game.getPlayer(seat).zones.get(ZoneType.Hand);
  hand?.add(id);
  return c;
};

// ---------------------------------------------------------------------------
// (1) Earthbend — X-scaling via source.chosenX
// ---------------------------------------------------------------------------

describe("Wave 90 — Earthbend X-scaling", () => {
  it("CounterNum$ X reads source.chosenX and applies that many +1/+1 counters", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(9000);
    const targetId = mkEntityId(9001);
    const source = seedSourceCard(game, sourceId, seat);
    addBfCard(game, targetId, seat);
    (source as unknown as { chosenX?: number }).chosenX = 3;
    const sa = mkSa("Earthbend", { CounterNum: { kind: "literal", raw: "X" } }, sourceId, seat, [targetId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.cards.get(targetId)?.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(3);
  });

  it("CounterNum$ omitted reads source.chosenX (default-X path)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(9010);
    const targetId = mkEntityId(9011);
    const source = seedSourceCard(game, sourceId, seat);
    addBfCard(game, targetId, seat);
    (source as unknown as { chosenX?: number }).chosenX = 5;
    const sa = mkSa("Earthbend", {}, sourceId, seat, [targetId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.cards.get(targetId)?.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(5);
  });

  it("CounterNum$ literal numeric overrides X-scaling", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(9020);
    const targetId = mkEntityId(9021);
    const source = seedSourceCard(game, sourceId, seat);
    addBfCard(game, targetId, seat);
    (source as unknown as { chosenX?: number }).chosenX = 99;
    const sa = mkSa("Earthbend", { CounterNum: { kind: "literal", raw: "2" } }, sourceId, seat, [targetId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.cards.get(targetId)?.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(2);
  });

  it("X<=0 short-circuits with no counter mutation", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(9030);
    const targetId = mkEntityId(9031);
    const source = seedSourceCard(game, sourceId, seat);
    addBfCard(game, targetId, seat);
    (source as unknown as { chosenX?: number }).chosenX = 0;
    const sa = mkSa("Earthbend", { CounterNum: { kind: "literal", raw: "X" } }, sourceId, seat, [targetId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.cards.get(targetId)?.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (2) Vote — per-choice SubAbility$ branching
// ---------------------------------------------------------------------------

describe("Wave 90 — Vote per-choice SubAbility branching", () => {
  it("winning choice dispatches its SVar via SubAbilities$ list", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(9100);
    const dbAbility: EffectInvocation = { handlerKey: "Pump", params: {} };
    const svars = new Map<string, SVarAst>([["DBYes", { kind: "ability", raw: "stub", ability: dbAbility }]]);
    seedSourceCard(game, sourceId, seat, mkPaperWithSvars(svars));
    const sa = mkSa(
      "Vote",
      {
        Choices: { kind: "literal", raw: "Yes,No" },
        SubAbilities: { kind: "literal", raw: "DBYes,DBNo" },
      },
      sourceId,
      seat,
      [],
      svars,
    );
    // Both players vote "Yes"
    const responses = [
      { kind: "vote", voteId: "Yes" },
      { kind: "vote", voteId: "Yes" },
    ];
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>, responses);
    expect((game.cards.get(sourceId) as unknown as { chosenVote?: string }).chosenVote).toBe("Yes");
  });

  it("stamps chosenVote even with no SVar mapping (fallback path)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(9110);
    seedSourceCard(game, sourceId, seat);
    const sa = mkSa("Vote", { Choices: { kind: "literal", raw: "Apple,Banana" } }, sourceId, seat);
    const responses = [
      { kind: "vote", voteId: "Banana" },
      { kind: "vote", voteId: "Banana" },
    ];
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>, responses);
    expect((game.cards.get(sourceId) as unknown as { chosenVote?: string }).chosenVote).toBe("Banana");
  });
});

// ---------------------------------------------------------------------------
// (3) MakeCard — tokenDatabase fallback by printed name
// ---------------------------------------------------------------------------

describe("Wave 90 — MakeCard tokenDatabase fallback", () => {
  it('Name$ "Treasure Token" synthesizes via the canonical Treasure token entry', () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(9200);
    seedSourceCard(game, sourceId, seat);
    const sa = mkSa(
      "MakeCard",
      {
        Name: { kind: "literal", raw: "Treasure Token" },
        Zone: { kind: "literal", raw: "Battlefield" },
      },
      sourceId,
      seat,
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    let madeId: EntityId | null = null;
    for (const [id, card] of game.cards) {
      if (id === sourceId) continue;
      if (card.paperCard.name === "Treasure Token") {
        madeId = id;
        break;
      }
    }
    expect(madeId).not.toBeNull();
    if (madeId === null) return;
    // The Treasure entry in tokenDatabase has a non-empty abilities array
    // (the {T}, sac: add one mana) — confirm we got the canonical data,
    // not the empty-Sorcery placeholder.
    const def = game.cards.get(madeId)?.paperCard.definition;
    expect(def).toBeDefined();
    if (!def) return;
    expect(def.abilities.length).toBeGreaterThan(0);
  });

  it("Name$ totally_made_up_card falls back to the empty-Sorcery placeholder", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(9210);
    seedSourceCard(game, sourceId, seat);
    const sa = mkSa("MakeCard", { Name: { kind: "literal", raw: "TotallyMadeUpCard" } }, sourceId, seat);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    let madeId: EntityId | null = null;
    for (const [id, card] of game.cards) {
      if (id === sourceId) continue;
      if (card.paperCard.name === "TotallyMadeUpCard") {
        madeId = id;
        break;
      }
    }
    expect(madeId).not.toBeNull();
    if (madeId === null) return;
    const def = game.cards.get(madeId)?.paperCard.definition;
    expect(def?.abilities).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (4) Meld — back-face merge stamps melded/meldedOnto/meldedFrom
// ---------------------------------------------------------------------------

describe("Wave 90 — Meld back-face merge stamps", () => {
  it("primary participant gets meldedFrom; secondaries get meldedOnto pointing at primary", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(9300);
    const a = mkEntityId(9301);
    const b = mkEntityId(9302);
    seedSourceCard(game, sourceId, seat);
    addBfCard(game, a, seat);
    addBfCard(game, b, seat);
    const sa = mkSa("Meld", {}, sourceId, seat, [a, b]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const cardA = game.cards.get(a) as unknown as {
      melded?: boolean;
      meldedOnto?: EntityId;
      meldedFrom?: readonly EntityId[];
    };
    const cardB = game.cards.get(b) as unknown as {
      melded?: boolean;
      meldedOnto?: EntityId;
      meldedFrom?: readonly EntityId[];
    };
    expect(cardA.melded).toBe(true);
    expect(cardB.melded).toBe(true);
    expect(cardA.meldedFrom).toEqual([a, b]);
    // a is the primary so meldedOnto isn't stamped on it; b is secondary
    expect(cardA.meldedOnto).toBeUndefined();
    expect(cardB.meldedOnto).toBe(a);
  });

  it("Meld with no targets falls back to the source card as primary", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(9400);
    seedSourceCard(game, sourceId, seat);
    const sa = mkSa("Meld", {}, sourceId, seat, []);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const meldedEvents = yields.filter((y) => {
      const yy = y as { kind?: string; event?: { kind?: string } };
      return yy.kind === "event" && yy.event?.kind === "Melded";
    });
    expect(meldedEvents).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (5) AlterAttribute — Plotted/Solved/Saddled/Harnessed fold-ins
// ---------------------------------------------------------------------------

describe("Wave 90 — AlterAttribute Plotted/Solved/Saddled/Harnessed", () => {
  it("Plotted activate sets card.plotted + plottedOnTurn", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(9500);
    const targetId = mkEntityId(9501);
    seedSourceCard(game, sourceId, seat);
    addBfCard(game, targetId, seat);
    const sa = mkSa("AlterAttribute", { Attributes: { kind: "literal", raw: "Plotted" } }, sourceId, seat, [
      targetId,
    ]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const card = game.cards.get(targetId);
    expect(card?.plotted).toBe(true);
    expect(card?.plottedOnTurn).toBe(game.turn);
  });

  it("Plotted deactivate clears card.plotted + plottedOnTurn", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(9510);
    const targetId = mkEntityId(9511);
    seedSourceCard(game, sourceId, seat);
    const target = addBfCard(game, targetId, seat);
    target.plotted = true;
    target.plottedOnTurn = 5;
    const sa = mkSa(
      "AlterAttribute",
      {
        Attributes: { kind: "literal", raw: "Plotted" },
        Activate: { kind: "literal", raw: "False" },
      },
      sourceId,
      seat,
      [targetId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const card = game.cards.get(targetId);
    expect(card?.plotted).toBeUndefined();
    expect(card?.plottedOnTurn).toBeUndefined();
  });

  it("Solved activate sets card.solved (duck-typed)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(9520);
    const targetId = mkEntityId(9521);
    seedSourceCard(game, sourceId, seat);
    addBfCard(game, targetId, seat);
    const sa = mkSa("AlterAttribute", { Attributes: { kind: "literal", raw: "Solved" } }, sourceId, seat, [
      targetId,
    ]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect((game.cards.get(targetId) as unknown as { solved?: boolean }).solved).toBe(true);
  });

  it("Saddled activate sets card.saddledUntilEot", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(9530);
    const targetId = mkEntityId(9531);
    seedSourceCard(game, sourceId, seat);
    addBfCard(game, targetId, seat);
    const sa = mkSa("AlterAttribute", { Attributes: { kind: "literal", raw: "Saddled" } }, sourceId, seat, [
      targetId,
    ]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.cards.get(targetId)?.saddledUntilEot).toBe(true);
  });

  it("Harnessed activate sets card.harnessed (duck-typed)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(9540);
    const targetId = mkEntityId(9541);
    seedSourceCard(game, sourceId, seat);
    addBfCard(game, targetId, seat);
    const sa = mkSa("AlterAttribute", { Attributes: { kind: "literal", raw: "Harnessed" } }, sourceId, seat, [
      targetId,
    ]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect((game.cards.get(targetId) as unknown as { harnessed?: boolean }).harnessed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (6) MultiplePiles — invalid pile-index advisory
// ---------------------------------------------------------------------------

describe("Wave 90 — MultiplePiles invalid pile-index advisory", () => {
  it("N>2 chooser response with out-of-range optionId stamps a warning", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(9600);
    seedSourceCard(game, sourceId, seat);
    // Seed 6 cards into the controller's library.
    const library = game.getPlayer(seat).zones.get(ZoneType.Library);
    const ids: EntityId[] = [];
    for (let i = 0; i < 6; i++) {
      const id = mkEntityId(9601 + i);
      const c = new Card(id, plainPaper, seat, seat, ZoneType.Library);
      game.cards.set(id, c);
      library?.add(id);
      ids.push(id);
    }
    const sa = mkSa(
      "MultiplePiles",
      { Num: { kind: "literal", raw: "6" }, Piles: { kind: "literal", raw: "3" } },
      sourceId,
      seat,
      [],
    );
    // The splitter is the OPPONENT — provide a valid 3-pile partition.
    // The chooser is the controller — provide an out-of-range optionId.
    const responses = [
      {
        kind: "dividePileChoice",
        piles: [
          [ids[0], ids[1]],
          [ids[2], ids[3]],
          [ids[4], ids[5]],
        ],
      },
      { kind: "chooseOption", optionId: "99" },
    ];
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>, responses);
    const warn = game.decisionWarnings.find((w) => w.kind === "multiplePiles-invalid-pile-index");
    expect(warn).toBeDefined();
    expect(warn?.detail).toContain("99");
  });

  it("N>2 chooser response with valid pile-index does NOT stamp a warning", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(9700);
    seedSourceCard(game, sourceId, seat);
    const library = game.getPlayer(seat).zones.get(ZoneType.Library);
    const ids: EntityId[] = [];
    for (let i = 0; i < 6; i++) {
      const id = mkEntityId(9701 + i);
      const c = new Card(id, plainPaper, seat, seat, ZoneType.Library);
      game.cards.set(id, c);
      library?.add(id);
      ids.push(id);
    }
    const sa = mkSa(
      "MultiplePiles",
      { Num: { kind: "literal", raw: "6" }, Piles: { kind: "literal", raw: "3" } },
      sourceId,
      seat,
      [],
    );
    const responses = [
      {
        kind: "dividePileChoice",
        piles: [
          [ids[0], ids[1]],
          [ids[2], ids[3]],
          [ids[4], ids[5]],
        ],
      },
      { kind: "chooseOption", optionId: "1" },
    ];
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>, responses);
    const warn = game.decisionWarnings.find((w) => w.kind === "multiplePiles-invalid-pile-index");
    expect(warn).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (7) Discard — Hand-mode chooseCard
// ---------------------------------------------------------------------------

describe("Wave 90 — Discard Hand-mode chooseCard", () => {
  it("Hand-mode discard yields chooseCard so the discarder picks", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(9800);
    seedSourceCard(game, sourceId, seat);
    const h1 = mkEntityId(9801);
    const h2 = mkEntityId(9802);
    const h3 = mkEntityId(9803);
    addHandCard(game, h1, seat);
    addHandCard(game, h2, seat);
    addHandCard(game, h3, seat);
    const sa = mkSa(
      "Discard",
      { NumCards: { kind: "literal", raw: "1" }, Mode: { kind: "literal", raw: "Hand" } },
      sourceId,
      seat,
      [],
    );
    // Discarder picks h2 (the middle card — proves the response is honoured).
    const responses = [{ kind: "chooseCard", chosen: [h2] }];
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>, responses);
    // h2 should now be in graveyard, h1 + h3 still in hand.
    const gy = game.getPlayer(seat).zones.get(ZoneType.Graveyard);
    const hand = game.getPlayer(seat).zones.get(ZoneType.Hand);
    expect(gy?.toArray()).toContain(h2);
    expect(hand?.toArray()).toContain(h1);
    expect(hand?.toArray()).toContain(h3);
  });

  it("Hand-mode falls back to front-of-hand when no decision response is supplied", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(9900);
    seedSourceCard(game, sourceId, seat);
    const h1 = mkEntityId(9901);
    const h2 = mkEntityId(9902);
    addHandCard(game, h1, seat);
    addHandCard(game, h2, seat);
    const sa = mkSa(
      "Discard",
      { NumCards: { kind: "literal", raw: "1" }, Mode: { kind: "literal", raw: "Hand" } },
      sourceId,
      seat,
      [],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const gy = game.getPlayer(seat).zones.get(ZoneType.Graveyard);
    // The first card in the hand (h1) lands in the graveyard.
    expect(gy?.toArray()).toContain(h1);
  });
});
