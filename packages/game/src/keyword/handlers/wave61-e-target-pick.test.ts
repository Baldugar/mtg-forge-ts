// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 61.E — interactive target-pick migrations for Awaken / Cipher.
// Each test drives the keyword's triggered-ability resolver generator,
// intercepting the chooseCard (and confirmAction, for Cipher) decision
// yields and returning a typed DecisionResponse.
//
// Coverage:
//   * happy path (responder picks a valid candidate; effect lands on it)
//   * invalid pick (response carries an id outside `pool`); resolver
//     falls back to first eligible.
//   * no-eligible-targets (resolver yields no decision; trigger no-ops).
//   * Cipher "you may" decline: confirmAction false → no chooseCard, no
//     encode link stamped.
//
// Bloodthirst is auto-stamps-self (no target pick) — verified by reading
// the handler; no test in this file.
//
// The setup mirrors wave61-d-target-pick.test.ts: walk the resolver
// generator manually, recognize the decision payloads by their nested
// request.kind, and inject a response on each yield.
import "../../ability/effects/index.js";
import "../../altcost/index.js";
import "./index.js";
import { parseCard } from "@mtg-forge-ts/cards";
import type { LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
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
import { Hand } from "../../zone/zones/hand.js";
import { AwakenKeywordHandler } from "./awaken-keyword.js";
import { CipherKeywordHandler } from "./cipher-keyword.js";

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

// Forge-script sources for vanilla Creature / Land entities so
// layerEngine.computeCharacteristics reports the right CardType.
const creatureSrc = (): string =>
  `${["Name:Test Creature", "ManaCost:1", "Types:Creature", "PT:2/2", "Oracle:Test"].join("\n")}\n`;
const landSrc = (): string => `${["Name:Test Land", "Types:Land", "Oracle:Test"].join("\n")}\n`;
const sorcerySrc = (): string =>
  `${["Name:Test Sorcery", "ManaCost:1 U", "Types:Sorcery", "Oracle:Test"].join("\n")}\n`;

const mkCreaturePaper = (): PaperCard => ({
  name: "Test Creature",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(creatureSrc(), "test-creature.txt"),
});
const mkLandPaper = (): PaperCard => ({
  name: "Test Land",
  edition: "TST",
  collectorNumber: "002",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(landSrc(), "test-land.txt"),
});
const mkSorceryPaper = (): PaperCard => ({
  name: "Test Sorcery",
  edition: "TST",
  collectorNumber: "003",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(sorcerySrc(), "test-sorcery.txt"),
});

const ALICE: PlayerSeat = mkPlayerSeat(0);
const BOB: PlayerSeat = mkPlayerSeat(1);

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [aliceLP, bobLP], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
  }
  return game;
};

const mkEntity = (
  game: Game,
  id: number,
  paper: PaperCard,
  ownerSeat: PlayerSeat,
  controllerSeat: PlayerSeat,
  zone: ZoneType,
): Card => {
  const eid = mkEntityId(id);
  const c = new Card(eid, paper, ownerSeat, controllerSeat, zone);
  game.cards.set(eid, c);
  game.getPlayer(controllerSeat).zones.get(zone)?.add(eid);
  return c;
};

interface YieldEnvelope {
  readonly kind?: string;
  readonly request?: { readonly kind?: string };
}

// ---------------------------------------------------------------------
// Awaken
// ---------------------------------------------------------------------

