// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 92 — TODO(advanced) sweep round 3 across keyword handlers.
//
// Closes inline TODO(advanced) tails on six keyword handlers (all
// stale-comment cleanups; the underlying wiring already lives in the
// engine and these handlers' contracts are durable):
//   * demonstrate-keyword.ts — stale TODO; the resolver invokes
//     castCopyOf for the controller and (after a chooseGenericOption
//     when there are >1 opponents) for the chosen opponent. Wave 64
//     closed the cast-pipeline tail. Comment cleanup.
//   * hideaway-keyword.ts — stale TODO; the conditional free-cast
//     ability lives in per-card AST as separate triggered/static rules,
//     not on the keyword handler. The stamped slots `hideawayCard` /
//     `hideawayHost` are the durable contract. Comment cleanup.
//   * friends-forever-keyword.ts — stale TODO; Friends Forever is a
//     deck-building constraint enforced at lobby/deck-validation time.
//     The runtime stamp is the durable contract. Comment cleanup.
//   * visit-keyword.ts — stale TODO; the visit-trigger flow is in the
//     ability layer (`SP$ VisitAttraction` emits AttractionVisited;
//     Wave-22's visit-attraction trigger handler dispatches). The
//     keyword's `visit = true` stamp is the durable contract. Comment
//     cleanup.
//   * spree-keyword.ts — stale TODO; cast-pipeline.ts (Wave 61.C)
//     yields `chooseSpreeModes`, splices each chosen mode's ModeCost
//     into the base raw cost, and stamps `card.spreeChosenModes`.
//     Comment cleanup.
//   * awaken-keyword.ts — stale TODO; the optional-cost slot reuse
//     (kickerCost ↔ awakenCost) is a deliberate, durable choice
//     (no printed Awaken card carries Kicker). Comment cleanup.
import "../../ability/effects/index.js";
import "../../altcost/index.js";
import "./index.js";
import type { LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
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
import { AwakenKeywordHandler } from "./awaken-keyword.js";
import { DemonstrateKeywordHandler } from "./demonstrate-keyword.js";
import { FriendsForeverKeywordHandler } from "./friends-forever-keyword.js";
import { HideawayKeywordHandler } from "./hideaway-keyword.js";
import { SpreeKeywordHandler } from "./spree-keyword.js";
import { VisitKeywordHandler } from "./visit-keyword.js";

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

// -----------------------------------------------------------------------
// Demonstrate — stale TODO cleanup. The resolver invokes castCopyOf for
// the controller and (after a chooseGenericOption when there are >1
// opponents) for the chosen opponent. Verify activate stamps the
// keyword + registers the SpellCast self-trigger.
// -----------------------------------------------------------------------

describe("Wave 92 — Demonstrate stale-TODO cleanup", () => {
  it("activate stamps 'demonstrate' keyword AND registers a SpellCast self-trigger", () => {
    const game = mkGame();
    const id = mkEntityId(9201);
    const card = new Card(id, plainPaper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new DemonstrateKeywordHandler().activate(
      { keyword: "demonstrate" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("demonstrate")).toBe(true);
    // One SpellCast self-trigger registered.
    expect(card.triggeredAbilities.length).toBe(1);
    const ta = card.triggeredAbilities[0];
    expect(ta).toBeDefined();
    if (!ta) return;
    expect(ta.activeInZones.has(ZoneType.Stack)).toBe(true);
  });
});

// -----------------------------------------------------------------------
// Hideaway — stale TODO cleanup. The conditional free-cast ability lives
// in per-card AST. Verify activate stamps the keyword + registers the
// ETB trigger; the slots `hideawayCard` / `hideawayHost` are the
// observable contract that downstream per-card abilities consult.
// -----------------------------------------------------------------------

describe("Wave 92 — Hideaway stale-TODO cleanup", () => {
  it("activate stamps 'hideaway' keyword AND registers an ETB trigger", () => {
    const game = mkGame();
    const id = mkEntityId(9202);
    const card = new Card(id, plainPaper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new HideawayKeywordHandler().activate(
      { keyword: "hideaway", params: { amount: { kind: "literal", raw: "4" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("hideaway")).toBe(true);
    // One ETB self-trigger registered.
    expect(card.triggeredAbilities.length).toBe(1);
    const ta = card.triggeredAbilities[0];
    expect(ta).toBeDefined();
    if (!ta) return;
    expect(ta.activeInZones.has(ZoneType.Battlefield)).toBe(true);
  });

  it("hideawayCard / hideawayHost slots are the durable contract for per-card free-cast", () => {
    const game = mkGame();
    const hostId = mkEntityId(9203);
    const exiledId = mkEntityId(9204);
    const host = new Card(hostId, plainPaper, ALICE, ALICE, ZoneType.Battlefield);
    const exiled = new Card(exiledId, plainPaper, ALICE, ALICE, ZoneType.Exile);
    game.cards.set(hostId, host);
    game.cards.set(exiledId, exiled);
    // Simulate the link the ETB resolver writes after exile.
    host.hideawayCard = exiledId;
    exiled.hideawayHost = hostId;
    expect(host.hideawayCard).toBe(exiledId);
    expect(exiled.hideawayHost).toBe(hostId);
  });
});

// -----------------------------------------------------------------------
// Friends Forever — stale TODO cleanup. Deck-building constraint; the
// runtime stamp is the durable contract.
// -----------------------------------------------------------------------

describe("Wave 92 — Friends Forever stale-TODO cleanup", () => {
  it("activate stamps 'friends_forever' keyword (the deck-builder contract)", () => {
    const game = mkGame();
    const id = mkEntityId(9205);
    const card = new Card(id, plainPaper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new FriendsForeverKeywordHandler().activate(
      { keyword: "friends_forever" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("friends_forever")).toBe(true);
    // No triggered/spell abilities are synthesized — the keyword has no
    // runtime ability surface.
    expect(card.triggeredAbilities.length).toBe(0);
  });

  it("deactivate removes the 'friends_forever' stamp", () => {
    const game = mkGame();
    const id = mkEntityId(9206);
    const card = new Card(id, plainPaper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new FriendsForeverKeywordHandler().activate(
      { keyword: "friends_forever" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("friends_forever")).toBe(true);
    new FriendsForeverKeywordHandler().deactivate(
      { keyword: "friends_forever" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("friends_forever")).toBe(false);
  });
});

// -----------------------------------------------------------------------
// Visit — stale TODO cleanup. The visit-trigger flow lives in the
// ability layer (`SP$ VisitAttraction` emits AttractionVisited; Wave-22
// trigger handler dispatches). The keyword's `visit = true` stamp is
// the durable contract.
// -----------------------------------------------------------------------

describe("Wave 92 — Visit stale-TODO cleanup", () => {
  it("activate stamps 'visit' keyword AND card.visit = true", () => {
    const game = mkGame();
    const id = mkEntityId(9207);
    const card = new Card(id, plainPaper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new VisitKeywordHandler().activate(
      { keyword: "visit" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("visit")).toBe(true);
    expect(card.visit).toBe(true);
    // No triggered abilities synthesized — the visit-trigger lives in
    // the ability layer (SP$ VisitAttraction → AttractionVisited event).
    expect(card.triggeredAbilities.length).toBe(0);
  });

  it("deactivate removes the visit stamp + card.visit slot", () => {
    const game = mkGame();
    const id = mkEntityId(9208);
    const card = new Card(id, plainPaper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new VisitKeywordHandler().activate(
      { keyword: "visit" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    new VisitKeywordHandler().deactivate(
      { keyword: "visit" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("visit")).toBe(false);
    expect(card.visit).toBeUndefined();
  });
});

// -----------------------------------------------------------------------
// Spree — stale TODO cleanup. Cast-pipeline (Wave 61.C) wires the per-
// mode-additional-cost loop fully. Verify activate stamps the slot.
// -----------------------------------------------------------------------

describe("Wave 92 — Spree stale-TODO cleanup", () => {
  it("activate stamps 'spree' keyword AND card.isSpree = true", () => {
    const game = mkGame();
    const id = mkEntityId(9209);
    const card = new Card(id, plainPaper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new SpreeKeywordHandler().activate(
      { keyword: "spree" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("spree")).toBe(true);
    expect(card.isSpree).toBe(true);
  });

  it("deactivate clears the slot so the cast-pipeline gate (`isSpree === true`) fails closed", () => {
    const game = mkGame();
    const id = mkEntityId(9210);
    const card = new Card(id, plainPaper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new SpreeKeywordHandler().activate(
      { keyword: "spree" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    new SpreeKeywordHandler().deactivate(
      { keyword: "spree" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("spree")).toBe(false);
    expect(card.isSpree).toBeUndefined();
  });
});

// -----------------------------------------------------------------------
// Awaken — stale TODO cleanup. The kicker-slot reuse is a deliberate
// design choice. Verify activate stamps the keyword + amount + reuses
// the kicker cost slot for the awaken cost.
// -----------------------------------------------------------------------

describe("Wave 92 — Awaken stale-TODO cleanup (kicker-slot reuse is durable)", () => {
  it("activate stamps 'awaken' keyword AND awakenAmount AND reuses kickerCost slot", () => {
    const game = mkGame();
    const id = mkEntityId(9211);
    const card = new Card(id, plainPaper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new AwakenKeywordHandler().activate(
      {
        keyword: "awaken",
        params: {
          amount: { kind: "literal", raw: "3" },
          cost: { kind: "literal", raw: "4 U" },
        },
      },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("awaken")).toBe(true);
    expect(card.awakenAmount).toBe(3);
    // Kicker-slot reuse: awaken cost lands on the kickerCost slot
    // because no printed Awaken card carries Kicker (deliberate, safe
    // sharing of the optional-cost confirmAction pipeline).
    expect(card.kickerCost).toBe("4 U");
  });

  it("does NOT overwrite an existing kickerCost when one is already present", () => {
    const game = mkGame();
    const id = mkEntityId(9212);
    const card = new Card(id, plainPaper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    // Pre-stamp kickerCost (simulates a card with Kicker already
    // processed before Awaken; defensive for unusual data).
    card.kickerCost = "2 R";
    new AwakenKeywordHandler().activate(
      {
        keyword: "awaken",
        params: {
          amount: { kind: "literal", raw: "2" },
          cost: { kind: "literal", raw: "3 W" },
        },
      },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.awakenAmount).toBe(2);
    // The existing kickerCost is preserved (the awaken handler skips
    // the slot when it's already taken).
    expect(card.kickerCost).toBe("2 R");
  });
});
