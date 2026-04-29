// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 63.A — decision-driven sub-param tightness for three Wave 53 effects.
//
// Coverage:
//   * ChangeZone Chooser$ — non-controller seat picks which targets move via
//     a chooseCard yield. Validate happy path + invalid-pick fallback.
//   * PutCounter UpTo$ True — controller picks 0..N via chooseNumber yield.
//     Validate happy path + invalid-response fallback.
//   * Discard Mode$ TgtChoose — discarder picks which cards via chooseCard.
//     Validate happy path + invalid-pick fallback.
//   * Discard Mode$ Defined — literal id list via DefinedCards$.
//
// The driver pattern mirrors wave61-d-target-pick.test.ts: walk the
// resolver generator manually, recognise decision yields by their nested
// request.kind, inject typed responses, and assert the post-state.
import "../../svar/selectors/number.js";
import "./change-zone.js";
import "./put-counter.js";
import "./discard.js";

import type { AbilityAst, LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import {
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
import { ManaPool } from "../../mana/mana-pool.js";
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
  cardDataSyncedAt: "2026-04-28T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};
const bearPaper: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name: "Grizzly Bears",
    oracle: "",
    types: TypeLine.parse("Creature — Bear"),
    manaCost: { raw: "1G", symbols: [] },
    pt: { power: "2", toughness: "2" },
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  },
};
const sourcePaper: PaperCard = {
  name: "Source",
  edition: "LEA",
  collectorNumber: "002",
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
    player.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, player.seat));
    player.manaPool = new ManaPool();
  }
  return game;
};

const mkAst = (handlerKey: string, params: AbilityAst["effect"]["params"]): AbilityAst => ({
  kind: "spell",
  effect: { handlerKey, params },
  cost: { raw: "" },
});

interface YieldEnvelope {
  readonly kind?: string;
  readonly request?: { readonly kind?: string };
}

// ---------------------------------------------------------------------
// ChangeZone Chooser$
// ---------------------------------------------------------------------

describe("Wave 63.A — ChangeZone Chooser$ migration", () => {
  it("Opponent chooser picks the moved card via chooseCard yield", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const id1 = mkEntityId(20);
    const id2 = mkEntityId(21);
    const id3 = mkEntityId(22);

    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    for (const id of [id1, id2, id3]) {
      const c = new Card(id, bearPaper, seat0, seat0, ZoneType.Graveyard);
      game.cards.set(id, c);
      game.getPlayer(seat0).zones.get(ZoneType.Graveyard)?.add(id);
    }

    const sa = new SpellAbility(
      mkAst("ChangeZone", {
        Origin: { kind: "literal", raw: "Graveyard" },
        Destination: { kind: "literal", raw: "Hand" },
        ChangeNum: { kind: "literal", raw: "1" },
        Chooser: { kind: "literal", raw: "Opponent" },
      }),
      sourceId,
      seat0,
      new Map(),
      [id1, id2, id3],
    );
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let next = gen.next();
    let sawChoose = false;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "chooseCard") {
        sawChoose = true;
        // Pick id3 (the last in source order — would NOT be picked by the
        // prior MVP front-of-list slice).
        next = gen.next({ kind: "chooseCard", chosen: [id3] });
      } else {
        next = gen.next();
      }
    }
    expect(sawChoose).toBe(true);
    expect(game.cards.get(id3)?.zone).toBe(ZoneType.Hand);
    expect(game.cards.get(id1)?.zone).toBe(ZoneType.Graveyard);
    expect(game.cards.get(id2)?.zone).toBe(ZoneType.Graveyard);
  });

  it("falls back to first ChangeNum$ eligibles on invalid response", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const id1 = mkEntityId(20);
    const id2 = mkEntityId(21);
    const id3 = mkEntityId(22);

    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    for (const id of [id1, id2, id3]) {
      const c = new Card(id, bearPaper, seat0, seat0, ZoneType.Graveyard);
      game.cards.set(id, c);
      game.getPlayer(seat0).zones.get(ZoneType.Graveyard)?.add(id);
    }

    const sa = new SpellAbility(
      mkAst("ChangeZone", {
        Origin: { kind: "literal", raw: "Graveyard" },
        Destination: { kind: "literal", raw: "Hand" },
        ChangeNum: { kind: "literal", raw: "2" },
        Chooser: { kind: "literal", raw: "Opponent" },
      }),
      sourceId,
      seat0,
      new Map(),
      [id1, id2, id3],
    );
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let next = gen.next();
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "chooseCard") {
        // Invalid: chosen id not in pool.
        next = gen.next({ kind: "chooseCard", chosen: [mkEntityId(99999)] });
      } else {
        next = gen.next();
      }
    }
    // Fallback prefix: id1, id2 should land in hand; id3 stays in graveyard.
    expect(game.cards.get(id1)?.zone).toBe(ZoneType.Hand);
    expect(game.cards.get(id2)?.zone).toBe(ZoneType.Hand);
    expect(game.cards.get(id3)?.zone).toBe(ZoneType.Graveyard);
  });

  it("no Chooser$ → no decision yield (controller-driven prefix slice)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const id1 = mkEntityId(20);
    const id2 = mkEntityId(21);

    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    for (const id of [id1, id2]) {
      const c = new Card(id, bearPaper, seat0, seat0, ZoneType.Graveyard);
      game.cards.set(id, c);
      game.getPlayer(seat0).zones.get(ZoneType.Graveyard)?.add(id);
    }

    const sa = new SpellAbility(
      mkAst("ChangeZone", {
        Origin: { kind: "literal", raw: "Graveyard" },
        Destination: { kind: "literal", raw: "Hand" },
        ChangeNum: { kind: "literal", raw: "1" },
      }),
      sourceId,
      seat0,
      new Map(),
      [id1, id2],
    );
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let next = gen.next();
    let sawChoose = false;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "chooseCard") {
        sawChoose = true;
      }
      next = gen.next();
    }
    expect(sawChoose).toBe(false);
    expect(game.cards.get(id1)?.zone).toBe(ZoneType.Hand);
    expect(game.cards.get(id2)?.zone).toBe(ZoneType.Graveyard);
  });
});

