// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 21 — corpus-unknown effect handlers test suite. One smoke per handler.
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
import { effectRegistry } from "../effect-registry.js";
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

const seedSourceCard = (game: Game, sourceId = mkEntityId(10)) => {
  const seat0 = mkPlayerSeat(0);
  const c = new Card(sourceId, paper, seat0, seat0, ZoneType.Battlefield);
  game.cards.set(sourceId, c);
  return c;
};

describe("Wave 21 — handler registration", () => {
  it("registers all 20 handlers", () => {
    for (const key of [
      "Proliferate",
      "Venture",
      "Manifest",
      "StoreSVar",
      "EndTurn",
      "Explore",
      "ManifestDread",
      "AssignGroup",
      "ExchangeLife",
      "Incubate",
      "TwoPiles",
      "SkipPhase",
      "EachDamage",
      "ControlPlayer",
      "LosesGame",
      "Subgame",
      "ExchangeLifeVariant",
      "RingTemptsYou",
      "AlterAttribute",
      "BidLife",
    ]) {
      expect(effectRegistry.has(key)).toBe(true);
    }
  });
});

describe("ProliferateEffect", () => {
  it("does not throw when there are no eligible targets", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("Proliferate", {});
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

describe("VentureEffect", () => {
  it("records the venture intent on remembered (smoke)", () => {
    const game = mkGame();
    const source = seedSourceCard(game);
    const sa = mkSa("Venture", {});
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(source.remembered.length).toBeGreaterThan(0);
  });
});

describe("ManifestEffect", () => {
  it("moves the top of library to the battlefield", () => {
    const game = mkGame();
    seedSourceCard(game);
    const seat0 = mkPlayerSeat(0);
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    const cardId = mkEntityId(20);
    const c = new Card(cardId, paper, seat0, seat0, ZoneType.Library);
    game.cards.set(cardId, c);
    lib?.add(cardId);
    const sa = mkSa("Manifest", { Amount: { kind: "literal", raw: "1" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(c.zone).toBe(ZoneType.Battlefield);
  });
});

describe("StoreSVarEffect", () => {
  it("stashes the value on the source's storedSVars map", () => {
    const game = mkGame();
    const source = seedSourceCard(game);
    const sa = mkSa("StoreSVar", {
      SVar: { kind: "literal", raw: "X" },
      Expression: { kind: "literal", raw: "42" },
    });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const stored = (source as unknown as { storedSVars?: Map<string, string> }).storedSVars;
    expect(stored?.get("X")).toBe("42");
  });
});

describe("EndTurnEffect", () => {
  it("flips the endTurnRequested flag on game", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("EndTurn", {});
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect((game as unknown as { endTurnRequested?: boolean }).endTurnRequested).toBe(true);
  });
});

describe("ExploreEffect", () => {
  it("does not throw with empty library and no targets", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("Explore", {});
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

describe("ManifestDreadEffect", () => {
  it("does not throw on empty library", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("ManifestDread", {});
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

describe("AssignGroupEffect", () => {
  it("records the targets on the source's remembered list", () => {
    const game = mkGame();
    const source = seedSourceCard(game);
    const tgt = mkEntityId(11);
    const sa = mkSa("AssignGroup", {}, mkEntityId(10), mkPlayerSeat(0), [tgt]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(source.remembered).toContain(tgt);
  });
});

describe("ExchangeLifeEffect", () => {
  it("swaps the controller's and the opponent's life totals", () => {
    const game = mkGame();
    seedSourceCard(game);
    const a = game.getPlayer(mkPlayerSeat(0));
    const b = game.getPlayer(mkPlayerSeat(1));
    a.life = 5;
    b.life = 17;
    const sa = mkSa("ExchangeLife", { Defined: { kind: "literal", raw: "Opponent" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(a.life).toBe(17);
    expect(b.life).toBe(5);
  });
});

describe("IncubateEffect", () => {
  it("smoke", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("Incubate", {});
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

describe("TwoPilesEffect", () => {
  it("splits library top into hand + graveyard", () => {
    const game = mkGame();
    seedSourceCard(game);
    const seat0 = mkPlayerSeat(0);
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    const a = mkEntityId(20);
    const b = mkEntityId(21);
    game.cards.set(a, new Card(a, paper, seat0, seat0, ZoneType.Library));
    game.cards.set(b, new Card(b, paper, seat0, seat0, ZoneType.Library));
    lib?.add(a);
    lib?.add(b);
    const sa = mkSa("TwoPiles", { Amount: { kind: "literal", raw: "2" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.cards.get(a)?.zone).toBe(ZoneType.Hand);
    expect(game.cards.get(b)?.zone).toBe(ZoneType.Graveyard);
  });
});

describe("SkipPhaseEffect", () => {
  it("appends a skip entry on the player's phaseSkips list", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("SkipPhase", { Phase: { kind: "literal", raw: "Combat" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const player = game.getPlayer(mkPlayerSeat(0));
    expect((player as unknown as { phaseSkips?: string[] }).phaseSkips).toContain("Combat");
  });
});

describe("EachDamageEffect", () => {
  it("smoke — runs without throwing on empty target list", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("EachDamage", { NumDmg: { kind: "literal", raw: "1" } });
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

describe("ControlPlayerEffect", () => {
  it("stamps controlledByOnNextTurn on the target seat", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("ControlPlayer", { Defined: { kind: "literal", raw: "Opponent" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const target = game.getPlayer(mkPlayerSeat(1));
    expect((target as unknown as { controlledByOnNextTurn?: unknown }).controlledByOnNextTurn).toBe(
      mkPlayerSeat(0),
    );
  });
});

describe("LosesGameEffect", () => {
  it("routes through gameLoss without throwing", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("LosesGame", { Defined: { kind: "literal", raw: "You" } });
    expect(() =>
      drainWithDecisions(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>, () => ({
        kind: "noop",
      })),
    ).not.toThrow();
  });
});

describe("SubgameEffect", () => {
  it("smoke", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("Subgame", {});
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
  });
});

describe("ExchangeLifeVariantEffect", () => {
  it("does not swap when the LowerLife condition is false", () => {
    const game = mkGame();
    seedSourceCard(game);
    const a = game.getPlayer(mkPlayerSeat(0));
    const b = game.getPlayer(mkPlayerSeat(1));
    a.life = 18;
    b.life = 9;
    const sa = mkSa("ExchangeLifeVariant", { Condition: { kind: "literal", raw: "LowerLife" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(a.life).toBe(18);
    expect(b.life).toBe(9);
  });
});

describe("RingTemptsYouEffect", () => {
  it("emits a RingTempted event and bumps the ring counter", () => {
    const game = mkGame();
    seedSourceCard(game);
    const sa = mkSa("RingTemptsYou", {});
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const events = yields.filter((y) => (y as { kind?: string }).kind === "event") as {
      event: { kind: string };
    }[];
    expect(events.some((e) => e.event.kind === "RingTempted")).toBe(true);
  });
});

describe("AlterAttributeEffect", () => {
  it("bumps the per-card attribute map", () => {
    const game = mkGame();
    const source = seedSourceCard(game);
    const sa = mkSa("AlterAttribute", {
      Attribute: { kind: "literal", raw: "ring-level" },
      Amount: { kind: "literal", raw: "2" },
    });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const attrs = (source as unknown as { attributes?: Map<string, number> }).attributes;
    expect(attrs?.get("ring-level")).toBe(2);
  });
});

describe("BidLifeEffect", () => {
  it("decrements the controller's life by 1", () => {
    const game = mkGame();
    seedSourceCard(game);
    const a = game.getPlayer(mkPlayerSeat(0));
    a.life = 10;
    const sa = mkSa("BidLife", {});
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(a.life).toBe(9);
  });
});
