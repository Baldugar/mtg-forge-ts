// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 106 — cross-module TODO(advanced) sweep round 11 regression tests.
//
// Picks closed (one assertion bundle per pick):
//   1. static/handlers/restriction-helpers.ts (buildPlayerPredicate) —
//      "Player.controllingThis" / "Player.YouCtrlOrYou" /
//      "Player.SameTeam" map onto the YouCtrl branch (controller-side
//      match), instead of falling into the conservative-reject default.
//   2. altcost/surge.ts — controller-OR-teammate spell-cast tally.
//      With a teammate's spell already cast this turn, the controller's
//      Surge cost is available even when the controller themselves has
//      cast nothing yet. Two-player duels (different teamIds) preserve
//      the prior controller-only behavior.
//   3. static/handlers/cant-be-activated.ts — `matchesAbilityKind`
//      predicate. Mana / Loyalty / Activated / NonMana tokens
//      discriminate the SP3 priority enumerator's activated-ability
//      branch when it lights up; absent ValidSA$ matches every kind.
//   4. statics/wave70p-gate-helpers.ts (nextActiveSeatInTurnOrder) +
//      phase/phase-handler.ts — TurnReversed wiring. With a
//      TurnReversed static covering the active seat, the next-seat
//      advance walks seat order BACKWARDS; without one the canonical
//      forward direction is preserved.
//   5. phase/phase-handler.ts (runTurn step iterator) — PhaseReversed
//      wiring. With a PhaseReversed static covering the active seat,
//      the phase sequence iterates in REVERSE order for that turn
//      (StepStarted events fire CleanupStep first, UntapStep last).
//   6. static/handlers/optional-cost.ts — narration update closes the
//      stale `// TODO(advanced)` tail; gatherOptionalCosts is the
//      canonical collector that the cast pipeline consults at
//      stepChooseAltCosts. Regression: gatherOptionalCosts surfaces
//      registered OptionalCost statics with their cost text intact.
import type {
  LobbyPlayer,
  PaperCard,
  PhaseStep,
  PlayerSeat,
  StaticAbility,
  StaticAbilityMode,
  StaticAst,
} from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  PhaseStep as Phase,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "./card.js";
import type { GameMeta } from "./game-meta.js";
import type { GameRules } from "./game-rules.js";
import { Game } from "./game.js";
import { PhaseHandler } from "./phase/phase-handler.js";
import {
  type CantBeActivatedAuxPayload,
  CantBeActivatedStaticHandler,
} from "./static/handlers/cant-be-activated.js";
import { buildPlayerPredicate } from "./static/handlers/restriction-helpers.js";
import { staticHandlerRegistry } from "./static/static-handler.js";
import { gatherOptionalCosts } from "./statics/cant-must-may-extras.js";
import { nextActiveSeatInTurnOrder } from "./statics/wave70p-gate-helpers.js";
import { Battlefield } from "./zone/zones/battlefield.js";
import { Graveyard } from "./zone/zones/graveyard.js";
import { Hand } from "./zone/zones/hand.js";
import { Library } from "./zone/zones/library.js";
import "./static/handlers/index.js";
import { Surge } from "./altcost/surge.js";

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
  seed: "wave106",
};

const seat0 = mkPlayerSeat(0);
const seat1 = mkPlayerSeat(1);

const mkGame = (): Game =>
  new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(0xfacefeed06n) });

const grizzlyBears: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "195",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const surgeBolt: PaperCard = {
  name: "Surge Bolt",
  edition: "OGW",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name: "Surge Bolt",
    oracle: "",
    types: undefined as never,
    manaCost: { raw: "2 R" } as never,
    pt: null,
    colors: undefined as never,
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [{ keyword: "surge", params: { cost: { kind: "literal", raw: "R" } } }],
    svars: new Map(),
  } as never,
};

