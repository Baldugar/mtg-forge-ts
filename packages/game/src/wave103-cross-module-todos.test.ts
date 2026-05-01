// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 103 — cross-module TODO(advanced) sweep round 8 regression tests.
//
// Picks closed (one assertion bundle per pick):
//   1. dnd/initiative-tracker.ts (advanceUndercityRoom) +
//      static/handlers/cant-venture-static.ts +
//      statics/wave76-gate-helpers.ts (canVenture) — the CantVenture
//      gate is now consulted by the AFR Initiative dungeon advance.
//      A matching ValidPlayer$ filter silently rejects the venture
//      (no dungeon advance, no UndercityRoomEntered event).
//   2. dnd/initiative-tracker.ts case 1 (Secret Entrance) — decision-
//      driven `chooseCard` over the basic-land pool replaces the
//      first-match MVP.
//   3. dnd/initiative-tracker.ts case 9 (Throne of the Dead Three) —
//      decision-driven `chooseCard` over the top-10 creature pool
//      replaces the first-match MVP.
//   4. card.ts (hideawayCard slot) — stale "see TODO(advanced) in
//      hideaway-keyword" reference retired; hideaway-keyword.ts
//      carries no advanced tail. The slot is populated by the ETB
//      trigger and observable by per-card free-cast surfaces.
//   5. card.ts (sagaChapterSVars slot) — stale "Wave-52 dispatch is
//      TODO(advanced)" retired; the Wave 94 CounterAdded watcher
//      resolves and yields the SVar named
//      `sagaChapterSVars[total - 1]` so each chapter's printed
//      effect fires.
//   6. card.ts (awakenAnimatedUntilEot slot) +
//      layers/base-characteristics.ts — Layer 4 type-add + Layer 7b
//      base-PT zeroing now wired. An awoken land observes
//      CardType.Creature + "Elemental" subtype + 0/0 base P/T.
import type {
  CardDefinition,
  EntityId,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
  StaticAbility,
  StaticAbilityMode,
  StaticAst,
} from "@mtg-forge-ts/core";
import {
  CardType,
  Color,
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  Supertype,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "./card.js";
import { advanceUndercityRoom, applyUndercityRoomEffect } from "./dnd/initiative-tracker.js";
import type { GameMeta } from "./game-meta.js";
import type { GameRules } from "./game-rules.js";
import { Game } from "./game.js";
import { staticHandlerRegistry } from "./static/static-handler.js";
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
  seed: "wave103",
};

const seat0 = mkPlayerSeat(0);
const seat1 = mkPlayerSeat(1);

const mkGame = (): Game => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xfacefeed02n),
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

const plainsDef = (): CardDefinition => ({
  name: "Plains",
  oracle: "",
  types: TypeLine.parse("Basic Land — Plains"),
  manaCost: null,
  colors: ColorSet.of(Color.White),
  abilities: [],
  triggers: [],
  replacements: [],
  statics: [],
  keywords: [],
  svars: new Map(),
});