// ---------------------------------------------------------------------
// PutCounter UpTo$ True
// ---------------------------------------------------------------------

describe("Wave 63.A — PutCounter UpTo$ migration", () => {
  it("UpTo$ True yields chooseNumber and applies the chosen amount", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const tgtId = mkEntityId(20);
    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    const tgt = new Card(tgtId, bearPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(tgtId, tgt);

    const sa = new SpellAbility(
      mkAst("PutCounter", {
        CounterType: { kind: "literal", raw: "+1/+1" },
        CounterNum: { kind: "literal", raw: "5" },
        UpTo: { kind: "literal", raw: "True" },
      }),
      sourceId,
      seat0,
      new Map(),
      [tgtId],
    );
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let next = gen.next();
    let sawChoose = false;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "chooseNumber") {
        sawChoose = true;
        next = gen.next({ kind: "chooseNumber", chosen: 3 });
      } else {
        next = gen.next();
      }
    }
    expect(sawChoose).toBe(true);
    expect(game.cards.get(tgtId)?.counters.get(CounterType.PlusOnePlusOne)).toBe(3);
  });

  it("UpTo$ True with chosen=0 places no counters", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const tgtId = mkEntityId(20);
    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    const tgt = new Card(tgtId, bearPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(tgtId, tgt);

    const sa = new SpellAbility(
      mkAst("PutCounter", {
        CounterType: { kind: "literal", raw: "+1/+1" },
        CounterNum: { kind: "literal", raw: "3" },
        UpTo: { kind: "literal", raw: "True" },
      }),
      sourceId,
      seat0,
      new Map(),
      [tgtId],
    );
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let next = gen.next();
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "chooseNumber") {
        next = gen.next({ kind: "chooseNumber", chosen: 0 });
      } else {
        next = gen.next();
      }
    }
    expect(game.cards.get(tgtId)?.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(0);
  });

  it("UpTo$ True with out-of-range response falls back to full N", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const tgtId = mkEntityId(20);
    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    const tgt = new Card(tgtId, bearPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(tgtId, tgt);

    const sa = new SpellAbility(
      mkAst("PutCounter", {
        CounterType: { kind: "literal", raw: "+1/+1" },
        CounterNum: { kind: "literal", raw: "4" },
        UpTo: { kind: "literal", raw: "True" },
      }),
      sourceId,
      seat0,
      new Map(),
      [tgtId],
    );
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let next = gen.next();
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "chooseNumber") {
        // Out of range — fallback to full N.
        next = gen.next({ kind: "chooseNumber", chosen: 99 });
      } else {
        next = gen.next();
      }
    }
    expect(game.cards.get(tgtId)?.counters.get(CounterType.PlusOnePlusOne)).toBe(4);
  });
});

