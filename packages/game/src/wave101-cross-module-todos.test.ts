// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 101 — cross-module TODO(advanced) sweep round 6 regression tests.
//
// Picks closed (one assertion bundle per pick):
//   1. static/handlers/restriction-helpers.ts — new shared
//      `buildIsPresentGate` helper centralises the IsPresent$ /
//      PresentCompare$ / PresentZone$ sub-conditional gate so any static
//      handler can read it uniformly. Closes the "every handler builds
//      its own IsPresent$ scanner" duplication.
//   2. static/handlers/skip-untap-static.ts +
//      statics/wave60-turn-structure-gates.ts (shouldSkipUntap) —
//      `IsPresent$` / `PresentCompare$` / `PresentZone$` sub-conditional
//      gate is now honored. Closes the explicit Wave-60.G TODO(advanced).
//   3. static/handlers/skip-draw-static.ts +
//      statics/wave60-turn-structure-gates.ts (shouldSkipDraw) — same
//      shape; closes the Wave-60.G TODO(advanced) on the draw-step skip.
//   4. static/handlers/flip-coin-mod-static.ts +
//      statics/wave78-gate-helpers.ts (flipCoinModifier) — `Reflip$ True`
//      payload field landed plus a new "reflip-on-loss" mode in the
//      modifier result (Krark's Other Thumb shape). Closes the explicit
//      Wave-78 TODO(advanced) sub-bullet.
//   5. static/handlers/cant-put-counter-static.ts +
//      statics/wave60-cant-gates.ts (canPutCounterOnPlayer) —
//      `ValidPlayer$` filter now drives a player-subject gate (Phyrexian
//      Unlife / Melira / poison-counter blockers). Closes the explicit
//      Wave-60 player-side TODO(advanced).
//   6. static/handlers/can-exhaust-static.ts +
//      statics/wave75-gate-helpers.ts (canReExhaust) — `PlayerTurn$`
//      filter is now honored against `game.activePlayer`. Closes the
//      explicit Wave-75 TODO(advanced) sub-bullet (Elvish Refueler's
//      "During your turn" clause).
import type {
  CardDefinition,
  LobbyPlayer,
  ManaCostAst,
  ManaCostJSON,
  PaperCard,
  PlayerSeat,
  StaticAbility,
  StaticAbilityMode,
  StaticAst,
} from "@mtg-forge-ts/core";
import {
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaCost,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "./card.js";
import type { GameMeta } from "./game-meta.js";
import type { GameRules } from "./game-rules.js";
import { Game } from "./game.js";
import type { CanExhaustPayload } from "./static/handlers/can-exhaust-static.js";
import type { CantPutCounterPayload } from "./static/handlers/cant-put-counter-static.js";
import type { FlipCoinModPayload } from "./static/handlers/flip-coin-mod-static.js";
import { buildIsPresentGate } from "./static/handlers/restriction-helpers.js";
import type { SkipDrawPayload } from "./static/handlers/skip-draw-static.js";
import type { SkipUntapPayload } from "./static/handlers/skip-untap-static.js";
import { staticHandlerRegistry } from "./static/static-handler.js";
import { canPutCounter, canPutCounterOnPlayer } from "./statics/wave60-cant-gates.js";
import { shouldSkipDraw, shouldSkipUntap } from "./statics/wave60-turn-structure-gates.js";
import { canReExhaust } from "./statics/wave75-gate-helpers.js";
import { flipCoinModifier } from "./statics/wave78-gate-helpers.js";
import { Battlefield } from "./zone/zones/battlefield.js";
import { Exile } from "./zone/zones/exile.js";
import { Graveyard } from "./zone/zones/graveyard.js";
import { Hand } from "./zone/zones/hand.js";
import { Library } from "./zone/zones/library.js";
// Side-effect: register every handler so registry lookups resolve.
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
  cardDataSyncedAt: "2026-04-30T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "wave101",
};

const mkGame = (): Game => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xfacefeed00n),
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

const mkManaCostAst = (raw: string): ManaCostAst => {
  const j: ManaCostJSON = ManaCost.parse(raw).toJSON();
  return { raw, symbols: j.symbols };
};

const mkPaper = (name: string, typeLine = "Creature — Bear", manaCostRaw = "1G"): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name,
    oracle: "",
    types: TypeLine.parse(typeLine),
    manaCost: mkManaCostAst(manaCostRaw),
    pt: { power: "2", toughness: "2" },
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  } as CardDefinition,
});

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

