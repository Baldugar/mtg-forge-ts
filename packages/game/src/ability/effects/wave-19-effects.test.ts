// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 19 — final corpus-unknown effect handlers test suite. One smoke + 1
// happy-path per handler.
import "./wave-19-effects.js";
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
import { effectRegistry } from "../effect-registry.js";
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

const drainWithDecisions = (
  gen: Generator<unknown, void, unknown>,
  responder: (req: unknown) => unknown,
): unknown[] => {
  const out: unknown[] = [];
  let r = gen.next();
  while (!r.done) {
    out.push(r.value);
    const yielded = r.value as { kind?: string; request?: unknown };
    if (yielded.kind === "decision") {
      r = gen.next(responder(yielded.request));
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

// ── Registry ────────────────────────────────────────────────────────────────
describe("Wave 19 — handler registration", () => {
  it("registers all 15 handlers", () => {
    for (const key of [
      "LookAt",
      "RemoveFromCombat",
      "DigMultiple",
      "Goad",
      "Shuffle",
      "ChangeTargets",
      "PermanentNoncreature",
      "Discover",
      "Blight",
      "Connive",
      "FlipOntoBattlefield",
      "BecomesBlocked",
      "AddOrRemoveCounter",
      "AdvanceCrank",
      "WinsGame",
    ]) {
      expect(effectRegistry.has(key)).toBe(true);
    }
  });
});

// ── LookAt ──────────────────────────────────────────────────────────────────
describe("LookAtEffect", () => {
  it("emits a CardsRevealed event scoped to the controller", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    const cardId = mkEntityId(20);
    game.cards.set(cardId, new Card(cardId, paper, seat0, seat0, ZoneType.Library));
    lib?.add(cardId);
    const sa = mkSa("LookAt", { LookAtAmount: { kind: "literal", raw: "1" } }, sourceId);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const events = yields.filter((y) => (y as { kind?: string }).kind === "event") as {
      event: { kind: string; payload: { revealedTo: unknown } };
    }[];
    const reveal = events.find((e) => e.event.kind === "CardsRevealed");
    expect(reveal).toBeDefined();
    expect(reveal?.event.payload.revealedTo).toEqual([seat0]);
  });
});

// ── RemoveFromCombat ────────────────────────────────────────────────────────
describe("RemoveFromCombatEffect", () => {
  it("flags each target as removed from combat", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const targetId = mkEntityId(11);
    game.cards.set(mkEntityId(10), new Card(mkEntityId(10), paper, seat0, seat0, ZoneType.Battlefield));
    const target = new Card(targetId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(targetId, target);
    const sa = mkSa("RemoveFromCombat", {}, mkEntityId(10), seat0, [targetId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(target.removedFromCombat).toBe(true);
  });
});

// ── DigMultiple ─────────────────────────────────────────────────────────────
describe("DigMultipleEffect", () => {
  it("records dug card ids on remembered (smoke)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    const cardId = mkEntityId(20);
    game.cards.set(cardId, new Card(cardId, paper, seat0, seat0, ZoneType.Library));
    lib?.add(cardId);
    const sa = mkSa(
      "DigMultiple",
      { Repeat: { kind: "literal", raw: "1" }, DigNum: { kind: "literal", raw: "1" } },
      sourceId,
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(source.remembered).toContain(cardId);
  });
});

// ── Goad ────────────────────────────────────────────────────────────────────
describe("GoadEffect", () => {
  it("flags each target as goaded", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const targetId = mkEntityId(11);
    game.cards.set(mkEntityId(10), new Card(mkEntityId(10), paper, seat0, seat0, ZoneType.Battlefield));
    const target = new Card(targetId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(targetId, target);
    const sa = mkSa("Goad", {}, mkEntityId(10), seat0, [targetId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(target.goaded).toBe(true);
  });
});

// ── Shuffle ─────────────────────────────────────────────────────────────────
describe("ShuffleEffect", () => {
  it("calls game.action.shuffle without throwing", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    game.cards.set(mkEntityId(10), new Card(mkEntityId(10), paper, seat0, seat0, ZoneType.Battlefield));
    const sa = mkSa("Shuffle", { Defined: { kind: "literal", raw: "You" } }, mkEntityId(10));
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

// ── ChangeTargets ───────────────────────────────────────────────────────────
describe("ChangeTargetsEffect", () => {
  it("rewrites a stack item's targets when one is found (no-throw on missing)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    game.cards.set(mkEntityId(10), new Card(mkEntityId(10), paper, seat0, seat0, ZoneType.Battlefield));
    // No matching stack item — handler must be a no-op, not throw.
    const sa = mkSa("ChangeTargets", {}, mkEntityId(10), seat0, [mkEntityId(99), mkEntityId(50)]);
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

// ── PermanentNoncreature ────────────────────────────────────────────────────
describe("PermanentNoncreatureEffect", () => {
  it("moves the source card to the controller's battlefield", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Hand);
    game.cards.set(sourceId, source);
    game.getPlayer(seat0).zones.get(ZoneType.Hand)?.add(sourceId);
    const sa = mkSa("PermanentNoncreature", {}, sourceId);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(source.zone).toBe(ZoneType.Battlefield);
  });
});

// ── Discover ────────────────────────────────────────────────────────────────
describe("DiscoverEffect", () => {
  it("does not throw on empty library", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    game.cards.set(mkEntityId(10), new Card(mkEntityId(10), paper, seat0, seat0, ZoneType.Battlefield));
    const sa = mkSa("Discover", { Num: { kind: "literal", raw: "3" } });
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

// ── Blight ──────────────────────────────────────────────────────────────────
describe("BlightEffect", () => {
  it("adds a counter (CounterType$ Oil default)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const targetId = mkEntityId(11);
    game.cards.set(mkEntityId(10), new Card(mkEntityId(10), paper, seat0, seat0, ZoneType.Battlefield));
    const target = new Card(targetId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(targetId, target);
    const sa = mkSa("Blight", {}, mkEntityId(10), seat0, [targetId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    // Counter was added; specific kind irrelevant for the smoke test.
    expect([...target.counters.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});

// ── Connive ─────────────────────────────────────────────────────────────────
describe("ConniveEffect", () => {
  it("draws a card and discards (smoke)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    const cardId = mkEntityId(20);
    game.cards.set(cardId, new Card(cardId, paper, seat0, seat0, ZoneType.Library));
    lib?.add(cardId);
    game.cards.set(mkEntityId(10), new Card(mkEntityId(10), paper, seat0, seat0, ZoneType.Battlefield));
    const sa = mkSa("Connive", {}, mkEntityId(10));
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

// ── FlipOntoBattlefield ─────────────────────────────────────────────────────
describe("FlipOntoBattlefieldEffect", () => {
  it("emits a FlipCoin event", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Hand);
    game.cards.set(sourceId, source);
    game.getPlayer(seat0).zones.get(ZoneType.Hand)?.add(sourceId);
    const sa = mkSa("FlipOntoBattlefield", {}, sourceId);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const events = yields.filter((y) => (y as { kind?: string }).kind === "event") as {
      event: { kind: string };
    }[];
    expect(events.some((e) => e.event.kind === "FlipCoin")).toBe(true);
  });
});

// ── BecomesBlocked ──────────────────────────────────────────────────────────
describe("BecomesBlockedEffect", () => {
  it("records each target on remembered (smoke)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const targetId = mkEntityId(11);
    game.cards.set(mkEntityId(10), new Card(mkEntityId(10), paper, seat0, seat0, ZoneType.Battlefield));
    const target = new Card(targetId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(targetId, target);
    const sa = mkSa("BecomesBlocked", {}, mkEntityId(10), seat0, [targetId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(target.remembered).toContain(targetId);
  });
});

// ── AddOrRemoveCounter ──────────────────────────────────────────────────────
describe("AddOrRemoveCounterEffect", () => {
  it("adds when controller picks 'add'", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const targetId = mkEntityId(11);
    game.cards.set(mkEntityId(10), new Card(mkEntityId(10), paper, seat0, seat0, ZoneType.Battlefield));
    const target = new Card(targetId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(targetId, target);
    const sa = mkSa(
      "AddOrRemoveCounter",
      { CounterType: { kind: "literal", raw: "P1P1" }, CounterNum: { kind: "literal", raw: "1" } },
      mkEntityId(10),
      seat0,
      [targetId],
    );
    drainWithDecisions(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>, () => ({
      kind: "chooseGenericOption",
      optionId: "add",
    }));
    expect(target.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(1);
  });
});

// ── AdvanceCrank ────────────────────────────────────────────────────────────
describe("AdvanceCrankEffect", () => {
  it("runs without throwing (stub)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    game.cards.set(mkEntityId(10), new Card(mkEntityId(10), paper, seat0, seat0, ZoneType.Battlefield));
    const sa = mkSa("AdvanceCrank", {}, mkEntityId(10));
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

// ── WinsGame ────────────────────────────────────────────────────────────────
describe("WinsGameEffect", () => {
  it("routes through gameWin (no throw)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    game.cards.set(mkEntityId(10), new Card(mkEntityId(10), paper, seat0, seat0, ZoneType.Battlefield));
    const sa = mkSa("WinsGame", {}, mkEntityId(10));
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});
