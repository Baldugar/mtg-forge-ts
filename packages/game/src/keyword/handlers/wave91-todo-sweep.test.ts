// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 91 — TODO(advanced) sweep round 2 across keyword handlers.
//
// Closes inline TODO(advanced) tails on six keyword handlers:
//   * strive-keyword.ts — stale TODO; the per-extra-target surcharge is
//     wired in cast-pipeline.ts (Wave 41). Comment cleanup.
//   * compleated-keyword.ts — stale TODO; the per-Φ-pip count is captured
//     by the boolean stamp because today's printed corpus has exactly one
//     Φ pip per Compleated planeswalker. Comment cleanup.
//   * read-ahead-keyword.ts — stale TODO; the chooseNumber decision and
//     "start at chapter N" lore-counter pre-advance are wired in
//     chapter-keyword.ts (Wave 68). Comment cleanup.
//   * bloodthirst-keyword.ts — wires the K:Bloodthirst:X variable amount
//     reading max lifeLostThisTurn across opponents.
//   * replicate-keyword.ts — wires parseCostString/payCost in the copy
//     loop (drops payment-skipped MVP).
//   * suspect-keyword.ts — emits a CardSuspected event on innate
//     K:Suspect activation (sourceId: null) so registered listeners see
//     the transition.
import "../../ability/effects/index.js";
import "../../altcost/index.js";
import "./index.js";
import { parseCard } from "@mtg-forge-ts/cards";
import type { LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  Color,
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaProduced,
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
import { ManaPool } from "../../mana/mana-pool.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Exile } from "../../zone/zones/exile.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { BloodthirstKeywordHandler } from "./bloodthirst-keyword.js";
import { CompleatedKeywordHandler } from "./compleated-keyword.js";
import { ReadAheadKeywordHandler } from "./read-ahead-keyword.js";
import { ReplicateKeywordHandler } from "./replicate-keyword.js";
import { StriveKeywordHandler } from "./strive-keyword.js";
import { SuspectKeywordHandler } from "./suspect-keyword.js";

const aliceLP: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bobLP: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };
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

const ALICE: PlayerSeat = mkPlayerSeat(0);
const BOB: PlayerSeat = mkPlayerSeat(1);

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [aliceLP, bobLP], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, p.seat));
  }
  return game;
};

const plainPaper: PaperCard = {
  name: "Test",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const goblinSrc = (): string =>
  `${["Name:Test Goblin", "ManaCost:1 R", "Types:Creature Goblin", "PT:1/1", "Oracle:Test"].join("\n")}\n`;

const mkPaper = (name: string, src: string): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(src, `${name}.txt`),
});

interface YieldEnvelope {
  readonly kind?: string;
  readonly request?: { readonly kind?: string };
}

// -----------------------------------------------------------------------
// Strive — stale TODO cleanup. The cast-pipeline (Wave 41) splices
// `striveExtraCost * (targets - 1)` into baseCost.raw before payCost.
// Verify activate still stamps the slot so the read continues to fire.
// -----------------------------------------------------------------------