const nonBasicLandDef = (): CardDefinition => ({
  name: "Forest of Forgotten Names",
  oracle: "",
  types: TypeLine.parse("Land"),
  manaCost: null,
  colors: ColorSet.empty(),
  abilities: [],
  triggers: [],
  replacements: [],
  statics: [],
  keywords: [],
  svars: new Map(),
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
 * returns a DecisionResponse (via unknown-cast) to send back into
 * the generator or `undefined` to continue without responding (so
 * the deterministic fallback inside the resolver kicks in).
 */
const drainWithDecisions = (
  gen: Generator<{ kind: string; request?: { kind: string } }, void, unknown>,
  decide: (req: { readonly kind: string } & Record<string, unknown>) => unknown,
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

// ── Pick 1: CantVenture short-circuits the dungeon advance ───────────────────
describe("Wave 103 — CantVenture silently rejects advanceUndercityRoom", () => {
  it("absent static — venture advances and emits UndercityRoomEntered", () => {
    const game = mkGame();
    const events = advanceUndercityRoom(game, seat0);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("UndercityRoomEntered");
    expect(game.flags.undercityRoom).toBe(1);
  });

  it("matching CantVenture — no advance, no event", () => {
    const game = mkGame();
    const src = seedCard(game, 7000, "Venture Blocker", seat0, ZoneType.Battlefield, minimalDef());
    buildAndRegisterStatic(
      game,
      {
        mode: "CantVenture",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      src.id as unknown as number,
      77000,
      0,
    );
    expect(game.flags.undercityRoom).toBe(0);
    const events = advanceUndercityRoom(game, seat0);
    expect(events).toHaveLength(0);
    expect(game.flags.undercityRoom).toBe(0);
  });

  it("non-matching ValidPlayer$ — venture still advances for the unaffected seat", () => {
    const game = mkGame();
    const src = seedCard(game, 7100, "Venture Blocker", seat0, ZoneType.Battlefield, minimalDef());
    buildAndRegisterStatic(
      game,
      {
        mode: "CantVenture",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      src.id as unknown as number,
      77100,
      0, // controllerSeat = 0 — "You" filter binds to seat0
    );
    // seat1 is not "You" relative to seat0's controller — venture advances.
    const events = advanceUndercityRoom(game, seat1);
    expect(events).toHaveLength(1);
    expect(game.flags.undercityRoom).toBe(1);
  });
});

// ── Pick 2: Secret Entrance — decision-driven chooseCard ─────────────────────
describe("Wave 103 — Undercity Secret Entrance yields chooseCard for the basic land", () => {
  it("yields a chooseCard request listing only basic lands in the library", () => {
    const game = mkGame();
    const plains1 = seedCard(game, 8000, "Plains", seat0, ZoneType.Library, plainsDef());
    const plains2 = seedCard(game, 8001, "Plains", seat0, ZoneType.Library, plainsDef());
    const nonBasic = seedCard(game, 8002, "Forest of FN", seat0, ZoneType.Library, nonBasicLandDef());
    const creature = seedCard(game, 8003, "Bear", seat0, ZoneType.Library, minimalDef());

    let seen: { pool: readonly EntityId[] } | undefined;
    drainWithDecisions(applyUndercityRoomEffect(game, seat0, 1) as never, (req) => {
      if (req.kind === "chooseCard") {
        seen = { pool: (req as { pool?: readonly EntityId[] }).pool ?? [] };
      }
      return undefined;
    });
    expect(seen).toBeDefined();
    expect(seen?.pool.includes(plains1.id)).toBe(true);
    expect(seen?.pool.includes(plains2.id)).toBe(true);
    expect(seen?.pool.includes(nonBasic.id)).toBe(false);
    expect(seen?.pool.includes(creature.id)).toBe(false);
  });

  it("honors the chooser's pick — chosen basic moves to hand", () => {
    const game = mkGame();
    const plains1 = seedCard(game, 8100, "Plains", seat0, ZoneType.Library, plainsDef());
    const plains2 = seedCard(game, 8101, "Plains", seat0, ZoneType.Library, plainsDef());

    drainWithDecisions(applyUndercityRoomEffect(game, seat0, 1) as never, (req) => {
      if (req.kind === "chooseCard") {
        return { kind: "chooseCard", chosen: [plains2.id] };
      }
      return undefined;
    });
    expect(plains2.zone).toBe(ZoneType.Hand);
    expect(plains1.zone).toBe(ZoneType.Library);
  });

  it("falls back to first eligible when chooser declines", () => {
    const game = mkGame();
    const plains1 = seedCard(game, 8200, "Plains", seat0, ZoneType.Library, plainsDef());
    const plains2 = seedCard(game, 8201, "Plains", seat0, ZoneType.Library, plainsDef());

    drainWithDecisions(applyUndercityRoomEffect(game, seat0, 1) as never, () => undefined);
    expect(plains1.zone).toBe(ZoneType.Hand);
    expect(plains2.zone).toBe(ZoneType.Library);
  });

  it("no chooseCard yielded when the library has no basic lands (only shuffle fires)", () => {
    const game = mkGame();
    seedCard(game, 8300, "Forest of FN", seat0, ZoneType.Library, nonBasicLandDef());
    const yields = drainWithDecisions(applyUndercityRoomEffect(game, seat0, 1) as never, () => undefined);
    const decisionYields = yields.filter((y) => (y as { kind?: string }).kind === "decision");
    expect(decisionYields.length).toBe(0);
  });
});

// ── Pick 3: Throne of the Dead Three — decision-driven chooseCard ────────────
describe("Wave 103 — Undercity Throne of the Dead Three yields chooseCard for the creature", () => {
  it("yields a chooseCard request listing only creatures from the top 10", () => {
    const game = mkGame();
    const c1 = seedCard(game, 9000, "Bear A", seat0, ZoneType.Library, minimalDef());
    const c2 = seedCard(game, 9001, "Bear B", seat0, ZoneType.Library, minimalDef());
    const land = seedCard(game, 9002, "Plains", seat0, ZoneType.Library, plainsDef());

    let seen: { pool: readonly EntityId[] } | undefined;
    drainWithDecisions(applyUndercityRoomEffect(game, seat0, 9) as never, (req) => {
      if (req.kind === "chooseCard") {
        seen = { pool: (req as { pool?: readonly EntityId[] }).pool ?? [] };
      }
      return undefined;
    });
    expect(seen).toBeDefined();
    expect(seen?.pool.includes(c1.id)).toBe(true);
    expect(seen?.pool.includes(c2.id)).toBe(true);
    expect(seen?.pool.includes(land.id)).toBe(false);
  });

  it("honors the chooser's pick — chosen creature ETBs with three +1/+1", () => {
    const game = mkGame();
    const c1 = seedCard(game, 9100, "Bear A", seat0, ZoneType.Library, minimalDef());
    const c2 = seedCard(game, 9101, "Bear B", seat0, ZoneType.Library, minimalDef());

    drainWithDecisions(applyUndercityRoomEffect(game, seat0, 9) as never, (req) => {
      if (req.kind === "chooseCard") {
        return { kind: "chooseCard", chosen: [c2.id] };
      }
      return undefined;
    });
    expect(c2.zone).toBe(ZoneType.Battlefield);
    expect(c2.counters.get("P1P1" as never)).toBe(3);
    expect(c1.zone).toBe(ZoneType.Library);
    expect(c1.counters.get("P1P1" as never) ?? 0).toBe(0);
  });

  it("falls back to the first creature when chooser declines", () => {
    const game = mkGame();
    const c1 = seedCard(game, 9200, "Bear A", seat0, ZoneType.Library, minimalDef());
    const c2 = seedCard(game, 9201, "Bear B", seat0, ZoneType.Library, minimalDef());

    drainWithDecisions(applyUndercityRoomEffect(game, seat0, 9) as never, () => undefined);
    expect(c1.zone).toBe(ZoneType.Battlefield);
    expect(c1.counters.get("P1P1" as never)).toBe(3);
    expect(c2.zone).toBe(ZoneType.Library);
  });

  it("no chooseCard yielded when the top 10 has no creatures (only shuffle fires)", () => {
    const game = mkGame();
    seedCard(game, 9300, "Plains", seat0, ZoneType.Library, plainsDef());
    const yields = drainWithDecisions(applyUndercityRoomEffect(game, seat0, 9) as never, () => undefined);
    const decisionYields = yields.filter((y) => (y as { kind?: string }).kind === "decision");
    expect(decisionYields.length).toBe(0);
  });
});

// ── Pick 4: Hideaway slot — observable contract (no longer carries TODO) ─────
describe("Wave 103 — Hideaway slot is observable; doc tail retired", () => {
  it("hideawayCard / hideawayHost slots default to undefined", () => {
    const game = mkGame();
    const c = seedCard(game, 10000, "Vesuva", seat0, ZoneType.Battlefield, minimalDef());
    expect(c.hideawayCard).toBeUndefined();
    expect(c.hideawayHost).toBeUndefined();
  });

  it("the slots can be stamped + read (per-card free-cast surface contract)", () => {
    const game = mkGame();
    const host = seedCard(game, 10100, "Hideaway Host", seat0, ZoneType.Battlefield, minimalDef());
    const exiled = seedCard(game, 10101, "Hideaway Exiled", seat0, ZoneType.Exile, minimalDef());
    host.hideawayCard = exiled.id;
    exiled.hideawayHost = host.id;
    expect(host.hideawayCard).toBe(exiled.id);
    expect(exiled.hideawayHost).toBe(host.id);
  });
});

// ── Pick 5: Saga sagaChapterSVars slot — Wave 94 dispatch is wired ───────────
describe("Wave 103 — sagaChapterSVars slot is observable; Wave-52 dispatch closure", () => {
  it("the slot defaults to undefined and accepts a writable SVar key list", () => {
    const game = mkGame();
    const saga = seedCard(game, 11000, "Test Saga", seat0, ZoneType.Battlefield, minimalDef());
    expect(saga.sagaChapterSVars).toBeUndefined();
    expect(saga.sagaChapterCount).toBeUndefined();
    saga.sagaChapterCount = 3;
    saga.sagaChapterSVars = ["DB1", "DB2", "DB3"];
    expect(saga.sagaChapterCount).toBe(3);
    expect(saga.sagaChapterSVars?.length).toBe(3);
    expect(saga.sagaChapterSVars?.[2]).toBe("DB3");
  });
});

// ── Pick 6: Awaken animation — Layer 4 type-add + Layer 7b base-PT ───────────
describe("Wave 103 — awakenAnimatedUntilEot stamps Creature/Elemental/0/0 in base", () => {
  it("default land has no Creature type and null P/T", () => {
    const game = mkGame();
    const land = seedCard(game, 12000, "Plains", seat0, ZoneType.Battlefield, plainsDef());
    const chars = game.layerEngine.computeCharacteristics(land.id);
    expect(chars.types.has(CardType.Land)).toBe(true);
    expect(chars.types.has(CardType.Creature)).toBe(false);
    expect(chars.subtypes.has("Elemental")).toBe(false);
    expect(chars.power).toBeNull();
    expect(chars.toughness).toBeNull();
  });

  it("with awakenAnimatedUntilEot=true: Creature added, Elemental subtype added, P/T = 0/0", () => {
    const game = mkGame();
    const land = seedCard(game, 12100, "Plains", seat0, ZoneType.Battlefield, plainsDef());
    land.awakenAnimatedUntilEot = true;
    const chars = game.layerEngine.computeCharacteristics(land.id);
    expect(chars.types.has(CardType.Land)).toBe(true);
    expect(chars.types.has(CardType.Creature)).toBe(true);
    expect(chars.subtypes.has("Elemental")).toBe(true);
    expect(chars.subtypes.has("Plains")).toBe(true);
    expect(chars.power).toBe(0);
    expect(chars.toughness).toBe(0);
  });

  it("supertype Basic survives the awaken animation (Land stays a Basic Land)", () => {
    const game = mkGame();
    const land = seedCard(game, 12200, "Plains", seat0, ZoneType.Battlefield, plainsDef());
    land.awakenAnimatedUntilEot = true;
    const chars = game.layerEngine.computeCharacteristics(land.id);
    expect(chars.supertypes.has(Supertype.Basic)).toBe(true);
  });

  it("clearing the flag reverts to land-only characteristics", () => {
    const game = mkGame();
    const land = seedCard(game, 12300, "Plains", seat0, ZoneType.Battlefield, plainsDef());
    land.awakenAnimatedUntilEot = true;
    const animatedChars = game.layerEngine.computeCharacteristics(land.id);
    expect(animatedChars.types.has(CardType.Creature)).toBe(true);
    land.awakenAnimatedUntilEot = false;
    game.layerEngine.bumpEpoch("test-clear-awaken");
    const restoredChars = game.layerEngine.computeCharacteristics(land.id);
    expect(restoredChars.types.has(CardType.Creature)).toBe(false);
    expect(restoredChars.subtypes.has("Elemental")).toBe(false);
    expect(restoredChars.power).toBeNull();
    expect(restoredChars.toughness).toBeNull();
  });
});