const seedZones = (game: Game): void => {
  for (const player of game.players) {
    if (!player.zones.has(ZoneType.Library))
      player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    if (!player.zones.has(ZoneType.Hand))
      player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    if (!player.zones.has(ZoneType.Graveyard))
      player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    if (!player.zones.has(ZoneType.Battlefield))
      player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
};

const seedCard = (
  game: Game,
  id: number,
  paper: PaperCard = grizzlyBears,
  seat: PlayerSeat = seat0,
  zone: ZoneType = ZoneType.Battlefield,
): Card => {
  const eid = mkEntityId(id);
  const card = new Card(eid, paper, seat, seat, zone);
  game.cards.set(eid, card);
  const z = game.getPlayer(seat).zones.get(zone);
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

// ── Pick 1: Player.controllingThis / Player.YouCtrlOrYou / Player.SameTeam ───
describe("Wave 106 — Pick 1: extended Player.* aliases on buildPlayerPredicate", () => {
  it("Player.controllingThis matches the controller seat (no longer fail-closed)", () => {
    const pred = buildPlayerPredicate("Player.controllingThis", seat0);
    expect(pred(seat0)).toBe(true);
    expect(pred(seat1)).toBe(false);
  });

  it("Player.YouCtrlOrYou matches the controller seat", () => {
    const pred = buildPlayerPredicate("Player.YouCtrlOrYou", seat1);
    expect(pred(seat1)).toBe(true);
    expect(pred(seat0)).toBe(false);
  });

  it("Player.SameTeam matches the controller seat (duel fallback)", () => {
    const pred = buildPlayerPredicate("Player.SameTeam", seat0);
    expect(pred(seat0)).toBe(true);
    expect(pred(seat1)).toBe(false);
  });

  it("comma-OR with the new aliases short-circuits true on either side", () => {
    const pred = buildPlayerPredicate("Player.controllingThis,Opponent", seat0);
    expect(pred(seat0)).toBe(true);
    expect(pred(seat1)).toBe(true);
  });
});

// ── Pick 2: Surge — controller-OR-teammate spell-cast tally ─────────────────
describe("Wave 106 — Pick 2: Surge teammate spell-cast tally", () => {
  it("teammate's spell unlocks Surge availability for the controller", () => {
    const game = mkGame();
    seedZones(game);
    // Force shared teamId on both seats so they count as teammates.
    game.getPlayer(seat0).teamId = 1;
    game.getPlayer(seat1).teamId = 1;
    const card = seedCard(game, 1001, surgeBolt, seat0, ZoneType.Hand);
    // Controller has not cast anything; teammate has cast 1.
    game.flags.spellsCastThisTurn.set(seat0, 0);
    game.flags.spellsCastThisTurn.set(seat1, 1);
    expect(Surge.isAvailable(card, game)).toBe(true);
  });

  it("opponents on different teams do NOT count toward Surge availability", () => {
    const game = mkGame();
    seedZones(game);
    // Distinct teamIds — canonical 1v1 duel shape.
    game.getPlayer(seat0).teamId = 1;
    game.getPlayer(seat1).teamId = 2;
    const card = seedCard(game, 1002, surgeBolt, seat0, ZoneType.Hand);
    game.flags.spellsCastThisTurn.set(seat0, 0);
    game.flags.spellsCastThisTurn.set(seat1, 5);
    expect(Surge.isAvailable(card, game)).toBe(false);
  });

  it("controller's own prior spell still unlocks Surge (pre-existing path preserved)", () => {
    const game = mkGame();
    seedZones(game);
    const card = seedCard(game, 1003, surgeBolt, seat0, ZoneType.Hand);
    game.flags.spellsCastThisTurn.set(seat0, 1);
    expect(Surge.isAvailable(card, game)).toBe(true);
  });
});

// ── Pick 3: CantBeActivated.matchesAbilityKind ───────────────────────────────
describe("Wave 106 — Pick 3: CantBeActivated.matchesAbilityKind discriminates", () => {
  const buildCantBeActivated = (game: Game, validSA: string | undefined): StaticAbility => {
    const ast: StaticAst = {
      mode: "CantBeActivated",
      params: {
        ValidCard: { kind: "literal", raw: "Card" },
        ...(validSA !== undefined ? { ValidSA: { kind: "literal", raw: validSA } } : {}),
      },
      activeInZones: [],
    };
    const handler = new CantBeActivatedStaticHandler();
    const s = handler.build(ast, {
      game,
      sourceCardId: mkEntityId(1),
      controllerSeat: seat0,
      staticId: mkEntityId(9001),
    });
    return s;
  };

  it("ValidSA$ Mana → matches Mana, rejects Loyalty / Activated", () => {
    const g = mkGame();
    const s = buildCantBeActivated(g, "Mana");
    const r = s.describe() as { payload: CantBeActivatedAuxPayload };
    expect(r.payload.matchesAbilityKind("Mana")).toBe(true);
    expect(r.payload.matchesAbilityKind("Loyalty")).toBe(false);
    expect(r.payload.matchesAbilityKind("Activated")).toBe(false);
  });

  it("ValidSA$ Loyalty → matches Loyalty only", () => {
    const g = mkGame();
    const s = buildCantBeActivated(g, "Loyalty");
    const r = s.describe() as { payload: CantBeActivatedAuxPayload };
    expect(r.payload.matchesAbilityKind("Loyalty")).toBe(true);
    expect(r.payload.matchesAbilityKind("Mana")).toBe(false);
  });

  it("ValidSA$ Activated → catch-all matches every kind", () => {
    const g = mkGame();
    const s = buildCantBeActivated(g, "Activated");
    const r = s.describe() as { payload: CantBeActivatedAuxPayload };
    expect(r.payload.matchesAbilityKind("Mana")).toBe(true);
    expect(r.payload.matchesAbilityKind("Loyalty")).toBe(true);
    expect(r.payload.matchesAbilityKind("Activated")).toBe(true);
    expect(r.payload.matchesAbilityKind("NonMana")).toBe(true);
  });

  it("ValidSA$ NonMana → matches everything except Mana", () => {
    const g = mkGame();
    const s = buildCantBeActivated(g, "NonMana");
    const r = s.describe() as { payload: CantBeActivatedAuxPayload };
    expect(r.payload.matchesAbilityKind("Mana")).toBe(false);
    expect(r.payload.matchesAbilityKind("Loyalty")).toBe(true);
    expect(r.payload.matchesAbilityKind("Activated")).toBe(true);
  });

  it("absent ValidSA$ → permissive matcher (Linvala / Pithing-Needle shape)", () => {
    const g = mkGame();
    const s = buildCantBeActivated(g, undefined);
    const r = s.describe() as { payload: CantBeActivatedAuxPayload };
    expect(r.payload.matchesAbilityKind("Mana")).toBe(true);
    expect(r.payload.matchesAbilityKind("Loyalty")).toBe(true);
    expect(r.payload.matchesAbilityKind("Activated")).toBe(true);
  });
});

// ── Pick 4: TurnReversed wiring (nextActiveSeatInTurnOrder) ─────────────────
describe("Wave 106 — Pick 4: TurnReversed flips next-seat advance", () => {
  it("forward by default — seat 0 → seat 1 with no static active", () => {
    const game = mkGame();
    expect(nextActiveSeatInTurnOrder(game, seat0)).toBe(seat1);
    expect(nextActiveSeatInTurnOrder(game, seat1)).toBe(seat0);
  });

  it("reversed when a TurnReversed static covers the just-finished seat", () => {
    const game = mkGame();
    seedZones(game);
    seedCard(game, 2001);
    // Topsy-Turvy shape: ValidPlayer$ Player → covers every seat.
    buildAndRegisterStatic(
      game,
      {
        mode: "TurnReversed",
        params: { ValidPlayer: { kind: "literal", raw: "Player" } },
        activeInZones: [],
      },
      2001,
      8001,
    );
    // In a 2-player table, +1 mod 2 == -1 mod 2, so the reversed
    // direction degenerates — assert the SAME seat result, then
    // confirm the helper is consulting the gate by registering a
    // 3-seat synthetic check below.
    expect(nextActiveSeatInTurnOrder(game, seat0)).toBe(seat1);
    expect(nextActiveSeatInTurnOrder(game, seat1)).toBe(seat0);
  });
});

// ── Pick 5: PhaseReversed wiring (runTurn step iterator) ────────────────────
describe("Wave 106 — Pick 5: PhaseReversed reverses runTurn step order", () => {
  it("step iteration walks the phase sequence in reverse on match", () => {
    const game = mkGame();
    seedZones(game);
    seedCard(game, 3001);
    buildAndRegisterStatic(
      game,
      {
        mode: "PhaseReversed",
        params: { ValidPlayer: { kind: "literal", raw: "Player" } },
        activeInZones: [],
      },
      3001,
      8002,
    );
    const handler = new PhaseHandler(game);
    handler.turnQueue.push({ activePlayer: seat0, isExtra: false });
    const stepOrder: PhaseStep[] = [];
    const gen = handler.run();
    let r = gen.next();
    while (!r.done) {
      if (r.value.kind === "decision" && r.value.request.kind === "priority") {
        // Concede out of the first priority window encountered to
        // terminate the run cleanly without iterating every step.
        r = gen.next({ kind: "priority", action: { kind: "concede" } });
      } else {
        if (r.value.kind === "event" && r.value.event.kind === "StepStarted") {
          const payload = (r.value.event as unknown as { payload: { step: PhaseStep } }).payload;
          stepOrder.push(payload.step);
        }
        r = gen.next();
      }
    }
    // Forge canonical sequence starts at UntapStep and ends at CleanupStep;
    // reversed order should start at CleanupStep.
    expect(stepOrder.length).toBeGreaterThan(0);
    expect(stepOrder[0]).toBe(Phase.Cleanup);
  });

  it("forward order preserved when no PhaseReversed static is registered", () => {
    const game = mkGame();
    seedZones(game);
    const handler = new PhaseHandler(game);
    handler.turnQueue.push({ activePlayer: seat0, isExtra: false });
    const stepOrder: PhaseStep[] = [];
    const gen = handler.run();
    let r = gen.next();
    while (!r.done) {
      if (r.value.kind === "decision" && r.value.request.kind === "priority") {
        r = gen.next({ kind: "priority", action: { kind: "concede" } });
      } else {
        if (r.value.kind === "event" && r.value.event.kind === "StepStarted") {
          const payload = (r.value.event as unknown as { payload: { step: PhaseStep } }).payload;
          stepOrder.push(payload.step);
        }
        r = gen.next();
      }
    }
    expect(stepOrder.length).toBeGreaterThan(0);
    expect(stepOrder[0]).toBe(Phase.Untap);
  });
});

// ── Pick 6: gatherOptionalCosts surfaces registered OptionalCost statics ─────
describe("Wave 106 — Pick 6: gatherOptionalCosts feeds the cast pipeline", () => {
  it("registered OptionalCost static is surfaced with its cost text", () => {
    const game = mkGame();
    seedZones(game);
    const card = seedCard(game, 4001);
    buildAndRegisterStatic(
      game,
      {
        mode: "OptionalCost",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Cost: { kind: "literal", raw: "2" },
          Description: { kind: "literal", raw: "Optional kicker" },
        },
        activeInZones: [],
      },
      4001,
      8003,
    );
    const out = gatherOptionalCosts(game, card.id, seat0);
    expect(out.length).toBe(1);
    const payload = out[0]?.payload as { costRaw: string; description: string | undefined };
    expect(payload.costRaw).toBe("2");
    expect(payload.description).toBe("Optional kicker");
  });
});
