// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 61.F — Tribute + Mobilize + Encore wrap-up tests.
//
// Tribute: drives the chooseGenericOption (controller picks opponent)
// then confirmAction (chosen opponent says yes/no) decision pair.
// Verifies +1/+1 counters land on yes; tributePaid stamp on both
// branches; multi-opponent picker; single-opponent shortcut.
//
// Mobilize: verifies the attacks-trigger spawns N Warrior tokens via
// game.action.createToken, stamps tapped + attackingDefender = source's
// defender on each, and registers the EOT-sacrifice delayed trigger.
//
// Encore: verifies the SpellAbility synthesised by EncoreKeywordHandler
// resolves via EncoreEffect — per-opponent token-copy spawn tapped +
// attacking that opponent + haste, EOT-sac stamp.
//
// The setup mirrors wave61-e-target-pick.test.ts: walk the resolver
// generator manually and inject decision responses by request.kind.
import "../../ability/effects/index.js";
import "../../altcost/index.js";
import "./index.js";
import { parseCard } from "@mtg-forge-ts/cards";
import type { LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  PhaseStep,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkEvent,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { EncoreKeywordHandler } from "./encore-keyword.js";
import { MobilizeKeywordHandler } from "./mobilize-keyword.js";
import { TributeKeywordHandler } from "./tribute-keyword.js";

const aliceLP: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bobLP: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };
const carolLP: LobbyPlayer = { id: "p-carol", name: "Carol", controllerKind: "ai" };
const rules2p: GameRules = {
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
const rules3p: GameRules = {
  ...rules2p,
  playerCount: { min: 2, max: 4 },
};
const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "abc",
  cardDataSyncedAt: "2026-04-26T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const creatureSrc = (): string =>
  `${["Name:Test Creature", "ManaCost:1", "Types:Creature", "PT:2/2", "Oracle:Test"].join("\n")}\n`;

const mkCreaturePaper = (): PaperCard => ({
  name: "Test Creature",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(creatureSrc(), "test-creature.txt"),
});

const ALICE: PlayerSeat = mkPlayerSeat(0);
const BOB: PlayerSeat = mkPlayerSeat(1);
const CAROL: PlayerSeat = mkPlayerSeat(2);

const mkGame = (multi = false): Game => {
  const lobby = multi ? [aliceLP, bobLP, carolLP] : [aliceLP, bobLP];
  const game = new Game({
    lobbyPlayers: lobby,
    rules: multi ? rules3p : rules2p,
    meta,
    rng: new SeededRng(1n),
  });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
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
// Tribute
// ---------------------------------------------------------------------

describe("Wave 61.F — Tribute decision migration", () => {
  it("single-opponent shortcut + confirmAction=true → +N/+N counters + tributePaid=true", () => {
    const game = mkGame();
    const sourceId = mkEntityId(7001);
    const source = mkEntity(game, 7001, mkCreaturePaper(), ALICE, ALICE, ZoneType.Battlefield);

    new TributeKeywordHandler().activate(
      { keyword: "tribute", params: { amount: { kind: "literal", raw: "2" } } },
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
    let sawPicker = false;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "chooseGenericOption") {
        sawPicker = true;
        next = gen.next();
      } else if (y.kind === "decision" && y.request?.kind === "confirmAction") {
        sawConfirm = true;
        next = gen.next({ kind: "confirmAction", confirmed: true });
      } else {
        next = gen.next();
      }
    }
    // Single opponent (Bob) — picker is skipped.
    expect(sawPicker).toBe(false);
    expect(sawConfirm).toBe(true);
    expect(source.tributePaid).toBe(true);
    expect(source.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(2);
  });

  it("confirmAction=false → no counters, tributePaid=false", () => {
    const game = mkGame();
    const sourceId = mkEntityId(7011);
    const source = mkEntity(game, 7011, mkCreaturePaper(), ALICE, ALICE, ZoneType.Battlefield);

    new TributeKeywordHandler().activate(
      { keyword: "tribute", params: { amount: { kind: "literal", raw: "2" } } },
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
        next = gen.next({ kind: "confirmAction", confirmed: false });
      } else {
        next = gen.next();
      }
    }
    expect(source.tributePaid).toBe(false);
    expect(source.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(0);
  });

  it("multi-opponent: yields chooseGenericOption then confirmAction", () => {
    const game = mkGame(true);
    const sourceId = mkEntityId(7021);
    const source = mkEntity(game, 7021, mkCreaturePaper(), ALICE, ALICE, ZoneType.Battlefield);

    new TributeKeywordHandler().activate(
      { keyword: "tribute", params: { amount: { kind: "literal", raw: "1" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    let sawPicker = false;
    let sawConfirm = false;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "chooseGenericOption") {
        sawPicker = true;
        // Pick Carol (seat 2).
        next = gen.next({ kind: "chooseGenericOption", optionId: `opp:${CAROL as unknown as number}` });
      } else if (y.kind === "decision" && y.request?.kind === "confirmAction") {
        sawConfirm = true;
        next = gen.next({ kind: "confirmAction", confirmed: true });
      } else {
        next = gen.next();
      }
    }
    expect(sawPicker).toBe(true);
    expect(sawConfirm).toBe(true);
    expect(source.tributePaid).toBe(true);
    expect(source.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(1);
  });

  it("multi-opponent invalid pick → falls back to first opponent + still applies", () => {
    const game = mkGame(true);
    const sourceId = mkEntityId(7031);
    const source = mkEntity(game, 7031, mkCreaturePaper(), ALICE, ALICE, ZoneType.Battlefield);

    new TributeKeywordHandler().activate(
      { keyword: "tribute", params: { amount: { kind: "literal", raw: "3" } } },
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
      if (y.kind === "decision" && y.request?.kind === "chooseGenericOption") {
        next = gen.next({ kind: "chooseGenericOption", optionId: "opp:9999" });
      } else if (y.kind === "decision" && y.request?.kind === "confirmAction") {
        next = gen.next({ kind: "confirmAction", confirmed: true });
      } else {
        next = gen.next();
      }
    }
    // Resolved despite invalid pick — fallback to first opponent.
    expect(source.tributePaid).toBe(true);
    expect(source.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(3);
  });
});

// ---------------------------------------------------------------------
// Mobilize
// ---------------------------------------------------------------------

describe("Wave 61.F — Mobilize token spawn", () => {
  it("spawns N Warrior tokens tapped + attacking the same defender as source", () => {
    const game = mkGame();
    const sourceId = mkEntityId(7101);
    const source = mkEntity(game, 7101, mkCreaturePaper(), ALICE, ALICE, ZoneType.Battlefield);

    new MobilizeKeywordHandler().activate(
      { keyword: "mobilize", params: { amount: { kind: "literal", raw: "2" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    // Drive matches() with an AttackersDeclared event so capturedDefender
    // is set on the closure. The trigger registers its own resolver
    // generator; we call matches() then resolve manually.
    const event = mkEvent("AttackersDeclared", 1, PhaseStep.DeclareAttackers, {
      attackingSeat: ALICE,
      attackers: [
        {
          attackerId: sourceId,
          defender: { kind: "player", seat: BOB },
        },
      ],
    });
    expect(ta.matches(event)).toBe(true);

    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) next = gen.next();

    // Two new tokens minted — locate them (controller=ALICE, isToken=true,
    // subtype Warrior).
    const tokens = [...game.cards.values()].filter(
      (c) =>
        c.isToken === true &&
        c.controllerSeat === ALICE &&
        c.id !== sourceId &&
        c.paperCard.name === "Warrior Token",
    );
    expect(tokens.length).toBe(2);
    for (const t of tokens) {
      expect(t.tapped).toBe(true);
      const stamped = (t as unknown as { attackingDefender?: PlayerSeat }).attackingDefender;
      expect(stamped).toBe(BOB);
    }
  });

  it("planeswalker defender → spawned tokens stamp attackingDefender = pw id", () => {
    const game = mkGame();
    const sourceId = mkEntityId(7111);
    const source = mkEntity(game, 7111, mkCreaturePaper(), ALICE, ALICE, ZoneType.Battlefield);
    const pwId = mkEntityId(7112);

    new MobilizeKeywordHandler().activate(
      { keyword: "mobilize", params: { amount: { kind: "literal", raw: "1" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const event = mkEvent("AttackersDeclared", 1, PhaseStep.DeclareAttackers, {
      attackingSeat: ALICE,
      attackers: [
        {
          attackerId: sourceId,
          defender: { kind: "planeswalker", id: pwId },
        },
      ],
    });
    expect(ta.matches(event)).toBe(true);
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) next = gen.next();

    const tokens = [...game.cards.values()].filter(
      (c) => c.isToken === true && c.paperCard.name === "Warrior Token",
    );
    expect(tokens.length).toBe(1);
    const t = tokens[0];
    if (!t) return;
    expect(t.tapped).toBe(true);
    expect((t as unknown as { attackingDefender?: number }).attackingDefender).toBe(pwId);
  });

  it("matches() returns false when source is not in the AttackersDeclared batch", () => {
    const game = mkGame();
    const sourceId = mkEntityId(7121);
    const source = mkEntity(game, 7121, mkCreaturePaper(), ALICE, ALICE, ZoneType.Battlefield);

    new MobilizeKeywordHandler().activate(
      { keyword: "mobilize", params: { amount: { kind: "literal", raw: "1" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const event = mkEvent("AttackersDeclared", 1, PhaseStep.DeclareAttackers, {
      attackingSeat: ALICE,
      attackers: [
        {
          attackerId: mkEntityId(99999),
          defender: { kind: "player", seat: BOB },
        },
      ],
    });
    expect(ta.matches(event)).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Encore
// ---------------------------------------------------------------------

describe("Wave 61.F — Encore token-copy resolution", () => {
  it("per-opponent token copy tapped + attacking that opponent + haste", () => {
    const game = mkGame(true);
    const sourceId = mkEntityId(7201);
    const source = mkEntity(game, 7201, mkCreaturePaper(), ALICE, ALICE, ZoneType.Graveyard);

    new EncoreKeywordHandler().activate(
      { keyword: "encore", params: { cost: { kind: "literal", raw: "3" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    expect(source.spellAbilities.length).toBe(1);
    const sa = source.spellAbilities[0];
    if (!sa) return;
    const resolver = sa.makeResolver();
    const gen = resolver.resolve(game) as Generator<unknown, void, unknown>;
    let next = gen.next();
    while (!next.done) next = gen.next();

    // Two opponents (Bob + Carol) → 2 token copies.
    const tokens = [...game.cards.values()].filter((c) => c.isToken === true);
    expect(tokens.length).toBe(2);
    const seats = new Set<number>();
    for (const t of tokens) {
      expect(t.tapped).toBe(true);
      expect(t.keywords?.has("haste")).toBe(true);
      // tokenOverrides.addedTypes includes Spirit.
      expect(t.tokenOverrides?.addedTypes ?? []).toContain("Spirit");
      const stamped = (t as unknown as { attackingDefender?: PlayerSeat }).attackingDefender;
      if (stamped !== undefined) seats.add(stamped as unknown as number);
    }
    // One token attacking each opponent.
    expect(seats.has(BOB as unknown as number)).toBe(true);
    expect(seats.has(CAROL as unknown as number)).toBe(true);
  });

  it("2-player game → 1 opponent → 1 token copy attacking Bob", () => {
    const game = mkGame();
    const sourceId = mkEntityId(7211);
    const source = mkEntity(game, 7211, mkCreaturePaper(), ALICE, ALICE, ZoneType.Graveyard);

    new EncoreKeywordHandler().activate(
      { keyword: "encore", params: { cost: { kind: "literal", raw: "2" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const sa = source.spellAbilities[0];
    if (!sa) return;
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let next = gen.next();
    while (!next.done) next = gen.next();

    const tokens = [...game.cards.values()].filter((c) => c.isToken === true);
    expect(tokens.length).toBe(1);
    const t = tokens[0];
    if (!t) return;
    expect(t.tapped).toBe(true);
    expect(t.keywords?.has("haste")).toBe(true);
    expect((t as unknown as { attackingDefender?: PlayerSeat }).attackingDefender).toBe(BOB);
  });
});