// ── Pick 1: shared buildIsPresentGate helper ─────────────────────────────────
describe("Wave 101 — buildIsPresentGate centralises the IsPresent$ family", () => {
  const seat0 = mkPlayerSeat(0);

  it("returns always-true when IsPresent$ is absent", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 9000, paper: mkPaper("Src") });
    const gate = buildIsPresentGate({}, { sourceCardId: src.id, controllerSeat: seat0 });
    expect(gate(g)).toBe(true);
  });

  it("default PresentCompare$ is GE1 — at least one match satisfies", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 9010, paper: mkPaper("Src") });
    mintCard({ game: g, id: 9011, paper: mkPaper("Bear", "Creature — Bear"), seat: 0 });
    const gate = buildIsPresentGate(
      { IsPresent: { kind: "literal", raw: "Creature.YouCtrl" } },
      { sourceCardId: src.id, controllerSeat: seat0 },
    );
    expect(gate(g)).toBe(true);
  });

  it("PresentCompare$ GE3 fails when only two matches exist", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 9020, paper: mkPaper("Src", "Artifact") });
    mintCard({ game: g, id: 9021, paper: mkPaper("Bear A", "Creature — Bear"), seat: 0 });
    mintCard({ game: g, id: 9022, paper: mkPaper("Bear B", "Creature — Bear"), seat: 0 });
    const gate = buildIsPresentGate(
      {
        IsPresent: { kind: "literal", raw: "Creature.YouCtrl" },
        PresentCompare: { kind: "literal", raw: "GE3" },
      },
      { sourceCardId: src.id, controllerSeat: seat0 },
    );
    expect(gate(g)).toBe(false);
  });

  it("PresentZone$ Graveyard scans only the graveyard", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 9030, paper: mkPaper("Src") });
    // BF creature shouldn't count.
    mintCard({ game: g, id: 9031, paper: mkPaper("BF Bear", "Creature — Bear"), seat: 0 });
    // GY creature counts.
    mintCard({
      game: g,
      id: 9032,
      paper: mkPaper("GY Bear", "Creature — Bear"),
      seat: 0,
      zone: ZoneType.Graveyard,
    });
    const gate = buildIsPresentGate(
      {
        IsPresent: { kind: "literal", raw: "Creature.YouCtrl" },
        PresentZone: { kind: "literal", raw: "Graveyard" },
      },
      { sourceCardId: src.id, controllerSeat: seat0 },
    );
    expect(gate(g)).toBe(true);
  });

  it("re-evaluates per query (mutates with the live board)", () => {
    const g = mkGame();
    // Source is non-creature so it doesn't count toward Creature.YouCtrl.
    const src = mintCard({ game: g, id: 9040, paper: mkPaper("Src", "Artifact") });
    // Add a non-creature card on the BF so the gate has to be live-board.
    mintCard({ game: g, id: 9042, paper: mkPaper("Anvil", "Artifact"), seat: 0 });
    const gate = buildIsPresentGate(
      {
        IsPresent: { kind: "literal", raw: "Creature.YouCtrl" },
        PresentCompare: { kind: "literal", raw: "GE2" },
      },
      { sourceCardId: src.id, controllerSeat: seat0 },
    );
    // No creatures → GE2 fails.
    expect(gate(g)).toBe(false);
    // Add 2 creatures → gate satisfies.
    mintCard({ game: g, id: 9041, paper: mkPaper("Bear A", "Creature — Bear"), seat: 0 });
    mintCard({ game: g, id: 9043, paper: mkPaper("Bear B", "Creature — Bear"), seat: 0 });
    expect(gate(g)).toBe(true);
  });
});

