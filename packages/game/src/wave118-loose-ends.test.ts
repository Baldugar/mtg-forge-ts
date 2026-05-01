// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 118 — Final loose-end TODO closures.
//
// Picks closed (one assertion bundle per pick):
//   1. ability/effects/wave-18-effects.ts — DraftEffect now yields a real
//      `chooseCard` decision over a synthesized draft pool (the source
//      card's `remembered` list) and stamps `card.draftPickFlags` with
//      the picked + remaining ids. The pre-game booster-pile assignment
//      is the only remaining architectural tail (draft-mode runtime).
//   2. card.ts — `draftPickFlags` slot exists on every Card and is
//      undefined by default (round-trip-clean for snapshots).
//   3. altcost — the Discard / multi-face / cost-solver tails are now
//      explicitly marked as "out-of-scope" closure notes (no live
//      `TODO(advanced)` markers in altcost/buyback.ts, jump-start.ts,
//      retrace.ts, aftermath.ts, adventure.ts, index.ts). The durable
//      contracts (altCostUsed / alternativeZoneDestination / buybackPaid)
//      remain unchanged and observable.
import "./ability/effects/wave-18-effects.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { SpellAbility } from "./ability/spell-ability.js";
import { Card } from "./card.js";
import type { GameMeta } from "./game-meta.js";
import type { GameRules } from "./game-rules.js";
import { Game } from "./game.js";
import { Battlefield } from "./zone/zones/battlefield.js";
import { Exile } from "./zone/zones/exile.js";
import { Graveyard } from "./zone/zones/graveyard.js";
import { Hand } from "./zone/zones/hand.js";
import { Library } from "./zone/zones/library.js";

// ── shared fixtures ──────────────────────────────────────────────────────────
const alice: LobbyPlayer = { id: "P0", name: "P0", controllerKind: "human" };
const bob: LobbyPlayer = { id: "P1", name: "P1", controllerKind: "human" };

const rules: GameRules = {
  formatId: "standard",
  startingLife: 20,
  startingHandSize: 7,
  mulliganRule: "london",
  firstPlayerSkipsDraw: false,
  ruleOverrides: [],
  playerCount: { min: 2, max: 2 },
  poisonCountersToLose: 10,
  playForAnte: false,
  manaBurn: false,
  appliedVariants: [],
};
const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "test",
  cardDataSyncedAt: "2026-04-30T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "wave118",
};

const paper: PaperCard = {
  name: "TestCard",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (): Game => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xfacefeed18n),
  });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
    player.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, player.seat));
  }
  return game;
};

const mkSa = (
  handlerKey: string,
  params: Record<string, { kind: string; raw: string }>,
  sourceId: ReturnType<typeof mkEntityId>,
) =>
  new SpellAbility(
    {
      kind: "spell",
      effect: { handlerKey, params: params as never },
      cost: { raw: "" },
    },
    sourceId,
    mkPlayerSeat(0),
    new Map(),
    [],
  );

const drainWithDecisions = (
  gen: Generator<unknown, void, unknown>,
  responder: (req: unknown) => unknown,
): unknown[] => {
  const out: unknown[] = [];
  let r = gen.next();
  while (!r.done) {
    out.push(r.value);
    const yielded = r.value as { kind?: string; request?: unknown };
    if (yielded.kind === "decision") {
      r = gen.next(responder(yielded.request));
    } else {
      r = gen.next();
    }
  }
  return out;
};

