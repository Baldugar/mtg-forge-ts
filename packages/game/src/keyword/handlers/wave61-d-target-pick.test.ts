// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 61.D — interactive target-pick migrations for Mentor / Provoke /
// Backup. Each test drives the keyword's triggered-ability resolver
// generator, intercepting the chooseCard (and confirmAction, for
// Provoke) decision yields and returning a typed DecisionResponse.
// Coverage:
//   * happy path (responder picks a valid candidate; effect lands on it)
//   * invalid pick (response carries an id outside `pool`); resolver
//     falls back to first eligible.
//   * no-eligible-targets (resolver yields no decision; trigger no-ops).
//   * Provoke "you may" decline: confirmAction false → no chooseCard.
//
// The setup follows the wave55-keywords.test.ts driver pattern: walk
// the resolver generator manually, recognize the decision payloads by
// their nested request.kind, and inject a response on each yield.
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
import { BackupKeywordHandler } from "./backup-keyword.js";
import { MentorKeywordHandler } from "./mentor-keyword.js";
import { ProvokeKeywordHandler } from "./provoke-keyword.js";

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
// Forge-script source for a vanilla Creature with parameterised power, so
// layerEngine.computeCharacteristics reports CardType.Creature for test
// entities. Mentor's resolver compares attacker powers, so power is
// parameterised; the rest of Provoke / Backup don't depend on it.
const creatureSrc = (power: number): string =>
  `${["Name:Test Creature", "ManaCost:1", "Types:Creature", `PT:${power}/2`, "Oracle:Test"].join("\n")}\n`;

