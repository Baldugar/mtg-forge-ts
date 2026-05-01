// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 114 — Final effect TODO closures.
//
// Closes the following inline TODO(advanced) tails on effect handlers:
//   * wave-22:Detain — activated-ability gating (CR 701.32). The
//     activate orchestrator now refuses any non-mana ability on a
//     detained source while `game.turn < card.detainedUntilTurn`.
//   * wave-22:RestartGame — emits the dedicated GameRestartRequested
//     event kind (was riding SubgameStarted as a placeholder).
//   * wave-21:ControlPlayer — emits the dedicated PlayerControlled
//     event when the takeover lands.
//   * wave-22:Endure — synthesized N/N Spirit token now carries the
//     bands_with_other keyword on its definition.
//   * wave-18:Balance — supports `HandZone$ False` to skip the hand-
//     discard step (per-zone restriction Forge supports).
import "./index.js";
import "../../cost/parts/index.js";
import type { LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  CardType,
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  IllegalDecisionError,
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
  cardDataSyncedAt: "2026-04-30T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};
const plainPaper: PaperCard = {
  name: "Test",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (seed = 1n): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(seed) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, p.seat));
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

const drainEvents = (gen: Generator<unknown, void, unknown>): string[] => {
  const events: string[] = [];
  let step = gen.next();
  while (!step.done) {
    const y = step.value as { kind?: string; event?: { kind?: string } };
    if (y.kind === "event" && y.event?.kind) events.push(y.event.kind);
    step = gen.next();
  }
  return events;
};

const mkSa = (
  handlerKey: string,
  params: Record<string, { kind: string; raw: string }>,
  sourceId = mkEntityId(10),
  controllerSeat = mkPlayerSeat(0),
  targets: ReturnType<typeof mkEntityId>[] = [],
) =>
  new SpellAbility(
    {
      kind: "spell",
      effect: { handlerKey, params: params as never },
      cost: { raw: "" },
    },
    sourceId,
    controllerSeat,
    new Map(),
    targets,
  );

const seedSourceCard = (
  game: Game,
  sourceId = mkEntityId(10),
  seat: PlayerSeat = mkPlayerSeat(0),
  paper: PaperCard = plainPaper,
): Card => {
  const c = new Card(sourceId, paper, seat, seat, ZoneType.Battlefield);
  game.cards.set(sourceId, c);
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  bf?.add(sourceId);
  return c;
};

// ---------------------------------------------------------------------------
// (1) Detain — activated-ability gating
// ---------------------------------------------------------------------------

describe("Wave 114 — Detain activated-ability gating", () => {
  // Build a non-mana ability AST for SP$ Pump (placeholder: any non-Mana
  // handler key works to exercise the gate).
  const makeNonManaAbilityAst = () => ({
    kind: "spell" as const,
    effect: {
      handlerKey: "Pump",
      params: {} as never,
    },
    cost: { raw: "" },
  });

  const makeManaAbilityAst = () => ({
    kind: "spell" as const,
    effect: {
      handlerKey: "Mana",
      params: { Produced: { kind: "literal" as const, raw: "G" } } as never,
    },
    cost: { raw: "" },
  });

  it("rejects non-mana activation when card is detained", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(2000);
    const card = seedSourceCard(game, cardId, seat);
    card.spellAbilities = [new SpellAbility(makeNonManaAbilityAst(), cardId, seat, new Map())];
    // Stamp Detain flag
    (card as { detainedUntilTurn?: number }).detainedUntilTurn = game.turn + 1;
    const gen = game.action.activateAbility(cardId, 0, seat) as Generator<unknown, unknown, unknown>;
    expect(() => {
      let step = gen.next();
      while (!step.done) step = gen.next();
    }).toThrow(IllegalDecisionError);
  });

  it("permits mana ability activation even when card is detained", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(2010);
    const card = seedSourceCard(game, cardId, seat);
    card.spellAbilities = [new SpellAbility(makeManaAbilityAst(), cardId, seat, new Map())];
    (card as { detainedUntilTurn?: number }).detainedUntilTurn = game.turn + 1;
    // No throw — drains successfully.
    const gen = game.action.activateAbility(cardId, 0, seat) as Generator<unknown, unknown, unknown>;
    let step = gen.next();
    while (!step.done) step = gen.next();
    // The ability landed on the stack.
    expect(game.sharedZones.stack.size).toBe(1);
  });

  it("permits non-mana activation once the detain window has passed", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const cardId = mkEntityId(2020);
    const card = seedSourceCard(game, cardId, seat);
    card.spellAbilities = [new SpellAbility(makeNonManaAbilityAst(), cardId, seat, new Map())];
    // Window already in the past.
    (card as { detainedUntilTurn?: number }).detainedUntilTurn = game.turn;
    const gen = game.action.activateAbility(cardId, 0, seat) as Generator<unknown, unknown, unknown>;
    // Drains without throwing.
    let step = gen.next();
    while (!step.done) step = gen.next();
    expect(game.sharedZones.stack.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (2) RestartGame — emits dedicated GameRestartRequested event
// ---------------------------------------------------------------------------

describe("Wave 114 — RestartGame emits GameRestartRequested", () => {
  it("emits the dedicated GameRestartRequested kind (replacing the SubgameStarted ride)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    seedSourceCard(game);
    const sa = mkSa("RestartGame", {}, mkEntityId(10), seat);
    const events = drainEvents(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(events).toContain("GameRestartRequested");
    // The legacy ride should NOT be emitted any more.
    expect(events).not.toContain("SubgameStarted");
  });

  it("stamps the requesting-seat flag for downstream observers", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    seedSourceCard(game);
    const sa = mkSa("RestartGame", {}, mkEntityId(10), seat);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect((game.flags as unknown as { restartRequested?: boolean }).restartRequested).toBe(true);
    expect((game.flags as unknown as { restartRequestedBy?: PlayerSeat }).restartRequestedBy).toBe(seat);
  });
});

// ---------------------------------------------------------------------------
// (3) ControlPlayer — emits PlayerControlled event
// ---------------------------------------------------------------------------

describe("Wave 114 — ControlPlayer emits PlayerControlled", () => {
  it("emits PlayerControlled with the controlled and controller seats", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    seedSourceCard(game);
    const sa = mkSa("ControlPlayer", {}, mkEntityId(10), seat);
    const events = drainEvents(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(events).toContain("PlayerControlled");
  });

  it("stamps controlledByOnNextTurn on the target player", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const opponent = mkPlayerSeat(1);
    seedSourceCard(game);
    const sa = mkSa("ControlPlayer", {}, mkEntityId(10), seat);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const target = game.getPlayer(opponent);
    expect((target as { controlledByOnNextTurn?: PlayerSeat }).controlledByOnNextTurn).toBe(seat);
  });
});

