// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 44 — SubgameEffect (Shahrazad). Verifies the deterministic resolver:
//   score(p) = life * 2 + sum(power on battlefield) + library size
// The higher-scoring player wins, the active player breaks ties, and the
// loser loses half their life rounded up. SubgameResolved is emitted with
// the outcome.
import "./wave-21-effects.js";
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

const mkGame = (): Game => {
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

const mkSa = (sourceId = mkEntityId(10), controllerSeat = mkPlayerSeat(0)): SpellAbility =>
  new SpellAbility(
    {
      kind: "spell",
      effect: { handlerKey: "Subgame", params: {} as never },
      cost: { raw: "" },
    },
    sourceId,
    controllerSeat,
    new Map<string, SVarAst>(),
    [],
  );

const seedSourceCard = (game: Game, sourceId = mkEntityId(10)): Card => {
  const seat0 = mkPlayerSeat(0);
  const c = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
  game.cards.set(sourceId, c);
  return c;
};

const seedLibrary = (
  game: Game,
  seat: ReturnType<typeof mkPlayerSeat>,
  count: number,
  baseId: number,
): void => {
  const lib = game.getPlayer(seat).zones.get(ZoneType.Library);
  if (!lib) return;
  for (let i = 0; i < count; i++) {
    const id = mkEntityId(baseId + i);
    const c = new Card(id, paper, seat, seat, ZoneType.Library);
    game.cards.set(id, c);
    lib.add(id);
  }
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

describe("SubgameEffect — Shahrazad deterministic resolver", () => {
  it("picks the higher-scoring player as winner; loser loses ceil(life/2)", () => {
    const game = mkGame();
    seedSourceCard(game);
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const a = game.getPlayer(seat0);
    const b = game.getPlayer(seat1);

    // a: life 20, no library, no board → score = 40
    // b: life 5, no library, no board  → score = 10
    a.life = 20;
    b.life = 5;

    drainGen(mkSa().makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // Loser = seat1 (b). lifeLost = ceil(5/2) = 3 → b.life = 2.
    expect(b.life).toBe(2);
    expect(a.life).toBe(20);
  });

  it("includes library size and battlefield power in the score", () => {
    const game = mkGame();
    seedSourceCard(game);
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const a = game.getPlayer(seat0);
    const b = game.getPlayer(seat1);

    // Equal life. b has a giant library — b should win.
    a.life = 10;
    b.life = 10;
    seedLibrary(game, seat0, 1, 100);
    seedLibrary(game, seat1, 50, 200);

    drainGen(mkSa().makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    // a is the loser → ceil(10/2) = 5 → a.life = 5.
    expect(a.life).toBe(5);
    expect(b.life).toBe(10);
  });

  it("emits a SubgameResolved event with the correct winner / loser / lifeLost payload", () => {
    const game = mkGame();
    seedSourceCard(game);
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const a = game.getPlayer(seat0);
    const b = game.getPlayer(seat1);
    a.life = 8;
    b.life = 1;

    const yields = drainGen(mkSa().makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    const events = yields.filter((y) => (y as { kind?: string }).kind === "event") as {
      event: { kind: string; payload: unknown };
    }[];
    const resolved = events.find((e) => e.event.kind === "SubgameResolved");
    expect(resolved).toBeDefined();
    const payload = resolved?.event.payload as {
      winnerSeat: ReturnType<typeof mkPlayerSeat>;
      loserSeat: ReturnType<typeof mkPlayerSeat>;
      lifeLost: number;
    };
    expect(payload.winnerSeat).toBe(seat0);
    expect(payload.loserSeat).toBe(seat1);
    // ceil(1/2) = 1
    expect(payload.lifeLost).toBe(1);
  });

  it("breaks ties in favor of the active player", () => {
    const game = mkGame();
    seedSourceCard(game);
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const a = game.getPlayer(seat0);
    const b = game.getPlayer(seat1);
    a.life = 10;
    b.life = 10;
    // Both libraries empty, both boards empty — perfect tie.
    // Active player is seat0 by default → seat1 should be the loser.

    const yields = drainGen(mkSa().makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const resolved = (
      yields.filter((y) => (y as { kind?: string }).kind === "event") as {
        event: { kind: string; payload: unknown };
      }[]
    ).find((e) => e.event.kind === "SubgameResolved");
    expect(resolved).toBeDefined();
    const payload = resolved?.event.payload as {
      winnerSeat: ReturnType<typeof mkPlayerSeat>;
      loserSeat: ReturnType<typeof mkPlayerSeat>;
      lifeLost: number;
    };
    expect(payload.winnerSeat).toBe(seat0);
    expect(payload.loserSeat).toBe(seat1);
    expect(payload.lifeLost).toBe(5);
    expect(b.life).toBe(5);
  });

  it("routes the loser's life loss through changeLife (LifeChanged + LifeLost emitted)", () => {
    const game = mkGame();
    seedSourceCard(game);
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const a = game.getPlayer(seat0);
    const b = game.getPlayer(seat1);
    a.life = 30;
    b.life = 4;

    const yields = drainGen(mkSa().makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const eventKinds = (
      yields.filter((y) => (y as { kind?: string }).kind === "event") as {
        event: { kind: string };
      }[]
    ).map((y) => y.event.kind);

    expect(eventKinds).toContain("LifeChanged");
    expect(eventKinds).toContain("LifeLost");
    expect(eventKinds).toContain("SubgameResolved");
    // ceil(4/2) = 2 → 4 - 2 = 2.
    expect(b.life).toBe(2);
  });
});
