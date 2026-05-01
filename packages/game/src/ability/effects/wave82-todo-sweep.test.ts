// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 82 — Effect handler TODO sweep round 3.
//
// Closes inline TODO(advanced) tails on six effect handlers:
//   * wave-22:Poison         — write the canonical
//     `player.counters.get(CounterType.Poison)` slot so the SBA loss-
//     condition checker (sba/loss-conditions.ts) sees the count and the
//     player loses at the canonical 10-poison threshold.
//   * wave-22:Unattach       — route through `game.action.unattach` so
//     the replacement chain runs AND auraGrantLedger.onUnattach removes
//     the per-attachment Layer 6 grants. Replaces direct `attachedTo =
//     null` mutation.
//   * wave-19:Goad           — track goader seat on `card.goaderSeats`
//     so the "must attack a player other than the goader" rule
//     (CR 701.42b) has the data it needs at combat declaration. The
//     slot admits multiple goaders.
//   * wave-18:TapOrUntap     — yield typed `confirmAction` decision so
//     the controller picks tap-vs-untap independently per target.
//     Toggle fallback (tap if untapped / untap if tapped) on missing
//     response preserves prior MVP determinism.
//   * wave-18:ChooseDirection — yield typed `chooseDirection` decision;
//     normalize the response's "left" | "right" to "Left" | "Right"
//     for `Card.chosenDirection` back-compat.
//   * wave-22:Detain         — wires `detainedUntilTurn` into the
//     combat-declaration gate (`canAttack` + `canBlock` in
//     statics/wave65-combat-gates.ts). Detained creatures are rejected
//     as attackers and as blockers until the affected controller's
//     next turn opens.
import "./index.js";
import { parseCard } from "@mtg-forge-ts/cards";
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
import { canAttack, canBlock } from "../../statics/wave65-combat-gates.js";
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
  cardDataSyncedAt: "2026-04-26T00:00:00Z",
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

const creaturePaper = (name: string): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(
    `${[`Name:${name}`, "ManaCost:1 G", "Types:Creature Elf", "PT:1/1", "Oracle:Test"].join("\n")}\n`,
    `${name}.txt`,
  ),
});

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
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

const seedSourceCard = (game: Game, sourceId = mkEntityId(10)): Card => {
  const seat0 = mkPlayerSeat(0);
  const c = new Card(sourceId, plainPaper, seat0, seat0, ZoneType.Battlefield);
  game.cards.set(sourceId, c);
  const bf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);
  bf?.add(sourceId);
  return c;
};

const seedCardOnZone = (
  game: Game,
  paper: PaperCard,
  zone: ZoneType,
  seat = mkPlayerSeat(0),
  id = mkEntityId(20),
): Card => {
  const c = new Card(id, paper, seat, seat, zone);
  game.cards.set(id, c);
  const z = game.getPlayer(seat).zones.get(zone);
  z?.add(id);
  return c;
};

// ---------------------------------------------------------------------------
// (1) PoisonEffect — writes canonical CounterType.Poison slot
// ---------------------------------------------------------------------------

