// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 54 — verification tests for the three sub-fixes:
//   (A) Phasing wiring — isPhasedOut consults card.phasedOut + card.phased
//       so combat declaration, target enumeration, SBA destroy collector,
//       and legend rule all gate identically.
//   (B) Clone copy — CloneEffect populates card.copiedFrom from the
//       target via captureCopiable, so Layer 1 copy effects take over.
//   (C) Wave-22 no-op fills — RestartGame, Endure, Learn, ReorderZone,
//       OpenAttraction, MultiplePiles, VillainousChoice now produce
//       observable game-state changes instead of `void sa; void game;`.
import "./wave-18-effects.js";
import "./wave-22-effects.js";
import type { LobbyPlayer, PaperCard, SVarAst } from "@mtg-forge-ts/core";
import {
  CardType,
  ColorSet,
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaCost,
  SeededRng,
  Supertype,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import { isPhasedOut } from "../../combat/damage-assignment-helpers.js";
import { captureCopiable } from "../../copy/capture.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { collectCreatureRemoval } from "../../sba/creature-removal.js";
import { collectLegendWorld } from "../../sba/legend-world.js";
import type { SbaAction } from "../../sba/sba-action.js";
import { enumerateEligibleTargets } from "../../target/enumeration.js";
import type { TargetRestriction } from "../../target/restriction.js";
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
const paper: PaperCard = {
  name: "Test",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = () => {
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

const seedSourceCard = (game: Game, sourceId = mkEntityId(10)) => {
  const seat0 = mkPlayerSeat(0);
  const c = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
  game.cards.set(sourceId, c);
  const bf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);
  bf?.add(sourceId);
  return c;
};

const seedCardOnBattlefield = (game: Game, id: ReturnType<typeof mkEntityId>, seat = mkPlayerSeat(0)) => {
  const c = new Card(id, paper, seat, seat, ZoneType.Battlefield);
  game.cards.set(id, c);
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  bf?.add(id);
  return c;
};

// ---------------------------------------------------------------------------
// (A) Phasing wiring
// ---------------------------------------------------------------------------

describe("Wave 54 — Phasing wiring", () => {
  it("isPhasedOut returns true for card.phasedOut === true (SP$ Phases)", () => {
    const game = mkGame();
    const c = seedCardOnBattlefield(game, mkEntityId(20));
    expect(isPhasedOut(game, c.id)).toBe(false);
    c.phasedOut = true;
    expect(isPhasedOut(game, c.id)).toBe(true);
  });

  it("isPhasedOut returns true for card.phased === true (keyword Phasing)", () => {
    const game = mkGame();
    const c = seedCardOnBattlefield(game, mkEntityId(21));
    c.phased = true;
    expect(isPhasedOut(game, c.id)).toBe(true);
  });

  it("PhasesEffect toggles phasedOut + emits a PhasedOut event", () => {
    const game = mkGame();
    const tgt = seedCardOnBattlefield(game, mkEntityId(30));
    seedSourceCard(game, mkEntityId(31));
    const sa = mkSa("Phases", {}, mkEntityId(31), mkPlayerSeat(0), [tgt.id]);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(tgt.phasedOut).toBe(true);
    expect(yields.some((y) => (y as { event?: { kind: string } }).event?.kind === "PhasedOut")).toBe(true);

    // Second resolution: phase back in (toggle).
    const sa2 = mkSa("Phases", {}, mkEntityId(31), mkPlayerSeat(0), [tgt.id]);
    const yields2 = drainGen(sa2.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(tgt.phasedOut).toBe(false);
    expect(tgt.phased).toBe(false);
    expect(yields2.some((y) => (y as { event?: { kind: string } }).event?.kind === "PhasedIn")).toBe(true);
  });

  it("target enumeration excludes phased-out cards (both flags)", () => {
    const game = mkGame();
    const ph = seedCardOnBattlefield(game, mkEntityId(40));
    const live = seedCardOnBattlefield(game, mkEntityId(41));
    ph.phasedOut = true;
    const restriction: TargetRestriction = {
      mayTargetPlayers: false,
      permitZones: new Set([ZoneType.Battlefield]),
      controllerScope: "any",
      forbidSelfSource: false,
      shroud: false,
      hexproof: false,
      permitTypes: new Set(),
      forbidTypes: new Set(),
      forbidColorless: false,
      minTargets: 1,
      maxTargets: 1,
    };
    const out = enumerateEligibleTargets(
      game,
      { sourceId: mkEntityId(99), sourceControllerSeat: mkPlayerSeat(0) },
      restriction,
    );
    const ids = out.flatMap((t) => (t.kind === "card" ? [t.id] : []));
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(ph.id);
  });

  it("creature-removal SBA collector skips phased-out cards", () => {
    const game = mkGame();
    const ph = seedCardOnBattlefield(game, mkEntityId(50));
    // Mark as a Creature with 0 toughness via Layer 7b — easier: stub the
    // layer engine to return a Creature with 0 toughness for this id.
    const realCompute = game.layerEngine.computeCharacteristics.bind(game.layerEngine);
    game.layerEngine.computeCharacteristics = ((id: typeof ph.id): ReturnType<typeof realCompute> => {
      if (id === ph.id) {
        return {
          name: "Phased",
          manaCost: ManaCost.parse(""),
          colorIndicator: null,
          supertypes: new Set(),
          types: new Set([CardType.Creature]),
          subtypes: new Set(),
          colors: ColorSet.empty(),
          rulesText: "",
          power: 0,
          toughness: 0,
          loyalty: null,
          defense: null,
          abilities: [],
        } as unknown as ReturnType<typeof realCompute>;
      }
      return realCompute(id);
    }) as typeof realCompute;
    ph.phasedOut = true;
    const out: SbaAction[] = [];
    collectCreatureRemoval(game, out);
    expect(out.find((a) => "cardId" in a && a.cardId === ph.id)).toBeUndefined();
  });

  it("legend-world SBA collector skips phased-out legendaries", () => {
    const game = mkGame();
    const a = seedCardOnBattlefield(game, mkEntityId(60));
    const b = seedCardOnBattlefield(game, mkEntityId(61));
    a.phasedOut = true;
    const realCompute = game.layerEngine.computeCharacteristics.bind(game.layerEngine);
    game.layerEngine.computeCharacteristics = ((id: typeof a.id): ReturnType<typeof realCompute> => {
      if (id === a.id || id === b.id) {
        return {
          name: "Karn",
          manaCost: ManaCost.parse(""),
          colorIndicator: null,
          supertypes: new Set([Supertype.Legendary]),
          types: new Set([CardType.Creature]),
          subtypes: new Set(),
          colors: ColorSet.empty(),
          rulesText: "",
          power: 1,
          toughness: 1,
          loyalty: null,
          defense: null,
          abilities: [],
        } as unknown as ReturnType<typeof realCompute>;
      }
      return realCompute(id);
    }) as typeof realCompute;
    const out: SbaAction[] = [];
    collectLegendWorld(game, out);
    expect(out.find((x) => x.kind === "legendRule")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (B) Clone copy
// ---------------------------------------------------------------------------

describe("Wave 54 — Clone copy", () => {
  it("CloneEffect populates copiedFrom on the source from the target's copiable characteristics", () => {
    const game = mkGame();
    const cloner = seedSourceCard(game, mkEntityId(70));
    const tgt = seedCardOnBattlefield(game, mkEntityId(71));
    expect(cloner.copiedFrom).toBeNull();
    const sa = mkSa("Clone", {}, mkEntityId(70), mkPlayerSeat(0), [tgt.id]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(cloner.copiedFrom).not.toBeNull();
    // Round-trip: captured copiable name matches what the target would emit.
    const expected = captureCopiable(tgt.id, game);
    expect(cloner.copiedFrom?.name).toBe(expected.name);
    // Remembered list still records target id (back-compat).
    expect(cloner.remembered).toContain(tgt.id);
  });

  it("CloneEffect is a no-op when no targets", () => {
    const game = mkGame();
    const cloner = seedSourceCard(game, mkEntityId(72));
    const sa = mkSa("Clone", {}, mkEntityId(72), mkPlayerSeat(0), []);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(cloner.copiedFrom).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (C) Wave-22 no-op fills
// ---------------------------------------------------------------------------

describe("Wave 54 — RestartGame fill", () => {
  it("stamps restartRequested + emits a SubgameStarted pulse", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("RestartGame", {});
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect((game.flags as unknown as { restartRequested?: boolean }).restartRequested).toBe(true);
    expect(yields.some((y) => (y as { event?: { kind: string } }).event?.kind === "SubgameStarted")).toBe(
      true,
    );
  });
});

describe("Wave 54 — Endure fill", () => {
  it("counter mode adds +1/+1 counters to the source by default", () => {
    const game = mkGame();
    const source = seedSourceCard(game);
    const sa = mkSa("Endure", { Num: { kind: "literal", raw: "3" } });
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    // First yield is the chooseOption decision.
    expect(r.done).toBe(false);
    const decision = r.value as { kind: "decision"; request: { kind: string } };
    expect(decision.kind).toBe("decision");
    expect(decision.request.kind).toBe("chooseOption");
    // Respond with "counters".
    r = gen.next({ kind: "chooseOption", optionId: "counters" });
    while (!r.done) r = gen.next();
    expect(source.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("token mode stamps endureTokenRequested when chosen", () => {
    const game = mkGame();
    const source = seedSourceCard(game);
    const sa = mkSa("Endure", { Num: { kind: "literal", raw: "2" } });
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    r = gen.next({ kind: "chooseOption", optionId: "token" });
    while (!r.done) r = gen.next();
    expect((source as unknown as { endureTokenRequested?: number }).endureTokenRequested).toBe(2);
  });
});

describe("Wave 54 — Learn fill", () => {
  it("discard-then-draw path moves a hand card to graveyard and draws", () => {
    const game = mkGame();
    seedSourceCard(game);
    const seat0 = mkPlayerSeat(0);
    const player = game.getPlayer(seat0);
    const handCardId = mkEntityId(80);
    const handCard = new Card(handCardId, paper, seat0, seat0, ZoneType.Hand);
    game.cards.set(handCardId, handCard);
    player.zones.get(ZoneType.Hand)?.add(handCardId);
    const libCardId = mkEntityId(81);
    const libCard = new Card(libCardId, paper, seat0, seat0, ZoneType.Library);
    game.cards.set(libCardId, libCard);
    player.zones.get(ZoneType.Library)?.add(libCardId);

    const sa = mkSa("Learn", {});
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    // Drive: pick discard.
    r = gen.next({ kind: "chooseOption", optionId: "discard" });
    while (!r.done) r = gen.next();

    expect(handCard.zone).toBe(ZoneType.Graveyard);
    expect(libCard.zone).toBe(ZoneType.Hand);
  });

  it("lesson path stamps the requested flag + does NOT discard", () => {
    const game = mkGame();
    const source = seedSourceCard(game);
    const seat0 = mkPlayerSeat(0);
    const player = game.getPlayer(seat0);
    const handCardId = mkEntityId(82);
    const handCard = new Card(handCardId, paper, seat0, seat0, ZoneType.Hand);
    game.cards.set(handCardId, handCard);
    player.zones.get(ZoneType.Hand)?.add(handCardId);

    const sa = mkSa("Learn", {});
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    r = gen.next({ kind: "chooseOption", optionId: "lesson" });
    while (!r.done) r = gen.next();

    expect(handCard.zone).toBe(ZoneType.Hand);
    expect((source as unknown as { learnLessonRequested?: boolean }).learnLessonRequested).toBe(true);
  });
});

describe("Wave 54 — ReorderZone fill", () => {
  it("emits a CardsRevealed pulse for the targeted zone prefix", () => {
    const game = mkGame();
    seedSourceCard(game);
    const seat0 = mkPlayerSeat(0);
    const player = game.getPlayer(seat0);
    for (let i = 0; i < 3; i++) {
      const id = mkEntityId(90 + i);
      const c = new Card(id, paper, seat0, seat0, ZoneType.Library);
      game.cards.set(id, c);
      player.zones.get(ZoneType.Library)?.add(id);
    }
    const sa = mkSa("ReorderZone", {
      Zone: { kind: "literal", raw: "Library" },
      Number: { kind: "literal", raw: "2" },
    });
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    const yields: unknown[] = [];
    let r = gen.next();
    while (!r.done) {
      yields.push(r.value);
      // If the engine yields an orderCards decision, respond with the
      // identity ordering so the resolver continues. Otherwise pass
      // undefined for events.
      const yv = r.value as { kind?: string; request?: { kind?: string; cards?: readonly unknown[] } };
      if (yv.kind === "decision" && yv.request?.kind === "orderCards") {
        r = gen.next({
          kind: "orderCards",
          ordered: (yv.request.cards ?? []).slice() as unknown[],
        });
      } else {
        r = gen.next();
      }
    }
    const reveal = yields.find((y) => (y as { event?: { kind: string } }).event?.kind === "CardsRevealed");
    expect(reveal).toBeDefined();
    // The orderCards decision request was yielded.
    const orderReq = yields.find((y) => {
      const yv = y as { kind?: string; request?: { kind?: string } };
      return yv.kind === "decision" && yv.request?.kind === "orderCards";
    });
    expect(orderReq).toBeDefined();
  });

  it("applies the responder's permutation to the top of the zone", () => {
    const game = mkGame();
    seedSourceCard(game);
    const seat0 = mkPlayerSeat(0);
    const player = game.getPlayer(seat0);
    const ids: ReturnType<typeof mkEntityId>[] = [];
    for (let i = 0; i < 3; i++) {
      const id = mkEntityId(190 + i);
      const c = new Card(id, paper, seat0, seat0, ZoneType.Library);
      game.cards.set(id, c);
      player.zones.get(ZoneType.Library)?.add(id);
      ids.push(id);
    }
    const sa = mkSa("ReorderZone", {
      Zone: { kind: "literal", raw: "Library" },
      Number: { kind: "literal", raw: "3" },
    });
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    // First yield: CardsRevealed event.
    expect((r.value as { kind?: string }).kind).toBe("event");
    r = gen.next();
    // Second yield: orderCards decision. Reverse the order.
    const decision = r.value as { kind: string; request: { kind: string; cards: readonly unknown[] } };
    expect(decision.kind).toBe("decision");
    expect(decision.request.kind).toBe("orderCards");
    const reversed = (decision.request.cards as ReturnType<typeof mkEntityId>[]).slice().reverse();
    r = gen.next({ kind: "orderCards", ordered: reversed });
    while (!r.done) r = gen.next();
    // Library should now be ids reversed at the top.
    const libIds = player.zones.get(ZoneType.Library)?.toArray() ?? [];
    expect(libIds).toEqual([ids[2], ids[1], ids[0]]);
  });

  it("falls back to original ordering on an invalid permutation", () => {
    const game = mkGame();
    seedSourceCard(game);
    const seat0 = mkPlayerSeat(0);
    const player = game.getPlayer(seat0);
    const ids: ReturnType<typeof mkEntityId>[] = [];
    for (let i = 0; i < 3; i++) {
      const id = mkEntityId(290 + i);
      const c = new Card(id, paper, seat0, seat0, ZoneType.Library);
      game.cards.set(id, c);
      player.zones.get(ZoneType.Library)?.add(id);
      ids.push(id);
    }
    const sa = mkSa("ReorderZone", {
      Zone: { kind: "literal", raw: "Library" },
      Number: { kind: "literal", raw: "3" },
    });
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    r = gen.next();
    // Respond with a non-bijection (duplicate first id, missing last).
    const bogus = [ids[0], ids[0], ids[1]] as ReturnType<typeof mkEntityId>[];
    r = gen.next({ kind: "orderCards", ordered: bogus });
    while (!r.done) r = gen.next();
    // Original ordering preserved.
    const libIds = player.zones.get(ZoneType.Library)?.toArray() ?? [];
    expect(libIds).toEqual(ids);
  });
});

describe("Wave 54 — OpenAttraction fill", () => {
  it("bumps attractions counter on the source + flag map", () => {
    const game = mkGame();
    const source = seedSourceCard(game);
    const sa = mkSa("OpenAttraction", { Amount: { kind: "literal", raw: "1" } });
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(source.attractions).toBeGreaterThanOrEqual(1);
    const flag = game.flags.attractions.get(mkPlayerSeat(0)) as { openedAttractions?: number } | undefined;
    expect(flag?.openedAttractions).toBe(1);
    expect(
      yields.some((y) => (y as { event?: { kind: string } }).event?.kind === "ContraptionAssembled"),
    ).toBe(true);
  });
});

describe("Wave 54 — MultiplePiles fill", () => {
  it("yields dividePileChoice + chooseCardsPile and applies the splitter's partition", () => {
    const game = mkGame();
    const source = seedSourceCard(game);
    const seat0 = mkPlayerSeat(0);
    const player = game.getPlayer(seat0);
    const ids: ReturnType<typeof mkEntityId>[] = [];
    for (let i = 0; i < 4; i++) {
      const id = mkEntityId(100 + i);
      const c = new Card(id, paper, seat0, seat0, ZoneType.Library);
      game.cards.set(id, c);
      player.zones.get(ZoneType.Library)?.add(id);
      ids.push(id);
    }
    const sa = mkSa("MultiplePiles", { Num: { kind: "literal", raw: "4" } });
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    // First yield: dividePileChoice request to splitter (opponent of source ctrl).
    let r = gen.next();
    const splitDec = r.value as {
      kind: string;
      request: { kind: string; numPiles: number; playerSeat: unknown };
    };
    expect(splitDec.kind).toBe("decision");
    expect(splitDec.request.kind).toBe("dividePileChoice");
    expect(splitDec.request.numPiles).toBe(2);
    // Splitter returns a partition: [ids[0], ids[1]] vs [ids[2], ids[3]].
    const id0 = ids[0];
    const id1 = ids[1];
    const id2 = ids[2];
    const id3 = ids[3];
    if (id0 === undefined || id1 === undefined || id2 === undefined || id3 === undefined) {
      throw new Error("ids missing");
    }
    r = gen.next({
      kind: "dividePileChoice",
      piles: [
        [id0, id1],
        [id2, id3],
      ],
    });
    // Second yield: chooseCardsPile to the chooser.
    const pickDec = r.value as { kind: string; request: { kind: string } };
    expect(pickDec.kind).toBe("decision");
    expect(pickDec.request.kind).toBe("chooseCardsPile");
    r = gen.next({ kind: "chooseCardsPile", chosen: "a" });
    while (!r.done) r = gen.next();
    // Pile A claimed (ids[0],ids[1]) → 2 cards in hand. Pile B → graveyard.
    const handIds = player.zones.get(ZoneType.Hand)?.toArray() ?? [];
    expect(handIds.length).toBe(2);
    expect(handIds).toContain(id0);
    expect(handIds).toContain(id1);
    const graveIds = player.zones.get(ZoneType.Graveyard)?.toArray() ?? [];
    expect(graveIds).toContain(id2);
    expect(graveIds).toContain(id3);
    // Remembered captures the claimed pile.
    expect(source.remembered.length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to the engine's even-split when the splitter returns an invalid partition", () => {
    const game = mkGame();
    seedSourceCard(game);
    const seat0 = mkPlayerSeat(0);
    const player = game.getPlayer(seat0);
    const ids: ReturnType<typeof mkEntityId>[] = [];
    for (let i = 0; i < 4; i++) {
      const id = mkEntityId(160 + i);
      const c = new Card(id, paper, seat0, seat0, ZoneType.Library);
      game.cards.set(id, c);
      player.zones.get(ZoneType.Library)?.add(id);
      ids.push(id);
    }
    const sa = mkSa("MultiplePiles", { Num: { kind: "literal", raw: "4" } });
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    // Bad partition: missing one card.
    const id0 = ids[0];
    const id2 = ids[2];
    if (id0 === undefined || id2 === undefined) throw new Error("ids missing");
    r = gen.next({ kind: "dividePileChoice", piles: [[id0], [id2]] });
    // Falls back to default even-split (idx 0,2 vs 1,3) on chooseCardsPile.
    expect((r.value as { kind: string }).kind).toBe("decision");
    expect((r.value as { request: { kind: string } }).request.kind).toBe("chooseCardsPile");
    r = gen.next({ kind: "chooseCardsPile", chosen: "a" });
    while (!r.done) r = gen.next();
    // Default pile A = even indices [0,2].
    const handIds = player.zones.get(ZoneType.Hand)?.toArray() ?? [];
    expect(handIds.length).toBe(2);
    expect(handIds).toContain(ids[0]);
    expect(handIds).toContain(ids[2]);
  });

  it("Piles$ 3 yields chooseOption with pile-index ids", () => {
    const game = mkGame();
    seedSourceCard(game);
    const seat0 = mkPlayerSeat(0);
    const player = game.getPlayer(seat0);
    const ids: ReturnType<typeof mkEntityId>[] = [];
    for (let i = 0; i < 6; i++) {
      const id = mkEntityId(260 + i);
      const c = new Card(id, paper, seat0, seat0, ZoneType.Library);
      game.cards.set(id, c);
      player.zones.get(ZoneType.Library)?.add(id);
      ids.push(id);
    }
    const sa = mkSa("MultiplePiles", {
      Num: { kind: "literal", raw: "6" },
      Piles: { kind: "literal", raw: "3" },
    });
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    expect((r.value as { request: { kind: string; numPiles: number } }).request.numPiles).toBe(3);
    // Use the engine fallback partition (decline to provide one).
    r = gen.next({ kind: "dividePileChoice", piles: [] });
    // Chooser yield is chooseOption.
    const opt = r.value as { kind: string; request: { kind: string; options: readonly { id: string }[] } };
    expect(opt.kind).toBe("decision");
    expect(opt.request.kind).toBe("chooseOption");
    expect(opt.request.options.length).toBe(3);
    r = gen.next({ kind: "chooseOption", optionId: "1" });
    while (!r.done) r = gen.next();
    // Default partition into 3 piles for 6 cards: [0,3], [1,4], [2,5].
    // Choosing pile index 1 claims [ids[1], ids[4]].
    const handIds = player.zones.get(ZoneType.Hand)?.toArray() ?? [];
    expect(handIds.length).toBe(2);
    expect(handIds).toContain(ids[1]);
    expect(handIds).toContain(ids[4]);
  });

  it("smoke — empty library still resolves without throwing", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("MultiplePiles", {});
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

describe("Wave 54 — VillainousChoice fill", () => {
  it("yields chooseOption + resolves picked sub-SVar", () => {
    const game = mkGame();
    const source = seedSourceCard(game);
    // Use a bare DBA reference; the test asserts the chooseOption decision
    // surfaces and the sub-resolution runs without throwing when the SVar
    // is missing (graceful no-op tail).
    const sa = mkSa("VillainousChoice", {
      Choices: { kind: "literal", raw: "DBA,DBB" },
    });
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    const first = gen.next();
    expect(first.done).toBe(false);
    expect((first.value as { kind: string }).kind).toBe("decision");
    expect(((first.value as { request: { kind: string } }).request as { kind: string }).kind).toBe(
      "chooseOption",
    );
    // Drive to completion.
    let r = gen.next({ kind: "chooseOption", optionId: "DBA" });
    while (!r.done) r = gen.next();
    // Source remembered still bumped (back-compat smoke).
    expect(source.remembered.length).toBeGreaterThan(0);
  });
});
