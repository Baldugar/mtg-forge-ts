// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 98 — cross-module TODO(advanced) sweep round 3 regression tests.
//
// Picks closed (one assertion bundle per pick):
//   1. phase/phase-handler.ts  — Cleanup CR 514.1 discard now yields a
//      chooseCard decision (interactive "which N to discard" pick) when
//      the active seat's hand exceeds maxHandSize. The driver answers
//      with an explicit subset; the engine validates the subset is in
//      the snapshotted hand and applies the canonical discard.
//   2. combat/combat-handler.ts — must-block "if able" now respects tap
//      state. A tapped Provoke-target is NOT pulled in (CR 509.1a) unless
//      a BlockTapped static grants the carve-out.
//   3. dnd/initiative-tracker.ts — opponentOf skips eliminated seats so
//      multiplayer dungeon-room "another player" lookups don't land on a
//      dead seat. Falls back to any non-self seat when no live opponent.
//   4. trigger/handlers/wave-18-triggers.ts — FullyUnlockTrigger fires
//      ONLY on the door-open that completes the room (LAST unlock).
//      Single-door rooms fire on the lone open; two-door rooms fire only
//      on the second open.
//   5. layers/base-characteristics.ts — ChangeText now rewrites the
//      effective rules text alongside the color/subtype set swaps. Both
//      casings of color words are rewritten; type words are Title-Case.
//   6. svar/selectors/card-state.ts + ability/effects/crew.ts — CrewEffect
//      now stamps the canonical `crewedBy` readonly array on the Vehicle;
//      Count$CrewSize reads it directly. EOT cleanup clears the slot.
import type {
  CardDefinition,
  EntityId,
  GameEvent,
  LobbyPlayer,
  ManaCostAst,
  ManaCostJSON,
  PaperCard,
  PlayerSeat,
  StaticAbility,
  StaticAbilityMode,
  StaticAst,
  TriggerAst,
} from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  ManaCost,
  PhaseStep,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "./card.js";
import { CombatHandler } from "./combat/combat-handler.js";
import { applyUndercityRoomEffect } from "./dnd/initiative-tracker.js";
import type { GameMeta } from "./game-meta.js";
import type { GameRules } from "./game-rules.js";
import { Game } from "./game.js";
import { PhaseHandler } from "./phase/phase-handler.js";
import { staticHandlerRegistry } from "./static/static-handler.js";
import { evaluateExpression } from "./svar/evaluator.js";
import { triggerHandlerRegistry } from "./trigger/trigger-handler-registry.js";
import { Battlefield } from "./zone/zones/battlefield.js";
import { Exile } from "./zone/zones/exile.js";
import { Graveyard } from "./zone/zones/graveyard.js";
import { Hand } from "./zone/zones/hand.js";
import { Library } from "./zone/zones/library.js";
// Side-effect: register every handler so lookups inside Game() resolve.
import "./ability/effects/index.js";
import "./static/handlers/index.js";
import "./trigger/handlers/index.js";
import "./svar/selectors/card-state.js";

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
  seed: "wave98",
};

const mkGame = (): Game => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xfeedfacen),
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

const mkPaper = (name: string, typeLine = "Creature — Bear", oracle = "", manaCostRaw = "1G"): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name,
    oracle,
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

