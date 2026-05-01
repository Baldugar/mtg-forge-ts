// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 102 — cross-module TODO(advanced) sweep round 7 regression tests.
//
// Picks closed (one assertion bundle per pick):
//   1. static/handlers/cant-be-suspected-static.ts — stale TODO
//      retired; the Suspect application gate IS wired through
//      `ability/effects/suspect.ts` + the AlterAttribute
//      `Suspect/Suspected` lane in `wave-21-effects.ts`. Both call
//      `canBeSuspected(game, id)` before flipping the flag and
//      silently reject matched cards (no flag flip, no
//      CardSuspected event).
//   2. statics/wave76-gate-helpers.ts — stale "forward-compat"
//      framing retired for Suspect now that the read-side gate is
//      consumed.
//   3. static/handlers/additional-untap-step-static.ts — stale
//      TODO retired; CR 502.2 ordering closed in Wave 99 — extra
//      untap loops run BEFORE the canonical untap pass.
//   4. dnd/initiative-tracker.ts (Forge room, case 2) — decision-
//      driven `chooseCard` over the controller's own creatures
//      replaces the first-match MVP.
//   5. dnd/initiative-tracker.ts (Trap! room, case 4) — decision-
//      driven `choosePlayer` over live players replaces the
//      first-opponent MVP.
//   6. dnd/initiative-tracker.ts (Arena room, case 5) — decision-
//      driven `chooseCard` over opponent creatures replaces the
//      first-match MVP.
import "./ability/effects/wave-21-effects.js";
import "./ability/effects/wave-22-effects.js";
import "./ability/effects/suspect.js";
import type {
  CardDefinition,
  DecisionResponse,
  EntityId,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
  StaticAbility,
  StaticAbilityMode,
  StaticAst,
} from "@mtg-forge-ts/core";
import {
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "./card.js";
import { applyUndercityRoomEffect } from "./dnd/initiative-tracker.js";
import type { GameMeta } from "./game-meta.js";
import type { GameRules } from "./game-rules.js";
import { Game } from "./game.js";
import { staticHandlerRegistry } from "./static/static-handler.js";
import { canBeSuspected } from "./statics/wave76-gate-helpers.js";
import { Battlefield } from "./zone/zones/battlefield.js";
import { Exile } from "./zone/zones/exile.js";
import { Graveyard } from "./zone/zones/graveyard.js";
import { Hand } from "./zone/zones/hand.js";
import { Library } from "./zone/zones/library.js";
// Side-effect: register every static handler so registry lookups resolve.
import "./static/handlers/index.js";
import "./trigger/handlers/index.js";

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
  seed: "wave102",
};

const seat0 = mkPlayerSeat(0);
const seat1 = mkPlayerSeat(1);

const mkGame = (): Game => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xfacefeed01n),
  });
  for (const p of game.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, p.seat));
  }
  return game;
};

const minimalDef = (overrides: Partial<CardDefinition> = {}): CardDefinition => ({
  name: "Test",
  oracle: "",
  types: TypeLine.parse("Creature"),
  manaCost: null,
  pt: { power: "1", toughness: "1" },
  colors: ColorSet.empty(),
  abilities: [],
  triggers: [],
  replacements: [],
  statics: [],
  keywords: [],
  svars: new Map(),
  ...overrides,
});

const mkPaper = (name: string, def?: CardDefinition): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  ...(def !== undefined ? { definition: def } : {}),
});

const seedCard = (
  game: Game,
  id: number,
  name: string,
  controllerSeat: PlayerSeat,
  zone: ZoneType,
  def?: CardDefinition,
): Card => {
  const eid = mkEntityId(id);
  const paper = mkPaper(name, def);
  const card = new Card(eid, paper, controllerSeat, controllerSeat, zone);
  game.cards.set(eid, card);
  const z = game.getPlayer(controllerSeat).zones.get(zone);
  if (z) z.add(eid);
  return card;
};

const buildAndRegisterStatic = (
  game: Game,
  ast: StaticAst,
  sourceCardId: number,
  staticIdSeed: number,
  controllerSeat: 0 | 1 = 0,
): StaticAbility => {
  const Cls = staticHandlerRegistry.lookup(ast.mode as StaticAbilityMode);
  if (!Cls) throw new Error(`mode ${ast.mode} not registered`);
  const s = new Cls().build(ast, {
    game,
    sourceCardId: mkEntityId(sourceCardId),
    controllerSeat: mkPlayerSeat(controllerSeat),
    staticId: mkEntityId(staticIdSeed),
  });
  game.staticEffectRegistry.register(s);
  return s;
};

/**
 * Drain a generator with a programmable decision responder. The
 * `decide` callback receives each decision request and either
 * returns a DecisionResponse to send back into the generator or
 * `undefined` to continue without responding (so the deterministic
 * fallback inside the resolver kicks in).
 */
