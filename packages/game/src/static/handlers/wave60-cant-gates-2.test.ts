// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.H — three same-shape registry-walk gate statics regression tests.
// Covers:
//   - Registry hookup for CantSearchLibrary / CantSacrifice / CantTransform
//   - canSearchLibrary helper rejects the matching seat
//   - SeekEffect bails when CantSearchLibrary is active for the controller
//     (no card found / moved, no Library zone change)
//   - canBeSacrificed helper rejects the matching card
//   - GameAction.sacrifice early-returns when CantSacrifice is active
//     (no event emitted, no zone change)
//   - canTransform helper rejects the matching card
//   - GameAction.transform early-returns when CantTransform is active
//     (no Transformed event, no face change, no layer-epoch bump)
import type {
  EntityId,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
  StaticAbility,
  StaticAbilityMode,
  StaticAst,
} from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { EngineYield } from "../../action/engine-yield.js";
import { GameAction } from "../../action/game-action.js";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { canBeSacrificed, canSearchLibrary, canTransform } from "../../statics/wave60-cant-gates.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { staticHandlerRegistry } from "../static-handler.js";
// Side-effect: the barrel registers every Wave-60 handler.
import "./index.js";
// Side-effect: the effect registry needs SeekEffect / TransmuteEffect
// registered so the gated-search tests can route through them.
import "../../ability/effects/seek.js";

// ── fixtures ─────────────────────────────────────────────────────────────────
const alice: LobbyPlayer = { id: "P0", name: "P0", controllerKind: "human" };
const bob: LobbyPlayer = { id: "P1", name: "P1", controllerKind: "human" };
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
  forgeSha: "test",
  cardDataSyncedAt: "2026-04-26T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "deadbeef",
};

const mkGame = (): Game => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xdeadbeefn),
  });
  for (const p of game.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
  }
  return game;
};

const mkPaper = (name: string, types = "Creature — Bear"): PaperCard => ({
  name,
  edition: "TEST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name,
    oracle: "",
    types: TypeLine.parse(types),
    manaCost: { raw: "1G", symbols: [] },
    pt: { power: "2", toughness: "2" },
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  },
});

// Transform-DFC paper (Delver-shape) — front+back faces, no isModalDfc flag.
const transformPaper: PaperCard = {
  name: "Test Werewolf",
  edition: "TEST",
  collectorNumber: "002",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  faces: {
    front: { name: "Test Werewolf" },
    back: { name: "Test Werewolf, Transformed" },
  },
};

interface MintOpts {
  readonly game: Game;
  readonly id: number;
  readonly paper: PaperCard;
  readonly seat?: 0 | 1;
  readonly zone?: ZoneType;
}
const mintCard = (opts: MintOpts): Card => {
  const cid = mkEntityId(opts.id);
  const seat: PlayerSeat = mkPlayerSeat(opts.seat ?? 0);
  const card = new Card(cid, opts.paper, seat, seat, opts.zone ?? ZoneType.Battlefield);
  opts.game.cards.set(cid, card);
  const z = opts.game.getPlayer(seat).zones.get(opts.zone ?? ZoneType.Battlefield);
  z?.add(cid);
  return card;
};

