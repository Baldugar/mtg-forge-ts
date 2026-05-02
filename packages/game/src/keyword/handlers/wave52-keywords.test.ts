// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 52 — smoke tests for ChapterKeywordHandler + ClassKeywordHandler.
//
// Each test exercises only the durable contract of its mechanic —
// handler registration, keyword stamping, slot population, and the
// per-keyword side effects (ETB/Main1/CounterAdded triggers for Saga;
// activated SA + classLevel slot for Class).
import "../../ability/effects/index.js";
import "../../altcost/index.js";
import "./index.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
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
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import { ChapterKeywordHandler } from "./chapter-keyword.js";
import { ClassKeywordHandler } from "./class-keyword.js";

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
const paper: PaperCard = {
  name: "Test",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const ALICE = mkPlayerSeat(0);

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [aliceLP, bobLP], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
  }
  return game;
};

describe("Wave 52 keyword handlers — registration", () => {
  it("ChapterKeywordHandler is registered under 'chapter'", () => {
    expect(keywordHandlerRegistry.has("chapter")).toBe(true);
  });
  it("ClassKeywordHandler is registered under 'class'", () => {
    expect(keywordHandlerRegistry.has("class")).toBe(true);
  });
});

describe("Wave 52 — Chapter activate stamps slots + 3 triggers", () => {
  it("parses K:Chapter:3:DBToken,DBToken,DBPump and registers ETB+Main1+watcher", () => {
    const game = mkGame();
    const id = mkEntityId(521);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new ChapterKeywordHandler().activate(
      {
        keyword: "chapter",
        params: { detail: { kind: "literal", raw: "3:DBToken,DBToken,DBPump" } },
      },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("chapter")).toBe(true);
    expect(card.sagaChapterCount).toBe(3);
    expect(card.sagaChapterSVars).toEqual(["DBToken", "DBToken", "DBPump"]);
    // M6.20 — Saga uses etbCounterSpecs (CR 714.2b replacement) for the
    // silent default-1 lore counter. The ETB trigger is registered for
    // Read-ahead Sagas (CR 714.4d) but its `matches` gates on
    // card.readAhead and stays inert for non-Read-ahead Sagas.
    expect(card.triggeredAbilities?.length).toBe(3);
    const slot = card as unknown as { etbCounterSpecs?: ReadonlyArray<{ counterType: string }> };
    expect(slot.etbCounterSpecs?.length).toBe(1);
    expect(slot.etbCounterSpecs?.[0]?.counterType).toBe(CounterType.Lore);
  });

  it("CounterAdded watcher flips sagaFinalChapterResolved when Lore == final chapter", () => {
    const game = mkGame();
    const id = mkEntityId(522);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new ChapterKeywordHandler().activate(
      { keyword: "chapter", params: { detail: { kind: "literal", raw: "3:DBA,DBB,DBC" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );

    // Locate the watcher (the CounterAdded matcher).
    const watcher = card.triggeredAbilities.find((t) =>
      t.matches({
        kind: "CounterAdded",
        version: 1,
        turn: 1,
        phase: "Main1" as never,
        payload: { cardId: id, counterType: CounterType.Lore as string, amount: 1 },
      } as never),
    );
    expect(watcher).toBeDefined();
    if (!watcher) return;

    // Pre-condition: not yet final.
    expect(card.sagaFinalChapterResolved).toBe(false);

    // Stamp 3 Lore counters by hand and run the resolver.
    card.counters.set(CounterType.Lore, 3);
    const resolver = (
      watcher as unknown as { resolver: { resolve: (g: unknown) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let step = gen.next();
    while (!step.done) step = gen.next(undefined);
    expect(card.sagaFinalChapterResolved).toBe(true);
  });

  it("does not flip sagaFinalChapterResolved when Lore < final chapter", () => {
    const game = mkGame();
    const id = mkEntityId(523);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new ChapterKeywordHandler().activate(
      { keyword: "chapter", params: { detail: { kind: "literal", raw: "3:DBA,DBB,DBC" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    // M6.20 — index 2 (etb, main1, watcher).
    const watcher = card.triggeredAbilities[2];
    if (!watcher) throw new Error("expected watcher trigger");
    card.counters.set(CounterType.Lore, 2);
    const resolver = (
      watcher as unknown as { resolver: { resolve: (g: unknown) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let step = gen.next();
    while (!step.done) step = gen.next(undefined);
    expect(card.sagaFinalChapterResolved).toBe(false);
  });

  it("tolerates malformed Chapter payload (count=0, no triggers fire usefully)", () => {
    const game = mkGame();
    const id = mkEntityId(524);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new ChapterKeywordHandler().activate(
      { keyword: "chapter", params: { detail: { kind: "literal", raw: "" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.sagaChapterCount).toBe(0);
    expect(card.sagaChapterSVars).toEqual([]);
    // Triggers still registered (defensive); watcher won't flip with count=0.
    card.counters.set(CounterType.Lore, 5);
    const watcher = card.triggeredAbilities[2];
    if (!watcher) throw new Error("expected watcher");
    const resolver = (
      watcher as unknown as { resolver: { resolve: (g: unknown) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let step = gen.next();
    while (!step.done) step = gen.next(undefined);
    expect(card.sagaFinalChapterResolved).toBe(false);
  });
});

describe("Wave 52 — Class activate stamps keyword + classLevel + activated SA", () => {
  it("parses K:Class:2:1 G:AddTrigger$ TriggerAttackersDeclared and synthesizes a sorcery-speed SA", () => {
    const game = mkGame();
    const id = mkEntityId(525);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new ClassKeywordHandler().activate(
      {
        keyword: "class",
        params: { detail: { kind: "literal", raw: "2:1 G:AddTrigger$ TriggerAttackersDeclared" } },
      },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("class")).toBe(true);
    expect(card.classLevel).toBe(1);
    expect(card.spellAbilities.length).toBe(1);
    const sa = card.spellAbilities[0];
    if (!sa) throw new Error("expected synthesized SA");
    // SA is sorcery-speed, Battlefield-zone, tagged class + class_level_2.
    expect(sa.activeInZones?.has(ZoneType.Battlefield)).toBe(true);
    expect(sa.tags?.has("class")).toBe(true);
    expect(sa.tags?.has("sorcery_speed")).toBe(true);
    expect(sa.tags?.has("class_level_2")).toBe(true);
  });

  it("multiple K:Class lines synthesize one SA per non-base level", () => {
    const game = mkGame();
    const id = mkEntityId(526);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    const handler = new ClassKeywordHandler();
    handler.activate(
      { keyword: "class", params: { detail: { kind: "literal", raw: "2:1 G:AddTrigger$ T1" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    handler.activate(
      { keyword: "class", params: { detail: { kind: "literal", raw: "3:3 G:AddStaticAbility$ S1" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.spellAbilities.length).toBe(2);
    const tags = card.spellAbilities.map((sa) => Array.from(sa.tags ?? []));
    expect(tags.some((t) => t.includes("class_level_2"))).toBe(true);
    expect(tags.some((t) => t.includes("class_level_3"))).toBe(true);
  });

  it("level-1 / no-cost K:Class lines do not synthesize an SA", () => {
    const game = mkGame();
    const id = mkEntityId(527);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new ClassKeywordHandler().activate(
      { keyword: "class", params: { detail: { kind: "literal", raw: "1::AddTrigger$ Base" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.classLevel).toBe(1);
    expect(card.spellAbilities.length).toBe(0);
  });
});

describe("Wave 52 — slot defaults", () => {
  it("Card defaults classLevel and saga slots to undefined", () => {
    const game = mkGame();
    const id = mkEntityId(528);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    expect(card.classLevel).toBeUndefined();
    expect(card.sagaChapterCount).toBeUndefined();
    expect(card.sagaChapterSVars).toBeUndefined();
  });
});