// ---------------------------------------------------------------------
// Discard Mode$ TgtChoose / Defined
// ---------------------------------------------------------------------

describe("Wave 63.A — Discard Mode$ TgtChoose / Defined", () => {
  it("Mode$ TgtChoose yields chooseCard and discards the picked subset", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    const handIds = [mkEntityId(20), mkEntityId(21), mkEntityId(22)];
    for (const id of handIds) {
      const c = new Card(id, bearPaper, seat0, seat0, ZoneType.Hand);
      game.cards.set(id, c);
      game.getPlayer(seat0).zones.get(ZoneType.Hand)?.add(id);
    }

    const sa = new SpellAbility(
      mkAst("Discard", {
        NumCards: { kind: "literal", raw: "2" },
        Mode: { kind: "literal", raw: "TgtChoose" },
      }),
      sourceId,
      seat0,
      new Map(),
    );
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let next = gen.next();
    let sawChoose = false;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "chooseCard") {
        sawChoose = true;
        // Pick the LAST two — would NOT be the prefix-fallback choice.
        next = gen.next({ kind: "chooseCard", chosen: [handIds[1] as never, handIds[2] as never] });
      } else {
        next = gen.next();
      }
    }
    expect(sawChoose).toBe(true);
    expect(game.cards.get(handIds[0] as never)?.zone).toBe(ZoneType.Hand);
    expect(game.cards.get(handIds[1] as never)?.zone).toBe(ZoneType.Graveyard);
    expect(game.cards.get(handIds[2] as never)?.zone).toBe(ZoneType.Graveyard);
  });

  it("Mode$ TgtChoose falls back to front-of-hand on invalid response", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    const handIds = [mkEntityId(20), mkEntityId(21), mkEntityId(22)];
    for (const id of handIds) {
      const c = new Card(id, bearPaper, seat0, seat0, ZoneType.Hand);
      game.cards.set(id, c);
      game.getPlayer(seat0).zones.get(ZoneType.Hand)?.add(id);
    }

    const sa = new SpellAbility(
      mkAst("Discard", {
        NumCards: { kind: "literal", raw: "1" },
        Mode: { kind: "literal", raw: "TgtChoose" },
      }),
      sourceId,
      seat0,
      new Map(),
    );
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let next = gen.next();
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "chooseCard") {
        // Invalid: chosen id not in hand.
        next = gen.next({ kind: "chooseCard", chosen: [mkEntityId(99999)] });
      } else {
        next = gen.next();
      }
    }
    // Front-of-hand fallback: handIds[0] in graveyard.
    expect(game.cards.get(handIds[0] as never)?.zone).toBe(ZoneType.Graveyard);
    expect(game.cards.get(handIds[1] as never)?.zone).toBe(ZoneType.Hand);
    expect(game.cards.get(handIds[2] as never)?.zone).toBe(ZoneType.Hand);
  });

  it("Mode$ Defined uses the literal DefinedCards$ id list", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, sourcePaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    const handIds = [mkEntityId(20), mkEntityId(21), mkEntityId(22)];
    for (const id of handIds) {
      const c = new Card(id, bearPaper, seat0, seat0, ZoneType.Hand);
      game.cards.set(id, c);
      game.getPlayer(seat0).zones.get(ZoneType.Hand)?.add(id);
    }

    const sa = new SpellAbility(
      mkAst("Discard", {
        NumCards: { kind: "literal", raw: "2" },
        Mode: { kind: "literal", raw: "Defined" },
        DefinedCards: { kind: "literal", raw: "20,22" },
      }),
      sourceId,
      seat0,
      new Map(),
    );
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let next = gen.next();
    let sawChoose = false;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "chooseCard") sawChoose = true;
      next = gen.next();
    }
    // Defined mode does not yield chooseCard.
    expect(sawChoose).toBe(false);
    expect(game.cards.get(handIds[0] as never)?.zone).toBe(ZoneType.Graveyard);
    expect(game.cards.get(handIds[1] as never)?.zone).toBe(ZoneType.Hand);
    expect(game.cards.get(handIds[2] as never)?.zone).toBe(ZoneType.Graveyard);
  });
});