describe("Wave 61.E — Awaken target-pick migration", () => {
  it("yields chooseCard and stamps counters + animation flag on the picked land", () => {
    const game = mkGame();
    const sourceId = mkEntityId(6401);
    const source = mkEntity(game, 6401, mkSorceryPaper(), ALICE, ALICE, ZoneType.Stack);
    source.wasKicked = true;
    source.awakenAmount = 3;
    const landA = mkEntity(game, 6402, mkLandPaper(), ALICE, ALICE, ZoneType.Battlefield);
    const landB = mkEntity(game, 6403, mkLandPaper(), ALICE, ALICE, ZoneType.Battlefield);

    new AwakenKeywordHandler().activate(
      {
        keyword: "awaken",
        params: {
          amount: { kind: "literal", raw: "3" },
          cost: { kind: "literal", raw: "4 U" },
        },
      },
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
    let sawChoose = false;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "chooseCard") {
        sawChoose = true;
        next = gen.next({ kind: "chooseCard", chosen: [landB.id] });
      } else {
        next = gen.next();
      }
    }
    expect(sawChoose).toBe(true);
    expect(landB.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(3);
    expect(landB.awakenAnimatedUntilEot).toBe(true);
    expect(landA.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(0);
    expect(landA.awakenAnimatedUntilEot).toBeUndefined();
  });

  it("falls back to first eligible when the response is invalid", () => {
    const game = mkGame();
    const sourceId = mkEntityId(6411);
    const source = mkEntity(game, 6411, mkSorceryPaper(), ALICE, ALICE, ZoneType.Stack);
    source.wasKicked = true;
    source.awakenAmount = 1;
    const landA = mkEntity(game, 6412, mkLandPaper(), ALICE, ALICE, ZoneType.Battlefield);
    const landB = mkEntity(game, 6413, mkLandPaper(), ALICE, ALICE, ZoneType.Battlefield);

    new AwakenKeywordHandler().activate(
      {
        keyword: "awaken",
        params: {
          amount: { kind: "literal", raw: "1" },
          cost: { kind: "literal", raw: "4 U" },
        },
      },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "chooseCard") {
        next = gen.next({ kind: "chooseCard", chosen: [mkEntityId(99999)] });
      } else {
        next = gen.next();
      }
    }
    // Fallback first eligible — exactly one land ends up animated.
    const animatedCount = [landA, landB].filter((c) => c.awakenAnimatedUntilEot === true).length;
    expect(animatedCount).toBe(1);
    const counterTotal =
      (landA.counters.get(CounterType.PlusOnePlusOne) ?? 0) +
      (landB.counters.get(CounterType.PlusOnePlusOne) ?? 0);
    expect(counterTotal).toBe(1);
  });

  it("no-op when no controller-controlled lands are in play", () => {
    const game = mkGame();
    const sourceId = mkEntityId(6421);
    const source = mkEntity(game, 6421, mkSorceryPaper(), ALICE, ALICE, ZoneType.Stack);
    source.wasKicked = true;
    source.awakenAmount = 2;
    // Opponent's land — not eligible.
    const oppLand = mkEntity(game, 6422, mkLandPaper(), BOB, BOB, ZoneType.Battlefield);

    new AwakenKeywordHandler().activate(
      {
        keyword: "awaken",
        params: {
          amount: { kind: "literal", raw: "2" },
          cost: { kind: "literal", raw: "4 U" },
        },
      },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    let sawDecision = false;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision") sawDecision = true;
      next = gen.next();
    }
    expect(sawDecision).toBe(false);
    expect(oppLand.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(0);
    expect(oppLand.awakenAnimatedUntilEot).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// Cipher
// ---------------------------------------------------------------------

describe("Wave 61.E — Cipher target-pick migration", () => {
  it("confirmAction=true → chooseCard → stamps cipher link bidirectionally", () => {
    const game = mkGame();
    const sourceId = mkEntityId(6501);
    const source = mkEntity(game, 6501, mkSorceryPaper(), ALICE, ALICE, ZoneType.Stack);
    const allyA = mkEntity(game, 6502, mkCreaturePaper(), ALICE, ALICE, ZoneType.Battlefield);
    const allyB = mkEntity(game, 6503, mkCreaturePaper(), ALICE, ALICE, ZoneType.Battlefield);

    new CipherKeywordHandler().activate(
      { keyword: "cipher" },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    // First triggered ability is the cast trigger (encode); second is the
    // damage trigger (cast-copy on combat damage).
    const ta = source.triggeredAbilities[0];
    expect(ta).toBeDefined();
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    let sawConfirm = false;
    let sawChoose = false;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "confirmAction") {
        sawConfirm = true;
        next = gen.next({ kind: "confirmAction", confirmed: true });
      } else if (y.kind === "decision" && y.request?.kind === "chooseCard") {
        sawChoose = true;
        next = gen.next({ kind: "chooseCard", chosen: [allyB.id] });
      } else {
        next = gen.next();
      }
    }
    expect(sawConfirm).toBe(true);
    expect(sawChoose).toBe(true);
    expect(source.cipherEncodedOnId).toBe(allyB.id);
    expect(allyB.cipherEncodedHere).toBe(sourceId);
    expect(allyA.cipherEncodedHere).toBeUndefined();
  });

  it("confirmAction=false → no chooseCard, no encode link", () => {
    const game = mkGame();
    const sourceId = mkEntityId(6511);
    const source = mkEntity(game, 6511, mkSorceryPaper(), ALICE, ALICE, ZoneType.Stack);
    const ally = mkEntity(game, 6512, mkCreaturePaper(), ALICE, ALICE, ZoneType.Battlefield);

    new CipherKeywordHandler().activate(
      { keyword: "cipher" },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    let sawChoose = false;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "confirmAction") {
        next = gen.next({ kind: "confirmAction", confirmed: false });
      } else if (y.kind === "decision" && y.request?.kind === "chooseCard") {
        sawChoose = true;
        next = gen.next({ kind: "chooseCard", chosen: [ally.id] });
      } else {
        next = gen.next();
      }
    }
    expect(sawChoose).toBe(false);
    expect(source.cipherEncodedOnId).toBeUndefined();
    expect(ally.cipherEncodedHere).toBeUndefined();
  });

  it("falls back to first eligible when chooseCard response is invalid", () => {
    const game = mkGame();
    const sourceId = mkEntityId(6521);
    const source = mkEntity(game, 6521, mkSorceryPaper(), ALICE, ALICE, ZoneType.Stack);
    const allyA = mkEntity(game, 6522, mkCreaturePaper(), ALICE, ALICE, ZoneType.Battlefield);
    const allyB = mkEntity(game, 6523, mkCreaturePaper(), ALICE, ALICE, ZoneType.Battlefield);

    new CipherKeywordHandler().activate(
      { keyword: "cipher" },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "confirmAction") {
        next = gen.next({ kind: "confirmAction", confirmed: true });
      } else if (y.kind === "decision" && y.request?.kind === "chooseCard") {
        next = gen.next({ kind: "chooseCard", chosen: [mkEntityId(99999)] });
      } else {
        next = gen.next();
      }
    }
    // Exactly one ally should have been encoded onto.
    const stampedCount = [allyA, allyB].filter((c) => c.cipherEncodedHere === sourceId).length;
    expect(stampedCount).toBe(1);
    expect(source.cipherEncodedOnId).toBeDefined();
  });

  it("no-op when no controller creatures are in play", () => {
    const game = mkGame();
    const sourceId = mkEntityId(6531);
    const source = mkEntity(game, 6531, mkSorceryPaper(), ALICE, ALICE, ZoneType.Stack);
    // Opponent creature — not eligible.
    const oppCreature = mkEntity(game, 6532, mkCreaturePaper(), BOB, BOB, ZoneType.Battlefield);

    new CipherKeywordHandler().activate(
      { keyword: "cipher" },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    let sawDecision = false;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision") sawDecision = true;
      next = gen.next();
    }
    expect(sawDecision).toBe(false);
    expect(source.cipherEncodedOnId).toBeUndefined();
    expect(oppCreature.cipherEncodedHere).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// Bloodthirst — confirm self-stamp behaviour (no target pick).
// ---------------------------------------------------------------------

describe("Wave 61.E — Bloodthirst self-stamp (no migration needed)", () => {
  it("Bloodthirst handler does not yield any decision", async () => {
    // Bloodthirst's resolver is purely self-targeted: if any opponent
    // took damage this turn, +N/+N counters land on self. The handler
    // never yields a chooseCard / confirmAction, so the migration scope
    // for Wave 61.E excludes it. This test pins the contract.
    const { BloodthirstKeywordHandler } = await import("./bloodthirst-keyword.js");
    const game = mkGame();
    const sourceId = mkEntityId(6601);
    const source = mkEntity(game, 6601, mkCreaturePaper(), ALICE, ALICE, ZoneType.Battlefield);
    // Stamp the lifeLostThisTurn flag for Bob (the opponent) so the
    // Bloodthirst gate passes.
    game.flags.lifeLostThisTurn.set(BOB, 3);

    new BloodthirstKeywordHandler().activate(
      {
        keyword: "bloodthirst",
        params: { amount: { kind: "literal", raw: "2" } },
      },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    let sawDecision = false;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision") sawDecision = true;
      next = gen.next();
    }
    expect(sawDecision).toBe(false);
    // +2/+2 counters land on self (CR 702.53a).
    expect(source.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(2);
  });
});