// ── Pick 2: SkipUntap honors IsPresent$ ──────────────────────────────────────
describe("Wave 101 — SkipUntap IsPresent$ sub-conditional gate", () => {
  it("untap is skipped only when IsPresent$ is satisfied", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 9100, paper: mkPaper("Stasis-shape") });
    buildAndRegisterStatic(
      g,
      {
        mode: "SkipUntap",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          IsPresent: { kind: "literal", raw: "Land.YouCtrl" },
          PresentCompare: { kind: "literal", raw: "GE5" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      99100,
      0,
    );
    // No lands in play → gate fails → untap step proceeds.
    expect(shouldSkipUntap(g, mkPlayerSeat(0))).toBe(false);
    // Add 5 lands → gate satisfied → untap is skipped.
    for (let i = 0; i < 5; i++) {
      mintCard({ game: g, id: 9110 + i, paper: mkPaper(`Forest ${i}`, "Land"), seat: 0 });
    }
    expect(shouldSkipUntap(g, mkPlayerSeat(0))).toBe(true);
  });

  it("describe() exposes isPresentSatisfied callable for the gate consumer", () => {
    const g = mkGame();
    // Non-creature source so it doesn't count toward Creature.YouCtrl.
    const src = mintCard({ game: g, id: 9120, paper: mkPaper("Src", "Artifact") });
    const stat = buildAndRegisterStatic(
      g,
      {
        mode: "SkipUntap",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          IsPresent: { kind: "literal", raw: "Creature.YouCtrl" },
          PresentCompare: { kind: "literal", raw: "GE2" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      99120,
      0,
    );
    const payload = stat.describe() as SkipUntapPayload;
    expect(payload.kind).toBe("skipUntap");
    expect(typeof payload.isPresentSatisfied).toBe("function");
    expect(payload.isPresentSatisfied(g)).toBe(false); // no creatures yet
  });
});

// ── Pick 3: SkipDraw honors IsPresent$ ───────────────────────────────────────
describe("Wave 101 — SkipDraw IsPresent$ sub-conditional gate", () => {
  it("draw is skipped only when IsPresent$ is satisfied", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 9200, paper: mkPaper("Curse-shape") });
    buildAndRegisterStatic(
      g,
      {
        mode: "SkipDraw",
        params: {
          ValidPlayer: { kind: "literal", raw: "Opponent" },
          IsPresent: { kind: "literal", raw: "Card.Self" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      99200,
      0,
    );
    // Card.Self is on battlefield → IsPresent satisfied → opponent skips draw.
    expect(shouldSkipDraw(g, mkPlayerSeat(1))).toBe(true);
    expect(shouldSkipDraw(g, mkPlayerSeat(0))).toBe(false); // controller seat unaffected
  });

  it("describe() exposes isPresentSatisfied", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 9210, paper: mkPaper("Src") });
    const stat = buildAndRegisterStatic(
      g,
      {
        mode: "SkipDraw",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      src.id as unknown as number,
      99210,
      0,
    );
    const payload = stat.describe() as SkipDrawPayload;
    expect(payload.kind).toBe("skipDraw");
    // No IsPresent$ set → always-true gate.
    expect(payload.isPresentSatisfied(g)).toBe(true);
  });
});

// ── Pick 4: FlipCoinMod Reflip$ payload ──────────────────────────────────────
describe("Wave 101 — FlipCoinMod Reflip$ True surfaces reflip-on-loss", () => {
  it("Reflip$ True flips flipCoinModifier into 'reflip-on-loss' mode", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 9300, paper: mkPaper("Krark's Other Thumb") });
    buildAndRegisterStatic(
      g,
      {
        mode: "FlipCoinMod",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Reflip: { kind: "literal", raw: "True" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      99300,
      0,
    );
    expect(flipCoinModifier(g, mkPlayerSeat(0)).mode).toBe("reflip-on-loss");
    // Opponent unaffected.
    expect(flipCoinModifier(g, mkPlayerSeat(1)).mode).toBe("default");
  });

  it("DoubleFlip$ wins when both DoubleFlip$ and Reflip$ are granted", () => {
    const g = mkGame();
    const krark = mintCard({ game: g, id: 9310, paper: mkPaper("Krark's Thumb") });
    const otherKrark = mintCard({ game: g, id: 9311, paper: mkPaper("Krark's Other Thumb") });
    buildAndRegisterStatic(
      g,
      {
        mode: "FlipCoinMod",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          DoubleFlip: { kind: "literal", raw: "True" },
        },
        activeInZones: [],
      },
      krark.id as unknown as number,
      99310,
      0,
    );
    buildAndRegisterStatic(
      g,
      {
        mode: "FlipCoinMod",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Reflip: { kind: "literal", raw: "True" },
        },
        activeInZones: [],
      },
      otherKrark.id as unknown as number,
      99311,
      0,
    );
    expect(flipCoinModifier(g, mkPlayerSeat(0)).mode).toBe("double-flip-pick");
  });

  it("describe() exposes the reflip flag verbatim", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 9320, paper: mkPaper("Src") });
    const stat = buildAndRegisterStatic(
      g,
      {
        mode: "FlipCoinMod",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Reflip: { kind: "literal", raw: "True" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      99320,
      0,
    );
    const payload = stat.describe() as FlipCoinModPayload;
    expect(payload.reflip).toBe(true);
    expect(payload.doubleFlip).toBe(false);
  });
});