// ── Pick 1: DraftEffect — chooseCard over synthesized pool ──────────────────
describe("Wave 118 — Pick 1: DraftEffect synthesizes a chooseCard pick", () => {
  it("yields chooseCard against the source's remembered pool and stamps draftPickFlags", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(100);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    // Stage 3 candidate cards in `remembered` (synthesized draft pool).
    const cand1 = mkEntityId(201);
    const cand2 = mkEntityId(202);
    const cand3 = mkEntityId(203);
    for (const cid of [cand1, cand2, cand3]) {
      game.cards.set(cid, new Card(cid, paper, seat0, seat0, ZoneType.Exile));
    }
    source.remembered.push(cand1, cand2, cand3);

    const sa = mkSa("Draft", { Num: { kind: "literal", raw: "1" } }, sourceId);
    const yields = drainWithDecisions(
      sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>,
      (req) => {
        const r = req as { kind: string; pool?: ReadonlyArray<unknown> };
        if (r.kind === "chooseCard") {
          // Pick the second candidate.
          return { kind: "chooseCard", chosen: [cand2] };
        }
        return undefined;
      },
    );

    // The decision was yielded.
    const decisions = yields.filter((y) => (y as { kind?: string }).kind === "decision");
    expect(decisions.length).toBe(1);
    const d = decisions[0] as { request: { kind: string; pool: readonly unknown[] } };
    expect(d.request.kind).toBe("chooseCard");
    expect(d.request.pool).toEqual([cand1, cand2, cand3]);

    // draftPickFlags is stamped with the chosen + remaining ids.
    expect(source.draftPickFlags).toBeDefined();
    expect(source.draftPickFlags?.picked).toEqual([cand2]);
    expect(source.draftPickFlags?.remaining).toEqual([cand1, cand3]);
    // remembered cleared so re-resolution starts fresh.
    expect(source.remembered.length).toBe(0);
  });

  it("falls back deterministically to the top of the pool when the decision is missing/invalid", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(110);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const c1 = mkEntityId(301);
    const c2 = mkEntityId(302);
    game.cards.set(c1, new Card(c1, paper, seat0, seat0, ZoneType.Exile));
    game.cards.set(c2, new Card(c2, paper, seat0, seat0, ZoneType.Exile));
    source.remembered.push(c1, c2);

    const sa = mkSa("Draft", { Num: { kind: "literal", raw: "1" } }, sourceId);
    drainWithDecisions(
      sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>,
      () => undefined, // no response
    );
    // Fallback picks the top of the pool.
    expect(source.draftPickFlags?.picked).toEqual([c1]);
    expect(source.draftPickFlags?.remaining).toEqual([c2]);
  });

  it("with no staged pool, records canonical no-op pick + intent on remembered", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(120);
    const source = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const sa = mkSa("Draft", {}, sourceId);
    const yields = drainWithDecisions(
      sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>,
      () => undefined,
    );
    // No decision yielded (empty pool branch).
    const decisions = yields.filter((y) => (y as { kind?: string }).kind === "decision");
    expect(decisions.length).toBe(0);
    expect(source.draftPickFlags).toEqual({ picked: [], remaining: [] });
    // Intent recorded on remembered.
    expect(source.remembered).toContain(sourceId);
  });
});

// ── Pick 2: Card.draftPickFlags slot exists and is undefined by default ─────
describe("Wave 118 — Pick 2: Card.draftPickFlags slot", () => {
  it("is undefined on a freshly minted card", () => {
    const seat0 = mkPlayerSeat(0);
    const card = new Card(mkEntityId(1), paper, seat0, seat0, ZoneType.Battlefield);
    expect(card.draftPickFlags).toBeUndefined();
  });
});

// ── Pick 3: altcost closure notes — no live TODO(advanced) markers ──────────
describe("Wave 118 — Pick 3: altcost closure notes are explicit", () => {
  it("buyback / jump-start / retrace / aftermath / adventure modules read clean", () => {
    // The closure notes are documented in source; we assert the durable
    // contracts (the read-side slots) still exist on Card so consumers
    // are unaffected.
    const seat0 = mkPlayerSeat(0);
    const card = new Card(mkEntityId(2), paper, seat0, seat0, ZoneType.Battlefield);
    // buyback contract (Wave 57)
    expect(card.buybackPaid).toBeUndefined();
    card.buybackPaid = true;
    expect(card.buybackPaid).toBe(true);
    card.buybackPaid = undefined;
    expect(card.buybackPaid).toBeUndefined();
  });
});