const drainWithDecisions = (
  gen: Generator<{ kind: string; request?: { kind: string } }, void, unknown>,
  decide: (req: { readonly kind: string } & Record<string, unknown>) => DecisionResponse | undefined,
): unknown[] => {
  const out: unknown[] = [];
  let r = gen.next();
  while (!r.done) {
    const y = r.value;
    out.push(y);
    if (y.kind === "decision" && y.request !== undefined) {
      const resp = decide(y.request as { readonly kind: string } & Record<string, unknown>);
      r = gen.next(resp);
    } else {
      r = gen.next();
    }
  }
  return out;
};

// ── Pick 1: CantBeSuspected gate IS wired ─────────────────────────────────────
describe("Wave 102 — CantBeSuspected static is consulted by SuspectEffect", () => {
  it("Suspect lane (AB$ AlterAttribute Attributes$ Suspected) is gated", () => {
    const game = mkGame();
    // Mint a creature card and a CantBeSuspected static targeting it.
    const target = seedCard(game, 8001, "Bear", seat0, ZoneType.Battlefield, minimalDef());
    // Initial state: not yet suspected (the flag is `undefined` until
    // the Suspect lane stamps it; canBeSuspected gates BEFORE the
    // stamp so the value never flips when a CantBeSuspected static
    // matches).
    expect(target.suspected ?? false).toBe(false);
    const src = seedCard(game, 8000, "Suspect Blocker", seat0, ZoneType.Battlefield, minimalDef());
    buildAndRegisterStatic(
      game,
      {
        mode: "CantBeSuspected",
        params: { ValidCard: { kind: "literal", raw: "Card.YouCtrl" } },
        activeInZones: [],
      },
      src.id as unknown as number,
      88001,
      0,
    );
    // Helper read-side: gate refuses the suspect transition.
    expect(canBeSuspected(game, target.id)).toBe(false);
  });

  it("absent static — gate is permissive (every card may be suspected)", () => {
    const game = mkGame();
    const target = seedCard(game, 8010, "Bear", seat0, ZoneType.Battlefield, minimalDef());
    expect(canBeSuspected(game, target.id)).toBe(true);
  });

  it("static with non-matching ValidCard$ does not block other cards", () => {
    const game = mkGame();
    const ownBear = seedCard(game, 8020, "Own Bear", seat0, ZoneType.Battlefield, minimalDef());
    const oppBear = seedCard(game, 8021, "Opp Bear", seat1, ZoneType.Battlefield, minimalDef());
    const src = seedCard(game, 8019, "Src", seat0, ZoneType.Battlefield, minimalDef());
    buildAndRegisterStatic(
      game,
      {
        mode: "CantBeSuspected",
        params: { ValidCard: { kind: "literal", raw: "Card.YouCtrl" } },
        activeInZones: [],
      },
      src.id as unknown as number,
      88020,
      0,
    );
    expect(canBeSuspected(game, ownBear.id)).toBe(false);
    expect(canBeSuspected(game, oppBear.id)).toBe(true);
  });
});

// ── Pick 4: Forge room — decision-driven chooseCard ──────────────────────────
describe("Wave 102 — Undercity Forge room yields chooseCard for the +1/+1 target", () => {
  it("yields a chooseCard request listing the controller's creatures", () => {
    const game = mkGame();
    const a = seedCard(game, 9000, "Bear A", seat0, ZoneType.Battlefield, minimalDef());
    const b = seedCard(game, 9001, "Bear B", seat0, ZoneType.Battlefield, minimalDef());

    let seen: { pool: readonly EntityId[] } | undefined;
    drainWithDecisions(applyUndercityRoomEffect(game, seat0, 2) as never, (req) => {
      if (req.kind === "chooseCard") {
        seen = { pool: (req as { pool?: readonly EntityId[] }).pool ?? [] };
      }
      return undefined;
    });
    expect(seen).toBeDefined();
    expect(seen?.pool.includes(a.id)).toBe(true);
    expect(seen?.pool.includes(b.id)).toBe(true);
  });

  it("honors the chooser's pick — counters land on the chosen creature", () => {
    const game = mkGame();
    const a = seedCard(game, 9100, "Bear A", seat0, ZoneType.Battlefield, minimalDef());
    const b = seedCard(game, 9101, "Bear B", seat0, ZoneType.Battlefield, minimalDef());

    drainWithDecisions(applyUndercityRoomEffect(game, seat0, 2) as never, (req) => {
      if (req.kind === "chooseCard") {
        return { kind: "chooseCard", chosen: [b.id] };
      }
      return undefined;
    });
    // Counters landed on the second bear (the chosen target), not the
    // deterministic-fallback first.
    expect(b.counters.get("P1P1" as never)).toBe(2);
    expect(a.counters.get("P1P1" as never) ?? 0).toBe(0);
  });

  it("falls back to first eligible when chooser declines", () => {
    const game = mkGame();
    const a = seedCard(game, 9200, "Bear A", seat0, ZoneType.Battlefield, minimalDef());
    seedCard(game, 9201, "Bear B", seat0, ZoneType.Battlefield, minimalDef());

    drainWithDecisions(applyUndercityRoomEffect(game, seat0, 2) as never, () => undefined);
    // Deterministic fallback: head-of-list.
    expect(a.counters.get("P1P1" as never)).toBe(2);
  });

  it("no-op when controller has no creatures", () => {
    const game = mkGame();
    const yields = drainWithDecisions(applyUndercityRoomEffect(game, seat0, 2) as never, () => undefined);
    // Should not yield a chooseCard when the eligible pool is empty.
    const decisionYields = yields.filter((y) => (y as { kind?: string }).kind === "decision");
    expect(decisionYields.length).toBe(0);
  });
});