// ── Pick 1: phase/phase-handler.ts — Cleanup chooseCard ──────────────────────
describe("Wave 98 — Cleanup discard via chooseCard decision", () => {
  it("yields chooseCard with min=max=overflow when hand exceeds maxHandSize", () => {
    const g = mkGame();
    const seat = mkPlayerSeat(0);
    g.startingPlayer = seat;
    // Seed the active seat's hand with 9 cards (overflow = 9 - 7 = 2).
    const handIds: EntityId[] = [];
    for (let i = 0; i < 9; i++) {
      const id = mkEntityId(9810 + i);
      handIds.push(id);
      g.cards.set(id, new Card(id, mkPaper(`H${i}`, "Creature — Bear"), seat, seat, ZoneType.Hand));
      g.getPlayer(seat).zones.get(ZoneType.Hand)?.add(id);
    }
    const handler = new PhaseHandler(g);
    handler.turnQueue.push({ activePlayer: seat, isExtra: false });

    const gen = handler.run();
    let observedRequest: { min: number; max: number; pool: readonly EntityId[] } | null = null;
    let chooseCardAnswered = false;
    let next = gen.next();
    let safety = 0;
    while (!next.done) {
      safety++;
      if (safety > 5000) throw new Error("runaway");
      if (next.value.kind === "decision") {
        const req = next.value.request;
        if (req.kind === "chooseCard") {
          observedRequest = { min: req.min, max: req.max, pool: req.pool };
          // Pick the LAST 2 ids — proves the chooser's selection (not
          // front-first auto-pick) is honored.
          const chosen = handIds.slice(7);
          next = gen.next({ kind: "chooseCard", chosen });
          chooseCardAnswered = true;
          continue;
        }
        if (req.kind === "priority") {
          next = gen.next({ kind: "priority", action: { kind: "pass" } });
          continue;
        }
        // Any other decision is unexpected for this fixture.
        throw new Error(`unexpected request kind: ${req.kind}`);
      }
      next = gen.next();
    }
    expect(observedRequest).not.toBeNull();
    expect(observedRequest?.min).toBe(2);
    expect(observedRequest?.max).toBe(2);
    expect(observedRequest?.pool).toEqual(handIds);
    expect(chooseCardAnswered).toBe(true);
    // The chosen LAST 2 ids are now in the graveyard; the FIRST 7 stayed
    // in hand (the front-first auto-pick would have done the opposite).
    const handAfter = g.getPlayer(seat).zones.get(ZoneType.Hand)?.toArray() ?? [];
    expect(handAfter).toEqual(handIds.slice(0, 7));
    const gy = g.getPlayer(seat).zones.get(ZoneType.Graveyard)?.toArray() ?? [];
    expect(new Set(gy)).toEqual(new Set(handIds.slice(7)));
  });

  it("falls back to front-first auto-pick when controller returns mismatched length", () => {
    const g = mkGame();
    const seat = mkPlayerSeat(0);
    g.startingPlayer = seat;
    const handIds: EntityId[] = [];
    for (let i = 0; i < 8; i++) {
      const id = mkEntityId(9830 + i);
      handIds.push(id);
      g.cards.set(id, new Card(id, mkPaper(`H${i}`, "Creature — Bear"), seat, seat, ZoneType.Hand));
      g.getPlayer(seat).zones.get(ZoneType.Hand)?.add(id);
    }
    const handler = new PhaseHandler(g);
    handler.turnQueue.push({ activePlayer: seat, isExtra: false });

    const gen = handler.run();
    let next = gen.next();
    let safety = 0;
    while (!next.done) {
      safety++;
      if (safety > 5000) throw new Error("runaway");
      if (next.value.kind === "decision") {
        const req = next.value.request;
        if (req.kind === "chooseCard") {
          // Return EMPTY chosen — length mismatch — engine must fall
          // back to front-first.
          next = gen.next({ kind: "chooseCard", chosen: [] });
          continue;
        }
        if (req.kind === "priority") {
          next = gen.next({ kind: "priority", action: { kind: "pass" } });
          continue;
        }
        throw new Error(`unexpected request kind: ${req.kind}`);
      }
      next = gen.next();
    }
    // Front-first fallback: the FIRST card was discarded.
    const handAfter = g.getPlayer(seat).zones.get(ZoneType.Hand)?.toArray() ?? [];
    expect(handAfter).toEqual(handIds.slice(1));
    const gy = g.getPlayer(seat).zones.get(ZoneType.Graveyard)?.toArray() ?? [];
    expect(gy).toEqual([handIds[0]]);
  });
});