// ---------------------------------------------------------------------------
// (4) Endure — token mode synthesizes Spirit with bands_with_other keyword
// ---------------------------------------------------------------------------

describe("Wave 114 — Endure token mode carries bands_with_other keyword", () => {
  it("creates an N/N Spirit token whose definition.keywords includes bands_with_other", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    seedSourceCard(game);
    const sa = mkSa("Endure", { Num: { kind: "literal", raw: "3" } }, mkEntityId(10), seat);
    // Drive the chooseEndureOption decision toward "token".
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    while (!r.done) {
      const y = r.value as { kind?: string; request?: { kind?: string } };
      if (y.kind === "decision" && y.request?.kind === "chooseEndureOption") {
        r = gen.next({ kind: "chooseEndureOption", option: "token" });
      } else {
        r = gen.next();
      }
    }
    // Walk all cards to find the Endure-synthesized Spirit token (most-
    // recently-added card with name "Spirit").
    const spirits: Card[] = [];
    for (const c of game.cards.values()) {
      if (c.paperCard?.name === "Spirit") spirits.push(c);
    }
    expect(spirits.length).toBeGreaterThan(0);
    const spirit = spirits[spirits.length - 1];
    if (!spirit) throw new Error("test: no Spirit token found");
    const def = spirit.paperCard?.definition;
    expect(def?.keywords).toBeDefined();
    const kws = (def?.keywords ?? []) as readonly { readonly keyword: string }[];
    const hasBands = kws.some((k) => k.keyword === "bands_with_other");
    expect(hasBands).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (5) Balance — HandZone$ False skips the hand step
// ---------------------------------------------------------------------------

describe("Wave 114 — Balance HandZone$ False skips hand discard", () => {
  // Helper: mint a card directly into a hand zone.
  const addToHand = (game: Game, id: ReturnType<typeof mkEntityId>, seat: PlayerSeat) => {
    const c = new Card(id, plainPaper, seat, seat, ZoneType.Hand);
    game.cards.set(id, c);
    game.getPlayer(seat).zones.get(ZoneType.Hand)?.add(id);
  };

  it("HandZone$ False leaves both players' hands untouched", () => {
    const game = mkGame();
    const a = mkPlayerSeat(0);
    const b = mkPlayerSeat(1);
    seedSourceCard(game, mkEntityId(10), a);
    // Asymmetric hands: alice has 3 cards, bob has 0.
    addToHand(game, mkEntityId(3001), a);
    addToHand(game, mkEntityId(3002), a);
    addToHand(game, mkEntityId(3003), a);
    const sa = mkSa("Balance", { HandZone: { kind: "literal", raw: "False" } }, mkEntityId(10), a);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.getPlayer(a).zones.get(ZoneType.Hand)?.size).toBe(3);
    expect(game.getPlayer(b).zones.get(ZoneType.Hand)?.size).toBe(0);
  });

  it("default (HandZone omitted) still reduces both hands to the minimum", () => {
    const game = mkGame();
    const a = mkPlayerSeat(0);
    const b = mkPlayerSeat(1);
    seedSourceCard(game, mkEntityId(10), a);
    addToHand(game, mkEntityId(3101), a);
    addToHand(game, mkEntityId(3102), a);
    addToHand(game, mkEntityId(3103), a);
    const sa = mkSa("Balance", {}, mkEntityId(10), a);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.getPlayer(a).zones.get(ZoneType.Hand)?.size).toBe(0);
    expect(game.getPlayer(b).zones.get(ZoneType.Hand)?.size).toBe(0);
  });
});

// Reference values to silence "unused" warnings for TypeLine + ColorSet +
// CardType which are used by the Endure shape but not directly in the test.
void TypeLine;
void ColorSet;
void CardType;