describe("Wave 91 — Strive stale-TODO cleanup", () => {
  it("activate stamps 'strive' keyword AND card.striveExtraCost", () => {
    const game = mkGame();
    const id = mkEntityId(9101);
    const card = new Card(id, plainPaper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new StriveKeywordHandler().activate(
      { keyword: "strive", params: { cost: { kind: "literal", raw: "1 W" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("strive")).toBe(true);
    expect((card as unknown as { striveExtraCost?: string }).striveExtraCost).toBe("1 W");
  });
});

// -----------------------------------------------------------------------
// Compleated — stale TODO cleanup. The boolean stamp covers every
// printed Compleated planeswalker (one Φ pip each). Verify activate
// stamps the slot so the Wave 65.B PW-loyalty read continues to fire.
// -----------------------------------------------------------------------

describe("Wave 91 — Compleated stale-TODO cleanup", () => {
  it("activate stamps 'compleated' keyword AND card.compleated = true", () => {
    const game = mkGame();
    const id = mkEntityId(9102);
    const card = new Card(id, plainPaper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new CompleatedKeywordHandler().activate(
      { keyword: "compleated" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("compleated")).toBe(true);
    expect(card.compleated).toBe(true);
  });
});

// -----------------------------------------------------------------------
// Read ahead — stale TODO cleanup. The chooseNumber decision is wired in
// chapter-keyword.ts (Wave 68); the keyword's responsibility is just
// stamping the slot.
// -----------------------------------------------------------------------

describe("Wave 91 — Read-ahead stale-TODO cleanup", () => {
  it("activate stamps 'read_ahead' keyword AND card.readAhead = true", () => {
    const game = mkGame();
    const id = mkEntityId(9103);
    const card = new Card(id, plainPaper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new ReadAheadKeywordHandler().activate(
      { keyword: "read_ahead" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("read_ahead")).toBe(true);
    expect(card.readAhead).toBe(true);
  });
});

// -----------------------------------------------------------------------
// Bloodthirst:X — variable amount reads max lifeLostThisTurn across
// opponents. Verify N=damage-max when X is the literal, and N=fixed for
// numeric literals.
// -----------------------------------------------------------------------

describe("Wave 91 — Bloodthirst:X variable amount", () => {
  it("X resolves to max opponent lifeLostThisTurn at trigger-resolve time", () => {
    const game = mkGame();
    const sourceId = mkEntityId(9110);
    const source = new Card(sourceId, plainPaper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    // Bob lost 5 life this turn (e.g. damage taken).
    game.flags.lifeLostThisTurn.set(BOB, 5);

    new BloodthirstKeywordHandler().activate(
      { keyword: "bloodthirst", params: { amount: { kind: "literal", raw: "X" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    expect(ta).toBeDefined();
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) next = gen.next();
    // X = max(5) = 5 +1/+1 counters.
    expect(source.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(5);
  });

  it("X resolves to 0-no-counters when no opponent took damage (no-op)", () => {
    const game = mkGame();
    const sourceId = mkEntityId(9111);
    const source = new Card(sourceId, plainPaper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    // No opponent damage this turn.
    new BloodthirstKeywordHandler().activate(
      { keyword: "bloodthirst", params: { amount: { kind: "literal", raw: "X" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) next = gen.next();
    expect(source.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(0);
  });

  it("literal N=3 still resolves to 3 (not damage-max) when opponent was hit", () => {
    const game = mkGame();
    const sourceId = mkEntityId(9112);
    const source = new Card(sourceId, plainPaper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    // Bob lost 7 life this turn — but K:Bloodthirst:3 should still grant 3.
    game.flags.lifeLostThisTurn.set(BOB, 7);

    new BloodthirstKeywordHandler().activate(
      { keyword: "bloodthirst", params: { amount: { kind: "literal", raw: "3" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) next = gen.next();
    expect(source.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(3);
  });
});

// -----------------------------------------------------------------------
// Replicate — wires parseCostString/payCost in the copy loop. On confirm
// + sufficient mana: each iteration drains the cost + queues a copy. On
// confirm + insufficient mana: loop breaks, no extra copies queue.
// -----------------------------------------------------------------------

describe("Wave 91 — Replicate cost-payment integration", () => {
  it("on two confirms with R+R in pool: drains 2R, loop continues for both", () => {
    const game = mkGame();
    const sourceId = mkEntityId(9120);
    const source = new Card(sourceId, mkPaper("Test Goblin", goblinSrc()), ALICE, ALICE, ZoneType.Stack);
    game.cards.set(sourceId, source);

    // Two R in the pool — enough for two replicate cost payments at "R".
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Red, { sourceId: mkEntityId(99) }));
    pool.add(ManaProduced.colored(Color.Red, { sourceId: mkEntityId(99) }));
    game.getPlayer(ALICE).manaPool = pool;

    new ReplicateKeywordHandler().activate(
      { keyword: "replicate", params: { cost: { kind: "literal", raw: "R" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    expect(ta).toBeDefined();
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    let confirmsHandled = 0;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "confirmAction") {
        if (confirmsHandled < 2) {
          confirmsHandled++;
          next = gen.next({ kind: "confirmAction", confirmed: true });
        } else {
          next = gen.next({ kind: "confirmAction", confirmed: false });
        }
      } else {
        next = gen.next();
      }
    }
    // Both R drained.
    expect(pool.size()).toBe(0);
    expect(confirmsHandled).toBe(2);
  });

  it("on confirm + empty pool: loop breaks at first payment failure", () => {
    const game = mkGame();
    const sourceId = mkEntityId(9121);
    const source = new Card(sourceId, mkPaper("Test Goblin", goblinSrc()), ALICE, ALICE, ZoneType.Stack);
    game.cards.set(sourceId, source);

    // Empty pool — first payment will throw.
    game.getPlayer(ALICE).manaPool = new ManaPool();

    new ReplicateKeywordHandler().activate(
      { keyword: "replicate", params: { cost: { kind: "literal", raw: "R" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    let confirmCount = 0;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "confirmAction") {
        confirmCount++;
        next = gen.next({ kind: "confirmAction", confirmed: true });
      } else {
        next = gen.next();
      }
    }
    // Only one confirm seen — payment failure breaks the loop.
    expect(confirmCount).toBe(1);
  });
});

// -----------------------------------------------------------------------
// Suspect — innate K:Suspect activation now emits a CardSuspected event
// (sourceId: null) so registered listeners see the transition.
// -----------------------------------------------------------------------

describe("Wave 91 — Suspect emits CardSuspected event on K:Suspect activation", () => {
  it("activate routes a CardSuspected event through the trigger registry", () => {
    const game = mkGame();
    const id = mkEntityId(9130);
    const card = new Card(id, plainPaper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);

    // Register a watch trigger that captures the CardSuspected event.
    let captured: { cardId: unknown; sourceId: unknown } | null = null;
    const watchId = game.newEntityId();
    game.triggerRegistry.register({
      id: watchId,
      kind: "triggered",
      sourceCardId: id,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: ALICE,
      isDelayed: false,
      matches(event) {
        if (event.kind !== "CardSuspected") return false;
        const p = event.payload as { cardId: unknown; sourceId: unknown };
        if (p.cardId !== id) return false;
        captured = { cardId: p.cardId, sourceId: p.sourceId };
        return false; // don't actually queue; we only want capture
      },
    });

    new SuspectKeywordHandler().activate(
      { keyword: "suspect" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("suspect")).toBe(true);
    expect(card.suspected).toBe(true);
    expect(captured).not.toBeNull();
    expect(captured && (captured as { cardId: unknown }).cardId).toBe(id);
    // sourceId is null for innate K:Suspect (no spell/ability cause).
    expect(captured && (captured as { sourceId: unknown }).sourceId).toBe(null);
  });

  it("re-activation on already-suspected card does NOT re-emit", () => {
    const game = mkGame();
    const id = mkEntityId(9131);
    const card = new Card(id, plainPaper, ALICE, ALICE, ZoneType.Battlefield);
    card.suspected = true; // already suspected
    game.cards.set(id, card);

    let fired = false;
    const watchId = game.newEntityId();
    game.triggerRegistry.register({
      id: watchId,
      kind: "triggered",
      sourceCardId: id,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: ALICE,
      isDelayed: false,
      matches(event) {
        if (event.kind === "CardSuspected") fired = true;
        return false;
      },
    });

    new SuspectKeywordHandler().activate(
      { keyword: "suspect" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(fired).toBe(false);
  });
});