// ── Pick 5: CantPutCounter player-subject filter ─────────────────────────────
describe("Wave 101 — CantPutCounter ValidPlayer$ drives canPutCounterOnPlayer", () => {
  it("ValidPlayer$ You + CounterType$ Poison blocks poison on controller seat", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 9400, paper: mkPaper("Phyrexian Unlife") });
    buildAndRegisterStatic(
      g,
      {
        mode: "CantPutCounter",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          CounterType: { kind: "literal", raw: "Poison" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      99400,
      0,
    );
    // Controller's poison is blocked.
    expect(canPutCounterOnPlayer(g, mkPlayerSeat(0), CounterType.Poison)).toBe(false);
    // Opponent's poison remains addable (their canonical mechanic).
    expect(canPutCounterOnPlayer(g, mkPlayerSeat(1), CounterType.Poison)).toBe(true);
    // Different counter types unaffected.
    expect(canPutCounterOnPlayer(g, mkPlayerSeat(0), CounterType.Energy)).toBe(true);
  });

  it("describe() exposes hasPlayerSubject + playerMatches", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 9410, paper: mkPaper("Solphim") });
    const stat = buildAndRegisterStatic(
      g,
      {
        mode: "CantPutCounter",
        params: {
          ValidPlayer: { kind: "literal", raw: "Opponent" },
          CounterType: { kind: "literal", raw: "Any" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      99410,
      0,
    );
    const payload = stat.describe() as CantPutCounterPayload;
    expect(payload.hasPlayerSubject).toBe(true);
    expect(payload.playerMatches(mkPlayerSeat(1))).toBe(true);
    expect(payload.playerMatches(mkPlayerSeat(0))).toBe(false);
  });

  it("player-subject static does NOT bleed into the card-side gate", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 9420, paper: mkPaper("Phyrexian Unlife") });
    const target = mintCard({ game: g, id: 9421, paper: mkPaper("Some Creature"), seat: 0 });
    buildAndRegisterStatic(
      g,
      {
        mode: "CantPutCounter",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          CounterType: { kind: "literal", raw: "Poison" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      99420,
      0,
    );
    // Card-side gate ignores the player-subject static (Wave 101 disjoint
    // contract). Poison-on-card still allowed.
    expect(canPutCounter(g, target.id, CounterType.Poison)).toBe(true);
  });

  it("default static (no ValidPlayer$) preserves the Wave-60 card-side gate", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 9430, paper: mkPaper("Solemnity") });
    const target = mintCard({ game: g, id: 9431, paper: mkPaper("Some Creature"), seat: 0 });
    buildAndRegisterStatic(
      g,
      {
        mode: "CantPutCounter",
        params: {
          ValidCard: { kind: "literal", raw: "Card.YouCtrl" },
          CounterType: { kind: "literal", raw: "Any" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      99430,
      0,
    );
    // Card-side gate still fires.
    expect(canPutCounter(g, target.id, CounterType.PlusOnePlusOne)).toBe(false);
    // Player-side gate doesn't (no player subject).
    expect(canPutCounterOnPlayer(g, mkPlayerSeat(0), CounterType.Poison)).toBe(true);
  });
});

// ── Pick 6: CanExhaust honors PlayerTurn$ ────────────────────────────────────
describe("Wave 101 — CanExhaust PlayerTurn$ filter scopes the modifier to a turn", () => {
  it("PlayerTurn$ You — gate fires only on controller's own turn", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 9500, paper: mkPaper("Elvish Refueler") });
    buildAndRegisterStatic(
      g,
      {
        mode: "CanExhaust",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          PlayerTurn: { kind: "literal", raw: "You" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      99500,
      0,
    );
    // Active player is seat 0 by default → on controller's turn → gate is open.
    g.activePlayer = mkPlayerSeat(0);
    expect(canReExhaust(g, mkPlayerSeat(0))).toBe(true);
    // Switch to opponent's turn → PlayerTurn$ You no longer matches → gate closed.
    g.activePlayer = mkPlayerSeat(1);
    expect(canReExhaust(g, mkPlayerSeat(0))).toBe(false);
  });

  it("describe() exposes turnMatches callable", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 9510, paper: mkPaper("Src") });
    const stat = buildAndRegisterStatic(
      g,
      {
        mode: "CanExhaust",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          PlayerTurn: { kind: "literal", raw: "Opponent" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      99510,
      0,
    );
    const payload = stat.describe() as CanExhaustPayload;
    expect(payload.kind).toBe("canExhaust");
    expect(typeof payload.turnMatches).toBe("function");
    // Active = seat 0 (= controller); PlayerTurn$ Opponent → predicate
    // expects active != controller → false here.
    g.activePlayer = mkPlayerSeat(0);
    expect(payload.turnMatches(g)).toBe(false);
    g.activePlayer = mkPlayerSeat(1);
    expect(payload.turnMatches(g)).toBe(true);
  });

  it("absent PlayerTurn$ leaves the gate always-true (Wave 75 default)", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 9520, paper: mkPaper("Src") });
    buildAndRegisterStatic(
      g,
      {
        mode: "CanExhaust",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      src.id as unknown as number,
      99520,
      0,
    );
    g.activePlayer = mkPlayerSeat(0);
    expect(canReExhaust(g, mkPlayerSeat(0))).toBe(true);
    g.activePlayer = mkPlayerSeat(1);
    expect(canReExhaust(g, mkPlayerSeat(0))).toBe(true); // still true with no PlayerTurn$
  });
});