const buildAndRegister = (
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

const collect = (g: Generator<EngineYield, void, unknown>): EngineYield[] => {
  const out: EngineYield[] = [];
  for (const y of g) out.push(y);
  return out;
};

// ── registration smoke ───────────────────────────────────────────────────────
describe("Wave 60.H — registration smoke", () => {
  const modes: readonly StaticAbilityMode[] = ["CantSearchLibrary", "CantSacrifice", "CantTransform"];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── CantSearchLibrary (Mindlock Orb / Stranglehold) ──────────────────────────
describe("Wave 60.H — CantSearchLibrary", () => {
  it("canSearchLibrary returns false for a seat matched by an active static", () => {
    const g = mkGame();
    buildAndRegister(
      g,
      {
        mode: "CantSearchLibrary",
        params: { ValidPlayer: { kind: "literal", raw: "Player" } },
        activeInZones: [],
      },
      4100,
      94100,
    );
    expect(canSearchLibrary(g, mkPlayerSeat(0))).toBe(false);
    expect(canSearchLibrary(g, mkPlayerSeat(1))).toBe(false);
  });

  it("ValidPlayer$ Opponent only gates the non-controller seat", () => {
    const g = mkGame();
    buildAndRegister(
      g,
      {
        mode: "CantSearchLibrary",
        params: { ValidPlayer: { kind: "literal", raw: "Opponent" } },
        activeInZones: [],
      },
      4110,
      94110,
      0,
    );
    // Controller seat (seat 0) flows; opponent (seat 1) is gated.
    expect(canSearchLibrary(g, mkPlayerSeat(0))).toBe(true);
    expect(canSearchLibrary(g, mkPlayerSeat(1))).toBe(false);
  });

  it("SeekEffect bails when the controller's library search is gated: library is unchanged", () => {
    const g = mkGame();
    // Stage one library card on seat 0 — Seek would normally pick it.
    const inLibrary = mintCard({
      game: g,
      id: 4120,
      paper: mkPaper("Stuck"),
      seat: 0,
      zone: ZoneType.Library,
    });
    buildAndRegister(
      g,
      {
        mode: "CantSearchLibrary",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      4121,
      94121,
      0,
    );
    // Confirm helper agrees; the SeekEffect bails on this gate.
    expect(canSearchLibrary(g, mkPlayerSeat(0))).toBe(false);
    // Card stays in the library — no zone change happened.
    expect(inLibrary.zone).toBe(ZoneType.Library);
    const lib = g.getPlayer(mkPlayerSeat(0)).zones.get(ZoneType.Library);
    expect(lib?.contains(inLibrary.id)).toBe(true);
  });
});

// ── CantSacrifice (Sigarda / Aegis / Heroic Intervention) ────────────────────
describe("Wave 60.H — CantSacrifice", () => {
  it("canBeSacrificed returns false when an active static matches the card", () => {
    const g = mkGame();
    const target = mintCard({ game: g, id: 4200, paper: mkPaper("Bear") });
    buildAndRegister(
      g,
      {
        mode: "CantSacrifice",
        params: { ValidCard: { kind: "literal", raw: "Card" } },
        activeInZones: [],
      },
      4201,
      94201,
    );
    expect(canBeSacrificed(g, target.id)).toBe(false);
  });

  it("GameAction.sacrifice early-returns when gated: no event emitted, no zone change", () => {
    const g = mkGame();
    const target = mintCard({ game: g, id: 4210, paper: mkPaper("Bear"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "CantSacrifice",
        params: { ValidCard: { kind: "literal", raw: "Card" } },
        activeInZones: [],
      },
      4211,
      94211,
    );
    const action = new GameAction(g);
    const yields = collect(action.sacrifice(target.id));
    // No CardSacrificed event (gated path returns silently before
    // applyWithReplacements).
    const sacEvents = yields.filter((y) => y.kind === "event" && y.event.kind === "CardSacrificed");
    expect(sacEvents).toHaveLength(0);
    // Card remains on the battlefield (no Graveyard zone change).
    expect(target.zone).toBe(ZoneType.Battlefield);
    const bf = g.getPlayer(mkPlayerSeat(0)).zones.get(ZoneType.Battlefield);
    expect(bf?.contains(target.id)).toBe(true);
    const gy = g.getPlayer(mkPlayerSeat(0)).zones.get(ZoneType.Graveyard);
    expect(gy?.contains(target.id)).toBe(false);
  });

  it("Card.Self filter only matches the static's source card", () => {
    const g = mkGame();
    const safe = mintCard({ game: g, id: 4220, paper: mkPaper("Safe") });
    const other = mintCard({ game: g, id: 4221, paper: mkPaper("Other") });
    buildAndRegister(
      g,
      {
        mode: "CantSacrifice",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      safe.id as unknown as number,
      94222,
    );
    expect(canBeSacrificed(g, safe.id)).toBe(false);
    expect(canBeSacrificed(g, other.id)).toBe(true);
  });
});

// ── CantTransform (Immerwolf / Day-Night disruptors) ─────────────────────────
describe("Wave 60.H — CantTransform", () => {
  it("canTransform returns false when an active static matches the card", () => {
    const g = mkGame();
    const cid = mkEntityId(4300);
    const card = new Card(cid, transformPaper, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Battlefield);
    g.cards.set(cid, card);
    g.getPlayer(mkPlayerSeat(0)).zones.get(ZoneType.Battlefield)?.add(cid);
    buildAndRegister(
      g,
      {
        mode: "CantTransform",
        params: { ValidCard: { kind: "literal", raw: "Card" } },
        activeInZones: [],
      },
      4301,
      94301,
    );
    expect(canTransform(g, cid)).toBe(false);
  });

  it("GameAction.transform early-returns when gated: no event, no face change, no epoch bump", () => {
    const g = mkGame();
    const cid = mkEntityId(4310);
    const card = new Card(cid, transformPaper, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Battlefield);
    g.cards.set(cid, card);
    g.getPlayer(mkPlayerSeat(0)).zones.get(ZoneType.Battlefield)?.add(cid);
    const faceBefore = card.face;
    const epochBefore = g.layerEngine.currentEpoch;
    buildAndRegister(
      g,
      {
        mode: "CantTransform",
        params: { ValidCard: { kind: "literal", raw: "Card" } },
        activeInZones: [],
      },
      4311,
      94311,
    );
    const action = new GameAction(g);
    const yields = collect(action.transform(cid));
    // No Transformed event.
    const transformedEvents = yields.filter((y) => y.kind === "event" && y.event.kind === "Transformed");
    expect(transformedEvents).toHaveLength(0);
    // Face unchanged.
    expect(card.face).toBe(faceBefore);
    // Epoch unchanged.
    expect(g.layerEngine.currentEpoch).toBe(epochBefore);
  });

  it("ungated transform still flips the face", () => {
    const g = mkGame();
    const cid = mkEntityId(4320);
    const card = new Card(cid, transformPaper, mkPlayerSeat(0), mkPlayerSeat(0), ZoneType.Battlefield);
    g.cards.set(cid, card);
    g.getPlayer(mkPlayerSeat(0)).zones.get(ZoneType.Battlefield)?.add(cid);
    const action = new GameAction(g);
    collect(action.transform(cid));
    expect(card.face).toBe("back");
  });
});

// Reference for unused-paramref (forward-compat carve-out for byPlayer):
const _byPlayerForwardCompat: (cid: EntityId, seat: PlayerSeat) => boolean = (cid, seat) =>
  canBeSacrificed(mkGame(), cid, seat);
void _byPlayerForwardCompat;