// ── Pick 2: combat/combat-handler.ts — must-block tap state gate ─────────────
describe("Wave 98 — must-block 'if able' respects tap state", () => {
  it("tapped must-block subject is NOT pulled in", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const attacker = mintCard({ game: g, id: 9001, paper: mkPaper("Hill Giant"), seat: 0 });
    const blocker = mintCard({ game: g, id: 9002, paper: mkPaper("Tapped Bear"), seat: 1 });
    blocker.tapped = true;
    buildAndRegisterStatic(
      g,
      {
        mode: "MustBlock",
        params: { ValidCreature: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      blocker.id as unknown as number,
      99002,
      1,
    );
    const handler = new CombatHandler(g);
    handler.declareAttackers([{ attackerId: attacker.id, defender: { kind: "player", seat: seat1 } }]);
    handler.declareBlockers([]);
    // Tapped creature is filtered out by the new "if able" tap-state gate.
    expect(handler.state.blockers.has(blocker.id)).toBe(false);
    void seat0;
  });

  it("untapped must-block subject IS pulled in (control)", () => {
    const g = mkGame();
    const seat1 = mkPlayerSeat(1);
    const attacker = mintCard({ game: g, id: 9011, paper: mkPaper("Hill Giant"), seat: 0 });
    const blocker = mintCard({ game: g, id: 9012, paper: mkPaper("Untapped Bear"), seat: 1 });
    blocker.tapped = false;
    buildAndRegisterStatic(
      g,
      {
        mode: "MustBlock",
        params: { ValidCreature: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      blocker.id as unknown as number,
      99012,
      1,
    );
    const handler = new CombatHandler(g);
    handler.declareAttackers([{ attackerId: attacker.id, defender: { kind: "player", seat: seat1 } }]);
    handler.declareBlockers([]);
    expect(handler.state.blockers.has(blocker.id)).toBe(true);
  });
});

// ── Pick 3: dnd/initiative-tracker.ts — opponentOf skips eliminated ──────────
describe("Wave 98 — opponentOf skips eliminated seats", () => {
  it("Trap! room (room 4) routes 5-life-loss away from the eliminated opponent", () => {
    // 2-player fixture; mark seat 1 as eliminated. The Trap! room (room 4)
    // calls opponentOf(seat0) — pre-Wave-98 this returned seat 1
    // unconditionally; post-Wave-98 it skips eliminated seats and falls
    // back to seat 0 itself when no live opponent exists. The 5-life-loss
    // is therefore applied to seat 0 (the fallback) rather than the dead
    // seat 1, so seat 1's life total stays untouched.
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const me = g.getPlayer(seat0);
    const opp = g.getPlayer(seat1);
    const meLifeBefore = me.life;
    const oppLifeBefore = opp.life;
    opp.hasLost = true;
    // Drain the generator (we don't care about yielded events for this
    // assertion — only the final life totals).
    for (const _ of applyUndercityRoomEffect(g, seat0, 4)) {
      void _;
    }
    // Seat 1 is eliminated → its life total must not be reduced by Trap!.
    expect(opp.life).toBe(oppLifeBefore);
    // The fallback routes the 5-life-loss to seat 0 itself.
    expect(me.life).toBe(meLifeBefore - 5);
  });

  it("opponentOf still returns the live opponent when seat 1 is alive (control)", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const me = g.getPlayer(seat0);
    const opp = g.getPlayer(seat1);
    const meLifeBefore = me.life;
    const oppLifeBefore = opp.life;
    // Seat 1 is alive — Trap! deals 5 to seat 1 (canonical path).
    for (const _ of applyUndercityRoomEffect(g, seat0, 4)) {
      void _;
    }
    expect(me.life).toBe(meLifeBefore);
    expect(opp.life).toBe(oppLifeBefore - 5);
  });
});

// ── Pick 4: trigger/handlers/wave-18-triggers.ts — FullyUnlock LAST unlock ──
describe("Wave 98 — FullyUnlockTrigger fires only on the LAST unlock", () => {
  it("two-door room: trigger does NOT fire on the FIRST door-open", () => {
    const g = mkGame();
    const room = mintCard({
      game: g,
      id: 9200,
      paper: mkPaper("Two-Door Room", "Enchantment — Room"),
      seat: 0,
    });
    // Two-door room: stamp printedDoors so the gate evaluates with two doors.
    (room as unknown as { printedDoors?: readonly string[] }).printedDoors = ["front", "back"];
    // Build a FullyUnlockTrigger.
    const Cls = triggerHandlerRegistry.lookup("FullyUnlock");
    if (!Cls) throw new Error("FullyUnlock not registered");
    const ta = new Cls().build(
      { mode: "FullyUnlock", params: {}, effect: { handlerKey: "ChangeZone" } } as unknown as TriggerAst,
      {
        game: g,
        sourceCardId: room.id,
        controllerSeat: mkPlayerSeat(0),
        triggerId: mkEntityId(99200),
      },
    );
    // Simulate UnlockDoorEffect's pre-event mutation: open ONLY the front
    // door, then synthesize the DoorOpened event.
    (room as unknown as { unlockedDoors?: Set<string> }).unlockedDoors = new Set(["front"]);
    const partialOpenEvent: GameEvent = {
      kind: "DoorOpened",
      version: 1,
      turn: 1,
      phase: PhaseStep.Main1,
      payload: { cardId: room.id, doorId: "front" },
    } as unknown as GameEvent;
    expect(ta.matches(partialOpenEvent)).toBe(false);
    // Now open the back door — the room is fully unlocked at observation
    // time, so the trigger fires.
    (room as unknown as { unlockedDoors?: Set<string> }).unlockedDoors = new Set(["front", "back"]);
    const lastOpenEvent: GameEvent = {
      kind: "DoorOpened",
      version: 1,
      turn: 1,
      phase: PhaseStep.Main1,
      payload: { cardId: room.id, doorId: "back" },
    } as unknown as GameEvent;
    expect(ta.matches(lastOpenEvent)).toBe(true);
  });

  it("single-door room: trigger fires on the lone open", () => {
    const g = mkGame();
    const room = mintCard({ game: g, id: 9210, paper: mkPaper("OTJ Door", "Enchantment — Door"), seat: 0 });
    // Single-door room: printedDoors = ["front"].
    (room as unknown as { printedDoors?: readonly string[] }).printedDoors = ["front"];
    const Cls = triggerHandlerRegistry.lookup("FullyUnlock");
    if (!Cls) throw new Error("FullyUnlock not registered");
    const ta = new Cls().build(
      { mode: "FullyUnlock", params: {}, effect: { handlerKey: "ChangeZone" } } as unknown as TriggerAst,
      {
        game: g,
        sourceCardId: room.id,
        controllerSeat: mkPlayerSeat(0),
        triggerId: mkEntityId(99210),
      },
    );
    (room as unknown as { unlockedDoors?: Set<string> }).unlockedDoors = new Set(["front"]);
    const ev: GameEvent = {
      kind: "DoorOpened",
      version: 1,
      turn: 1,
      phase: PhaseStep.Main1,
      payload: { cardId: room.id, doorId: "front" },
    } as unknown as GameEvent;
    expect(ta.matches(ev)).toBe(true);
  });
});

// ── Pick 5: layers/base-characteristics.ts — ChangeText rules-text rewrite ──
describe("Wave 98 — ChangeText rewrites effective rulesText", () => {
  it("color word swap rewrites both casings of the word in rules text", () => {
    const g = mkGame();
    const card = mintCard({
      game: g,
      id: 9300,
      paper: mkPaper(
        "Test Card",
        "Creature — Bear",
        "Deals damage to target white creature. Protection from White.",
      ),
      seat: 0,
    });
    // Sanity: pre-textChange rules text is the printed oracle.
    const pre = g.layerEngine.computeCharacteristics(card.id);
    expect(pre.rulesText).toContain("white creature");
    expect(pre.rulesText).toContain("Protection from White");
    // Apply a ChangeText rule: White → Black.
    card.textChanges.push({ kind: "color", from: "White", to: "Black" });
    g.layerEngine.bumpEpoch("test-textChange");
    const post = g.layerEngine.computeCharacteristics(card.id);
    // Both casings rewritten.
    expect(post.rulesText).toContain("black creature");
    expect(post.rulesText).toContain("Protection from Black");
    // Original word fully gone (no partial-match leak: "whitelist" would
    // be safe but we don't have one in the oracle here).
    expect(post.rulesText).not.toContain("white creature");
    expect(post.rulesText).not.toContain("Protection from White");
  });

  it("type word swap rewrites Title-Case subtype in rules text", () => {
    const g = mkGame();
    const card = mintCard({
      game: g,
      id: 9310,
      paper: mkPaper("Goblin Lord", "Creature — Goblin", "Goblin creatures you control get +1/+1."),
      seat: 0,
    });
    card.textChanges.push({ kind: "type", from: "Goblin", to: "Elf" });
    g.layerEngine.bumpEpoch("test-typeChange");
    const post = g.layerEngine.computeCharacteristics(card.id);
    expect(post.rulesText).toContain("Elf creatures");
    expect(post.rulesText).not.toContain("Goblin creatures");
    // Subtype set also flipped.
    expect(post.subtypes.has("Elf")).toBe(true);
    expect(post.subtypes.has("Goblin")).toBe(false);
  });
});

// ── Pick 6: svar/selectors/card-state.ts — Count$CrewSize via crewedBy ──────
describe("Wave 98 — Count$CrewSize reads canonical card.crewedBy", () => {
  it("returns crewedBy.length when CrewEffect has stamped the slot", () => {
    const g = mkGame();
    const vehicle = mintCard({
      game: g,
      id: 9400,
      paper: mkPaper("Smuggler's Copter", "Artifact — Vehicle"),
      seat: 0,
    });
    // Simulate CrewEffect stamping crewedBy directly (the effect's pipeline
    // does this after the chooseCrewSaddleCreatures decision resolves).
    vehicle.crewedBy = [mkEntityId(9401), mkEntityId(9402)];
    // Build a Count$CrewSize SVar evaluation through the registry.
    const result = evaluateExpression(
      { kind: "Count", raw: "Count$CrewSize", args: [{ kind: "literal", raw: "CrewSize" }] },
      { game: g, svars: new Map(), controller: mkPlayerSeat(0), sourceCardId: vehicle.id },
    );
    expect(result).toBe(2);
  });

  it("returns 0 when crewedBy is undefined and no legacy slot is set", () => {
    const g = mkGame();
    const vehicle = mintCard({
      game: g,
      id: 9410,
      paper: mkPaper("Quiet Vehicle", "Artifact — Vehicle"),
      seat: 0,
    });
    const result = evaluateExpression(
      { kind: "Count", raw: "Count$CrewSize", args: [{ kind: "literal", raw: "CrewSize" }] },
      { game: g, svars: new Map(), controller: mkPlayerSeat(0), sourceCardId: vehicle.id },
    );
    expect(result).toBe(0);
  });
});