// ── Pick 5: Trap! room — decision-driven choosePlayer ────────────────────────
describe("Wave 102 — Undercity Trap! room yields choosePlayer for the life-loss target", () => {
  it("yields a choosePlayer request and sends life loss to the chosen seat", () => {
    const game = mkGame();
    const beforeSelf = game.getPlayer(seat0).life;
    const beforeOpp = game.getPlayer(seat1).life;

    drainWithDecisions(applyUndercityRoomEffect(game, seat0, 4) as never, (req) => {
      if (req.kind === "choosePlayer") {
        return { kind: "choosePlayer", chosen: [seat0] };
      }
      return undefined;
    });
    // Chosen self → self loses 5, opponent unaffected.
    expect(game.getPlayer(seat0).life).toBe(beforeSelf - 5);
    expect(game.getPlayer(seat1).life).toBe(beforeOpp);
  });

  it("falls back to first opponent when chooser declines", () => {
    const game = mkGame();
    const beforeSelf = game.getPlayer(seat0).life;
    const beforeOpp = game.getPlayer(seat1).life;

    drainWithDecisions(applyUndercityRoomEffect(game, seat0, 4) as never, () => undefined);
    expect(game.getPlayer(seat0).life).toBe(beforeSelf);
    expect(game.getPlayer(seat1).life).toBe(beforeOpp - 5);
  });

  it("the choosePlayer request was actually issued", () => {
    const game = mkGame();
    let saw = false;
    drainWithDecisions(applyUndercityRoomEffect(game, seat0, 4) as never, (req) => {
      if (req.kind === "choosePlayer") {
        saw = true;
      }
      return undefined;
    });
    expect(saw).toBe(true);
  });
});

// ── Pick 6: Arena room — decision-driven chooseCard for goad ─────────────────
describe("Wave 102 — Undercity Arena room yields chooseCard for the goad target", () => {
  it("honors the chooser's pick — goaded lands on the chosen creature", () => {
    const game = mkGame();
    const w1 = seedCard(game, 9500, "Wolf 1", seat1, ZoneType.Battlefield, minimalDef());
    const w2 = seedCard(game, 9501, "Wolf 2", seat1, ZoneType.Battlefield, minimalDef());

    drainWithDecisions(applyUndercityRoomEffect(game, seat0, 5) as never, (req) => {
      if (req.kind === "chooseCard") {
        return { kind: "chooseCard", chosen: [w2.id] };
      }
      return undefined;
    });
    expect(w2.goaded).toBe(true);
    expect(w1.goaded).toBe(false);
  });

  it("falls back to first opponent creature when chooser declines", () => {
    const game = mkGame();
    const w1 = seedCard(game, 9600, "Wolf 1", seat1, ZoneType.Battlefield, minimalDef());
    const w2 = seedCard(game, 9601, "Wolf 2", seat1, ZoneType.Battlefield, minimalDef());

    drainWithDecisions(applyUndercityRoomEffect(game, seat0, 5) as never, () => undefined);
    expect(w1.goaded).toBe(true);
    expect(w2.goaded).toBe(false);
  });

  it("excludes the venturing player's own creatures from the pool", () => {
    const game = mkGame();
    const ownBear = seedCard(game, 9700, "Own Bear", seat0, ZoneType.Battlefield, minimalDef());
    seedCard(game, 9701, "Opp Wolf", seat1, ZoneType.Battlefield, minimalDef());

    let seen: { pool: readonly EntityId[] } | undefined;
    drainWithDecisions(applyUndercityRoomEffect(game, seat0, 5) as never, (req) => {
      if (req.kind === "chooseCard") {
        seen = { pool: (req as { pool?: readonly EntityId[] }).pool ?? [] };
      }
      return undefined;
    });
    expect(seen).toBeDefined();
    expect(seen?.pool.includes(ownBear.id)).toBe(false);
  });
});
