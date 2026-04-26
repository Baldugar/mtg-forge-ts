// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 40 — Dredge keyword handler + drawCards integration.
// CR 702.52a: a Dredge N card in your graveyard offers an alternative
// to drawing — mill N + return self to hand.
import "../../ability/effects/index.js";
import "./index.js";
import type { EntityId, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import { DredgeKeywordHandler } from "./dredge-keyword.js";

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
  name: "T",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const ALICE = mkPlayerSeat(0);

const mkFx = () => {
  const game = new Game({ lobbyPlayers: [aliceLP, bobLP], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
  }
  const addToZone = (id: EntityId, zone: ZoneType, seat: PlayerSeat = ALICE) => {
    const card = new Card(id, paper, seat, seat, zone);
    game.cards.set(id, card);
    const z = game.getPlayer(seat).zones.get(zone);
    if (!z) throw new Error("missing zone");
    z.add(id);
    return card;
  };
  return { game, addToZone };
};

describe("Wave 40 — DredgeKeywordHandler registration + slot stamp", () => {
  it("DredgeKeywordHandler is registered under 'dredge'", () => {
    expect(keywordHandlerRegistry.has("dredge")).toBe(true);
  });

  it("activate stamps `dredge` keyword + dredgeAmount", () => {
    const fx = mkFx();
    const id = mkEntityId(401);
    const card = fx.addToZone(id, ZoneType.Graveyard);
    new DredgeKeywordHandler().activate(
      { keyword: "dredge", params: { amount: { kind: "literal", raw: "3" } } },
      { game: fx.game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("dredge")).toBe(true);
    expect(card.dredgeAmount).toBe(3);
  });

  it("deactivate clears keyword + dredgeAmount", () => {
    const fx = mkFx();
    const id = mkEntityId(402);
    const card = fx.addToZone(id, ZoneType.Graveyard);
    const handler = new DredgeKeywordHandler();
    handler.activate(
      { keyword: "dredge", params: { amount: { kind: "literal", raw: "5" } } },
      { game: fx.game, sourceCardId: id, controllerSeat: ALICE },
    );
    handler.deactivate({ keyword: "dredge" }, { game: fx.game, sourceCardId: id, controllerSeat: ALICE });
    expect(card.keywords?.has("dredge")).toBe(false);
    expect(card.dredgeAmount).toBeUndefined();
  });
});

describe("Wave 40 — drawCards offers Dredge alternative", () => {
  it("when player chooses dredge: mills N + returns dredge card to hand instead of drawing", () => {
    const fx = mkFx();
    // 5 library cards, 1 dredge card (Dredge:3) in graveyard.
    const lib1 = mkEntityId(501);
    const lib2 = mkEntityId(502);
    const lib3 = mkEntityId(503);
    const lib4 = mkEntityId(504);
    const lib5 = mkEntityId(505);
    fx.addToZone(lib1, ZoneType.Library);
    fx.addToZone(lib2, ZoneType.Library);
    fx.addToZone(lib3, ZoneType.Library);
    fx.addToZone(lib4, ZoneType.Library);
    fx.addToZone(lib5, ZoneType.Library);
    const dredgeId = mkEntityId(550);
    fx.addToZone(dredgeId, ZoneType.Graveyard);
    new DredgeKeywordHandler().activate(
      { keyword: "dredge", params: { amount: { kind: "literal", raw: "3" } } },
      { game: fx.game, sourceCardId: dredgeId, controllerSeat: ALICE },
    );

    // Drive the generator. Respond to chooseCard with the dredge card.
    const gen = fx.game.action.drawCards(ALICE, 1);
    let res = gen.next();
    let safety = 0;
    while (!res.done && safety++ < 50) {
      const y = res.value as { kind: string; request?: { kind: string } };
      if (y.kind === "decision" && y.request?.kind === "chooseCard") {
        res = gen.next({ kind: "chooseCard", chosen: [dredgeId] });
        continue;
      }
      res = gen.next();
    }

    // Expectations: dredge card is now in hand; 3 cards milled to graveyard;
    // 2 cards left in library; no extra draw happened (hand size === 1).
    const alice = fx.game.getPlayer(ALICE);
    const hand = alice.zones.get(ZoneType.Hand);
    const library = alice.zones.get(ZoneType.Library);
    const graveyard = alice.zones.get(ZoneType.Graveyard);
    expect(hand?.size).toBe(1);
    expect(hand?.contains(dredgeId)).toBe(true);
    expect(library?.size).toBe(2);
    // 3 cards milled from library to graveyard; dredge card moved out so:
    expect(graveyard?.size).toBe(3);
  });

  it("when no dredge offer accepted: regular draw fires", () => {
    const fx = mkFx();
    const lib1 = mkEntityId(601);
    const lib2 = mkEntityId(602);
    fx.addToZone(lib1, ZoneType.Library);
    fx.addToZone(lib2, ZoneType.Library);
    const dredgeId = mkEntityId(650);
    fx.addToZone(dredgeId, ZoneType.Graveyard);
    new DredgeKeywordHandler().activate(
      { keyword: "dredge", params: { amount: { kind: "literal", raw: "5" } } },
      { game: fx.game, sourceCardId: dredgeId, controllerSeat: ALICE },
    );
    // Library has only 2 cards; Dredge:5 requires 5 — not eligible.
    const gen = fx.game.action.drawCards(ALICE, 1);
    let res = gen.next();
    let safety = 0;
    while (!res.done && safety++ < 50) {
      const y = res.value as { kind: string; request?: { kind: string } };
      if (y.kind === "decision" && y.request?.kind === "chooseCard") {
        // No eligible dredge — but if asked, decline.
        res = gen.next({ kind: "chooseCard", chosen: [] });
        continue;
      }
      res = gen.next();
    }
    const alice = fx.game.getPlayer(ALICE);
    const hand = alice.zones.get(ZoneType.Hand);
    const library = alice.zones.get(ZoneType.Library);
    expect(hand?.size).toBe(1);
    expect(library?.size).toBe(1);
    // Dredge card stays in graveyard.
    expect(alice.zones.get(ZoneType.Graveyard)?.contains(dredgeId)).toBe(true);
  });
});
