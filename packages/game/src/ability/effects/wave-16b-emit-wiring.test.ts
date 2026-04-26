// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 16b — engine-side emit wiring smoke tests. Each test synth-resolves an
// effect handler (or game-action mutator) that was wired in this wave and
// verifies the corresponding GameEvent appears in the yielded stream. Tests
// purposefully use the lightest fixture (synthetic SpellAbility + minimal
// Card setup) so they exercise ONLY the emit path, not the full resolver.
import "./tap-all.js";
import "./untap-all.js";
import "./wave-18-effects.js";
import "./wave-19-effects.js";
import type { LobbyPlayer, PaperCard, SVarAst } from "@mtg-forge-ts/core";
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

const collectEvents = (yields: unknown[]): { kind: string; payload: unknown }[] => {
  const events: { kind: string; payload: unknown }[] = [];
  for (const y of yields) {
    const yy = y as { kind?: string; event?: { kind: string; payload: unknown } };
    if (yy.kind === "event" && yy.event !== undefined) {
      events.push({ kind: yy.event.kind, payload: yy.event.payload });
    }
  }
  return events;
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

// ── TapAllEffect — emits CardsTappedAll ────────────────────────────────────
describe("TapAllEffect emit wiring", () => {
  it("emits CardsTappedAll with the tapped ids batch", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    // Source lives on the stack, NOT battlefield, so it doesn't match the
    // Permanent filter (mirroring real "Wrath" semantics — the spell itself
    // isn't on the battlefield when its effect resolves).
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Stack));
    const c1 = mkEntityId(20);
    const card1 = new Card(c1, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(c1, card1);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(c1);
    const sa = mkSa("TapAll", { ValidCards: { kind: "literal", raw: "Permanent.YouCtrl" } }, sourceId);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const events = collectEvents(yields);
    const batch = events.find((e) => e.kind === "CardsTappedAll");
    expect(batch).toBeDefined();
    const payload = batch?.payload as { cardIds: readonly number[] };
    expect(payload.cardIds).toEqual([c1]);
  });

  it("does NOT emit CardsTappedAll when nothing matched", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Stack));
    const sa = mkSa("TapAll", { ValidCards: { kind: "literal", raw: "Permanent.OpponentCtrl" } }, sourceId);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const events = collectEvents(yields);
    expect(events.find((e) => e.kind === "CardsTappedAll")).toBeUndefined();
  });
});

// ── UntapAllEffect — emits CardsUntappedAll ────────────────────────────────
describe("UntapAllEffect emit wiring", () => {
  it("emits CardsUntappedAll with the untapped ids batch", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Stack));
    const c1 = mkEntityId(20);
    const card1 = new Card(c1, paper, seat0, seat0, ZoneType.Battlefield);
    card1.tapped = true;
    game.cards.set(c1, card1);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(c1);
    const sa = mkSa("UntapAll", { ValidCards: { kind: "literal", raw: "Permanent.YouCtrl" } }, sourceId);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const events = collectEvents(yields);
    const batch = events.find((e) => e.kind === "CardsUntappedAll");
    expect(batch).toBeDefined();
    const payload = batch?.payload as { cardIds: readonly number[] };
    expect(payload.cardIds).toEqual([c1]);
  });
});

// ── AdvanceCrankEffect — emits CardCranked ─────────────────────────────────
describe("AdvanceCrankEffect emit wiring", () => {
  it("emits CardCranked with sa source + controller seat", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const sa = mkSa("AdvanceCrank", {}, sourceId);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const events = collectEvents(yields);
    const cranked = events.find((e) => e.kind === "CardCranked");
    expect(cranked).toBeDefined();
    const payload = cranked?.payload as { cardId: number; controllerSeat: number };
    expect(payload.cardId).toBe(sourceId);
    expect(payload.controllerSeat).toBe(seat0);
  });
});

// ── DiscoverEffect — emits CardDiscovered when a non-land is picked ────────
describe("DiscoverEffect emit wiring", () => {
  it("emits CardDiscovered when a non-land hits", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    const topId = mkEntityId(20);
    // Default Card has no Land type — counts as non-land.
    game.cards.set(topId, new Card(topId, paper, seat0, seat0, ZoneType.Library));
    lib?.add(topId);
    const sa = mkSa("Discover", { Num: { kind: "literal", raw: "3" } }, sourceId);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const events = collectEvents(yields);
    const disc = events.find((e) => e.kind === "CardDiscovered");
    expect(disc).toBeDefined();
    const payload = disc?.payload as {
      playerSeat: number;
      discoveredCardId: number;
      value: number;
    };
    expect(payload.playerSeat).toBe(seat0);
    expect(payload.discoveredCardId).toBe(topId);
    expect(payload.value).toBe(3);
  });
});

// ── InvestigateEffect — emits CardInvestigated per Clue minted ─────────────
describe("InvestigateEffect emit wiring", () => {
  it("emits CardInvestigated once per Clue token minted", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(10);
    game.cards.set(sourceId, new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield));
    const sa = mkSa("Investigate", { Num: { kind: "literal", raw: "2" } }, sourceId);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const events = collectEvents(yields);
    const investigated = events.filter((e) => e.kind === "CardInvestigated");
    expect(investigated.length).toBe(2);
    for (const e of investigated) {
      const payload = e.payload as { playerSeat: number; clueTokenId: number };
      expect(payload.playerSeat).toBe(seat0);
      expect(typeof payload.clueTokenId).toBe("number");
    }
  });
});

// ── changeLife — emits LifeLost when delta < 0 ─────────────────────────────
describe("changeLife emit wiring", () => {
  it("emits LifeLost with the absolute amount when delta is negative", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const yields = drainGen(
      game.action.changeLife(seat0, -3, { cause: "effect" }) as Generator<unknown, void, unknown>,
    );
    const events = collectEvents(yields);
    const loss = events.find((e) => e.kind === "LifeLost");
    expect(loss).toBeDefined();
    const payload = loss?.payload as { playerSeat: number; amount: number };
    expect(payload.playerSeat).toBe(seat0);
    expect(payload.amount).toBe(3);
  });

  it("does NOT emit LifeLost when delta >= 0", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const yields = drainGen(
      game.action.changeLife(seat0, 4, { cause: "effect" }) as Generator<unknown, void, unknown>,
    );
    const events = collectEvents(yields);
    expect(events.find((e) => e.kind === "LifeLost")).toBeUndefined();
  });
});