const mkPaper = (power = 2): PaperCard => ({
  name: "Test Creature",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(creatureSrc(power), "test-creature.txt"),
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

const mkCreature = (
  game: Game,
  id: number,
  ownerSeat: PlayerSeat,
  controllerSeat: PlayerSeat,
  zone: ZoneType,
  power = 2,
): Card => {
  const eid = mkEntityId(id);
  const c = new Card(eid, mkPaper(power), ownerSeat, controllerSeat, zone);
  game.cards.set(eid, c);
  game.getPlayer(controllerSeat).zones.get(zone)?.add(eid);
  return c;
};

interface YieldEnvelope {
  readonly kind?: string;
  readonly request?: { readonly kind?: string };
}

// ---------------------------------------------------------------------
// Mentor
// ---------------------------------------------------------------------

describe("Wave 61.D — Mentor target-pick migration", () => {
  it("yields chooseCard and applies the +1/+1 to the picked attacker", () => {
    const game = mkGame();
    const sourceId = mkEntityId(6101);
    const source = mkCreature(game, 6101, ALICE, ALICE, ZoneType.Battlefield, 4);
    (source as unknown as { attacking: boolean }).attacking = true;
    const lesserA = mkCreature(game, 6102, ALICE, ALICE, ZoneType.Battlefield, 1);
    const lesserB = mkCreature(game, 6103, ALICE, ALICE, ZoneType.Battlefield, 2);
    (lesserA as unknown as { attacking: boolean }).attacking = true;
    (lesserB as unknown as { attacking: boolean }).attacking = true;

    new MentorKeywordHandler().activate(
      { keyword: "mentor" },
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
        next = gen.next({ kind: "chooseCard", chosen: [lesserB.id] });
      } else {
        next = gen.next();
      }
    }
    expect(sawChoose).toBe(true);
    expect(lesserB.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(1);
    expect(lesserA.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(0);
  });

  it("falls back to first eligible when the response is invalid", () => {
    const game = mkGame();
    const sourceId = mkEntityId(6111);
    const source = mkCreature(game, 6111, ALICE, ALICE, ZoneType.Battlefield, 4);
    (source as unknown as { attacking: boolean }).attacking = true;
    const lesserA = mkCreature(game, 6112, ALICE, ALICE, ZoneType.Battlefield, 1);
    const lesserB = mkCreature(game, 6113, ALICE, ALICE, ZoneType.Battlefield, 2);
    (lesserA as unknown as { attacking: boolean }).attacking = true;
    (lesserB as unknown as { attacking: boolean }).attacking = true;

    new MentorKeywordHandler().activate(
      { keyword: "mentor" },
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
        // Invalid id (not in pool).
        next = gen.next({ kind: "chooseCard", chosen: [mkEntityId(99999)] });
      } else {
        next = gen.next();
      }
    }
    // Fallback first eligible — counter goes to whichever id was first
    // enumerated; assert exactly one of {A,B} has the counter.
    const totalCounters =
      (lesserA.counters.get(CounterType.PlusOnePlusOne) ?? 0) +
      (lesserB.counters.get(CounterType.PlusOnePlusOne) ?? 0);
    expect(totalCounters).toBe(1);
  });

  it("no-op when no attacking creature has lesser power", () => {
    const game = mkGame();
    const sourceId = mkEntityId(6121);
    const source = mkCreature(game, 6121, ALICE, ALICE, ZoneType.Battlefield, 1);
    (source as unknown as { attacking: boolean }).attacking = true;
    // Other attacker has GREATER power, so it isn't eligible.
    const greater = mkCreature(game, 6122, ALICE, ALICE, ZoneType.Battlefield, 4);
    (greater as unknown as { attacking: boolean }).attacking = true;

    new MentorKeywordHandler().activate(
      { keyword: "mentor" },
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
      if (y.kind === "decision" && y.request?.kind === "chooseCard") sawChoose = true;
      next = gen.next();
    }
    expect(sawChoose).toBe(false);
    expect(greater.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(0);
  });
});

// ---------------------------------------------------------------------
// Provoke
// ---------------------------------------------------------------------

describe("Wave 61.D — Provoke target-pick migration", () => {
  it("confirmAction=true → chooseCard → untaps + stamps mustBlockTargetId", () => {
    const game = mkGame();
    const sourceId = mkEntityId(6201);
    const source = mkCreature(game, 6201, ALICE, ALICE, ZoneType.Battlefield);
    const enemyA = mkCreature(game, 6202, BOB, BOB, ZoneType.Battlefield);
    const enemyB = mkCreature(game, 6203, BOB, BOB, ZoneType.Battlefield);
    enemyB.tapped = true;

    new ProvokeKeywordHandler().activate(
      { keyword: "provoke" },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
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
        next = gen.next({ kind: "chooseCard", chosen: [enemyB.id] });
      } else {
        next = gen.next();
      }
    }
    expect(sawConfirm).toBe(true);
    expect(sawChoose).toBe(true);
    expect(enemyB.tapped).toBe(false);
    expect(enemyB.mustBlockTargetId).toBe(sourceId);
    expect(enemyA.mustBlockTargetId).toBeNull();
  });

  it("confirmAction=false → no chooseCard, no effect", () => {
    const game = mkGame();
    const sourceId = mkEntityId(6211);
    const source = mkCreature(game, 6211, ALICE, ALICE, ZoneType.Battlefield);
    const enemy = mkCreature(game, 6212, BOB, BOB, ZoneType.Battlefield);
    enemy.tapped = true;

    new ProvokeKeywordHandler().activate(
      { keyword: "provoke" },
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
        next = gen.next({ kind: "chooseCard", chosen: [enemy.id] });
      } else {
        next = gen.next();
      }
    }
    expect(sawChoose).toBe(false);
    expect(enemy.tapped).toBe(true);
    expect(enemy.mustBlockTargetId).toBeNull();
  });

  it("falls back to first eligible when chooseCard response is invalid", () => {
    const game = mkGame();
    const sourceId = mkEntityId(6221);
    const source = mkCreature(game, 6221, ALICE, ALICE, ZoneType.Battlefield);
    const enemyA = mkCreature(game, 6222, BOB, BOB, ZoneType.Battlefield);
    const enemyB = mkCreature(game, 6223, BOB, BOB, ZoneType.Battlefield);
    enemyA.tapped = true;
    enemyB.tapped = true;

    new ProvokeKeywordHandler().activate(
      { keyword: "provoke" },
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
    // Exactly one enemy should have mustBlockTargetId stamped + been untapped.
    const stampedCount = [enemyA, enemyB].filter((c) => c.mustBlockTargetId === sourceId).length;
    expect(stampedCount).toBe(1);
  });

  it("no-op when no opponent creatures are in play", () => {
    const game = mkGame();
    const sourceId = mkEntityId(6231);
    const source = mkCreature(game, 6231, ALICE, ALICE, ZoneType.Battlefield);

    new ProvokeKeywordHandler().activate(
      { keyword: "provoke" },
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
  });
});

// ---------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------

describe("Wave 61.D — Backup target-pick migration", () => {
  it("yields chooseCard and applies N +1/+1 counters to the picked creature", () => {
    const game = mkGame();
    const sourceId = mkEntityId(6301);
    const source = mkCreature(game, 6301, ALICE, ALICE, ZoneType.Battlefield);
    const ally = mkCreature(game, 6302, ALICE, ALICE, ZoneType.Battlefield);

    new BackupKeywordHandler().activate(
      { keyword: "backup", params: { amount: { kind: "literal", raw: "2" } } },
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
      if (y.kind === "decision" && y.request?.kind === "chooseCard") {
        sawChoose = true;
        next = gen.next({ kind: "chooseCard", chosen: [ally.id] });
      } else {
        next = gen.next();
      }
    }
    expect(sawChoose).toBe(true);
    expect(ally.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(2);
    expect(source.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(0);
  });

  it("can target self when controller picks the source card", () => {
    const game = mkGame();
    const sourceId = mkEntityId(6311);
    const source = mkCreature(game, 6311, ALICE, ALICE, ZoneType.Battlefield);
    mkCreature(game, 6312, ALICE, ALICE, ZoneType.Battlefield);

    new BackupKeywordHandler().activate(
      { keyword: "backup", params: { amount: { kind: "literal", raw: "1" } } },
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
        next = gen.next({ kind: "chooseCard", chosen: [sourceId] });
      } else {
        next = gen.next();
      }
    }
    expect(source.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(1);
  });

  it("falls back to first eligible when response is invalid", () => {
    const game = mkGame();
    const sourceId = mkEntityId(6321);
    const source = mkCreature(game, 6321, ALICE, ALICE, ZoneType.Battlefield);
    const ally = mkCreature(game, 6322, ALICE, ALICE, ZoneType.Battlefield);

    new BackupKeywordHandler().activate(
      { keyword: "backup", params: { amount: { kind: "literal", raw: "1" } } },
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
    // Fallback first eligible — exactly one creature ends up with the
    // counter (whichever was enumerated first by `g.cards`).
    const totalCounters =
      (source.counters.get(CounterType.PlusOnePlusOne) ?? 0) +
      (ally.counters.get(CounterType.PlusOnePlusOne) ?? 0);
    expect(totalCounters).toBe(1);
  });

  it("no-op when no creatures are in play", () => {
    const game = mkGame();
    const sourceId = mkEntityId(6331);
    // Source card in hand (not yet on battlefield) — the resolver
    // enumerates Battlefield creatures only; with no battlefield
    // creatures, it must no-op.
    const c = new Card(sourceId, mkPaper(), ALICE, ALICE, ZoneType.Hand);
    game.cards.set(sourceId, c);

    new BackupKeywordHandler().activate(
      { keyword: "backup", params: { amount: { kind: "literal", raw: "1" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = c.triggeredAbilities[0];
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
  });
});