describe("Wave 82 — Poison: writes canonical CounterType.Poison slot", () => {
  it("bumps player.counters.get(CounterType.Poison) so the SBA threshold sees the value", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(1000));
    const sa = mkSa(
      "Poison",
      {
        Defined: { kind: "literal", raw: "Opponent" },
        Num: { kind: "literal", raw: "3" },
      },
      mkEntityId(1000),
      mkPlayerSeat(0),
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const target = game.getPlayer(mkPlayerSeat(1));
    expect(target.counters.get(CounterType.Poison)).toBe(3);
    // Legacy slot still in sync for back-compat readers.
    expect((target as unknown as { poisonCounters?: number }).poisonCounters).toBe(3);
  });

  it("repeated Poison bumps stack canonically and back-compat slot", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(1010));
    const seat = mkPlayerSeat(1);
    // Pre-seed an existing poison count on the canonical slot.
    game.getPlayer(seat).counters.set(CounterType.Poison, 4);
    const sa = mkSa(
      "Poison",
      {
        Defined: { kind: "literal", raw: "Opponent" },
        Num: { kind: "literal", raw: "2" },
      },
      mkEntityId(1010),
      mkPlayerSeat(0),
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.getPlayer(seat).counters.get(CounterType.Poison)).toBe(6);
  });

  it("emits PlayerPoisoned event with the bumped amount", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(1020));
    const sa = mkSa(
      "Poison",
      {
        Defined: { kind: "literal", raw: "Opponent" },
        Num: { kind: "literal", raw: "1" },
      },
      mkEntityId(1020),
      mkPlayerSeat(0),
    );
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const poisoned = yields
      .filter((y) => (y as { event?: { kind: string } }).event?.kind === "PlayerPoisoned")
      .map((y) => (y as { event: { payload: { amount: number } } }).event.payload);
    expect(poisoned.length).toBe(1);
    expect(poisoned[0]?.amount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (2) UnattachEffect — routes through game.action.unattach
// ---------------------------------------------------------------------------

describe("Wave 82 — Unattach: routes through game.action.unattach", () => {
  it("clears attachedTo and emits CardUnattached on a fake-attached source", () => {
    const game = mkGame();
    const source = seedSourceCard(game, mkEntityId(1100));
    // Fake an attachment relationship — the action.unattach handler tolerates
    // a missing target card (the early-out only checks attachedTo !== null).
    (source as unknown as { attachedTo?: number | null }).attachedTo = mkEntityId(9999);
    const sa = mkSa("Unattach", {}, mkEntityId(1100), mkPlayerSeat(0));
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect((source as unknown as { attachedTo?: number | null }).attachedTo).toBeNull();
    const unattached = yields.filter(
      (y) => (y as { event?: { kind: string } }).event?.kind === "CardUnattached",
    );
    expect(unattached.length).toBeGreaterThanOrEqual(1);
  });

  it("noop when source is not attached — no event, no state change", () => {
    const game = mkGame();
    const source = seedSourceCard(game, mkEntityId(1110));
    // Default: attachedTo is null.
    const sa = mkSa("Unattach", {}, mkEntityId(1110), mkPlayerSeat(0));
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(source.attachedTo).toBeNull();
    const unattached = yields.filter(
      (y) => (y as { event?: { kind: string } }).event?.kind === "CardUnattached",
    );
    expect(unattached.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (3) GoadEffect — tracks goader seat on card.goaderSeats
// ---------------------------------------------------------------------------

describe("Wave 82 — Goad: tracks goader seat on card.goaderSeats", () => {
  it("first Goad stamps a single-seat goaderSeats set", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    seedSourceCard(game, mkEntityId(1200));
    const target = seedCardOnZone(
      game,
      creaturePaper("Tgt"),
      ZoneType.Battlefield,
      mkPlayerSeat(1),
      mkEntityId(1201),
    );
    const sa = mkSa("Goad", {}, mkEntityId(1200), seat, [target.id]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(target.goaded).toBe(true);
    const seats = (target as unknown as { goaderSeats?: Set<unknown> }).goaderSeats;
    expect(seats?.size).toBe(1);
    expect(seats?.has(seat)).toBe(true);
  });

  it("Goad from a second seat appends to the goaderSeats set", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    seedSourceCard(game, mkEntityId(1210));
    const target = seedCardOnZone(game, creaturePaper("Tgt"), ZoneType.Battlefield, seat1, mkEntityId(1211));
    drainGen(
      mkSa("Goad", {}, mkEntityId(1210), seat0, [target.id]).makeResolver().resolve(game) as Generator<
        unknown,
        void,
        unknown
      >,
    );
    drainGen(
      mkSa("Goad", {}, mkEntityId(1210), seat1, [target.id]).makeResolver().resolve(game) as Generator<
        unknown,
        void,
        unknown
      >,
    );
    const seats = (target as unknown as { goaderSeats?: Set<unknown> }).goaderSeats;
    expect(seats?.size).toBe(2);
    expect(seats?.has(seat0)).toBe(true);
    expect(seats?.has(seat1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (4) TapOrUntapEffect — yields confirmAction decision
// ---------------------------------------------------------------------------

describe("Wave 82 — TapOrUntap: yields confirmAction decision", () => {
  it("yields confirmAction; controller's confirmed=true taps an untapped target", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    seedSourceCard(game, mkEntityId(1300));
    const target = seedCardOnZone(game, creaturePaper("Tgt"), ZoneType.Battlefield, seat, mkEntityId(1301));
    expect(target.tapped).toBe(false);
    const sa = mkSa("TapOrUntap", {}, mkEntityId(1300), seat, [target.id]);
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    const r = gen.next();
    expect(r.done).toBe(false);
    const decision = r.value as { kind: string; request: { kind: string; prompt: string } };
    expect(decision.kind).toBe("decision");
    expect(decision.request.kind).toBe("confirmAction");
    let r2 = gen.next({ kind: "confirmAction", confirmed: true });
    while (!r2.done) r2 = gen.next();
    expect(target.tapped).toBe(true);
  });

  it("controller's confirmed=false untaps a tapped target", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    seedSourceCard(game, mkEntityId(1310));
    const target = seedCardOnZone(game, creaturePaper("Tgt"), ZoneType.Battlefield, seat, mkEntityId(1311));
    target.tapped = true;
    const sa = mkSa("TapOrUntap", {}, mkEntityId(1310), seat, [target.id]);
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    while (!r.done) {
      if ((r.value as { kind?: string }).kind === "decision") {
        r = gen.next({ kind: "confirmAction", confirmed: false });
      } else {
        r = gen.next();
      }
    }
    expect(target.tapped).toBe(false);
  });

  it("falls back to toggle when no response is supplied", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    seedSourceCard(game, mkEntityId(1320));
    const target = seedCardOnZone(game, creaturePaper("Tgt"), ZoneType.Battlefield, seat, mkEntityId(1321));
    expect(target.tapped).toBe(false);
    const sa = mkSa("TapOrUntap", {}, mkEntityId(1320), seat, [target.id]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    // Drain-without-driver → toggle path: untapped → tap.
    expect(target.tapped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (5) ChooseDirectionEffect — yields chooseDirection decision
// ---------------------------------------------------------------------------

describe("Wave 82 — ChooseDirection: yields chooseDirection decision", () => {
  it("yields chooseDirection and stamps Right when controller picks 'right'", () => {
    const game = mkGame();
    const source = seedSourceCard(game, mkEntityId(1400));
    const sa = mkSa("ChooseDirection", {}, mkEntityId(1400), mkPlayerSeat(0));
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    const r = gen.next();
    expect(r.done).toBe(false);
    const decision = r.value as { kind: string; request: { kind: string; playerSeat: unknown } };
    expect(decision.kind).toBe("decision");
    expect(decision.request.kind).toBe("chooseDirection");
    let r2 = gen.next({ kind: "chooseDirection", direction: "right" });
    while (!r2.done) r2 = gen.next();
    expect(source.chosenDirection).toBe("Right");
  });

  it("falls back to Left on missing response (drain-without-driver)", () => {
    const game = mkGame();
    const source = seedSourceCard(game, mkEntityId(1410));
    const sa = mkSa("ChooseDirection", {}, mkEntityId(1410), mkPlayerSeat(0));
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(source.chosenDirection).toBe("Left");
  });
});

// ---------------------------------------------------------------------------
// (6) DetainEffect — wires detainedUntilTurn into combat-declaration gate
// ---------------------------------------------------------------------------

describe("Wave 82 — Detain: wires detainedUntilTurn into combat gate", () => {
  it("canAttack rejects a detained creature until the next turn", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    seedSourceCard(game, mkEntityId(1500));
    const target = seedCardOnZone(
      game,
      creaturePaper("Tgt"),
      ZoneType.Battlefield,
      mkPlayerSeat(1),
      mkEntityId(1501),
    );
    expect(canAttack(game, target.id)).toBe(true);
    const sa = mkSa("Detain", {}, mkEntityId(1500), seat, [target.id]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(target.tapped).toBe(true);
    expect(canAttack(game, target.id)).toBe(false);
    // Advance turn — gate releases.
    game.turn += 1;
    expect(canAttack(game, target.id)).toBe(true);
  });

  it("canBlock rejects a detained creature until the next turn", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    seedSourceCard(game, mkEntityId(1510));
    const target = seedCardOnZone(
      game,
      creaturePaper("Tgt"),
      ZoneType.Battlefield,
      mkPlayerSeat(1),
      mkEntityId(1511),
    );
    expect(canBlock(game, target.id)).toBe(true);
    const sa = mkSa("Detain", {}, mkEntityId(1510), seat, [target.id]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(canBlock(game, target.id)).toBe(false);
    game.turn += 1;
    expect(canBlock(game, target.id)).toBe(true);
  });
});
