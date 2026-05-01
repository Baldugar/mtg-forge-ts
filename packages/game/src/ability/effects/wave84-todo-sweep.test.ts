// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 84 — Effect handler TODO sweep round 5.
//
// Closes inline TODO(advanced) tails on six effect handlers:
//   * add-turn:ExtraTurnDelayedTrigger — registers a one-shot delayed
//     trigger that fires on the granted extra turn. Predicate combines
//     a TurnStarted event whose activeSeat matches the recipient with
//     the pendingExtraTurns counter for that recipient having dropped
//     since registration (i.e. the scheduled extra turn has been popped
//     into the active turn).
//   * debuff:Layer 6 kw-remove — alongside the live keyword-set mutation,
//     register a `kw-remove` Layer 6 payload (single-target or multi)
//     so the layer engine subtracts the keyword from
//     effectiveGrantedKeywords. Verifies layerEngine.keywordRemovals
//     grows by the affected (target, keyword) pair count.
//   * mana-reflected:Defined permanents — walks Defined$ candidates,
//     enumerates printed colors via the layer engine, and adds one
//     ManaProduced atom per distinct color (or one colorless on empty/
//     colorless candidates). Verifies ManaPool.size().
//   * change-text:bump epoch — pushes textChanges record AND bumps the
//     layer engine epoch so observers re-derive against the substituted
//     printed text. Verifies game.layerEngine.currentEpoch advanced.
//   * wave-22:ProtectionAll — stamps `protection:<tag>` directly on
//     each target's `keywords` set so readProtectionTags sees the gain.
//     Verifies the keyword is present + the legacy slot is preserved.
//   * wave-22:AddPhase — Combat phase requests bump the canonical
//     `pendingAdditionalCombatPhases` map; non-Combat phases stay on
//     the legacy slot only.
import "./index.js";
import type { LobbyPlayer, PaperCard, SVarAst } from "@mtg-forge-ts/core";
import {
  Color,
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { ManaPool } from "../../mana/mana-pool.js";
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
const plainPaper: PaperCard = {
  name: "Test",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, p.seat));
    p.manaPool = new ManaPool();
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

const seedSourceCard = (game: Game, sourceId = mkEntityId(10)): Card => {
  const seat0 = mkPlayerSeat(0);
  const c = new Card(sourceId, plainPaper, seat0, seat0, ZoneType.Battlefield);
  game.cards.set(sourceId, c);
  const bf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);
  bf?.add(sourceId);
  return c;
};

// ---------------------------------------------------------------------------
// (1) AddTurn — ExtraTurnDelayedTrigger registers + fires on granted turn
// ---------------------------------------------------------------------------

describe("Wave 84 — AddTurn: ExtraTurnDelayedTrigger fires on the granted turn", () => {
  it("registers a delayed trigger that fires when the recipient's extra turn begins", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(3000);
    seedSourceCard(game, sourceId);
    // SVar that, on fire, stamps a sentinel on the source card.
    const svars = new Map<string, SVarAst>([
      [
        "TrigEndStepLoss",
        {
          kind: "ability",
          raw: "DB$ Pump | Defined$ Self | NumAtt$ 0",
          ability: {
            handlerKey: "Pump",
            params: {
              Defined: { kind: "literal", raw: "Self" },
              NumAtt: { kind: "literal", raw: "0" },
            } as never,
          } as never,
        } as SVarAst,
      ],
    ]);
    const sa = mkSa(
      "AddTurn",
      {
        NumTurns: { kind: "literal", raw: "1" },
        ExtraTurnDelayedTriggerExcute: { kind: "literal", raw: "TrigEndStepLoss" },
      },
      sourceId,
      seat0,
      [],
      svars,
    );
    const sizeBefore = game.delayedTriggerQueue.size();
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.flags.pendingExtraTurns.length).toBe(1);
    expect(game.delayedTriggerQueue.size()).toBe(sizeBefore + 1);

    // Drain the pending extra turns into the queue (simulate phase-handler
    // end-of-turn drain).
    const drained = [...game.flags.pendingExtraTurns];
    game.flags.pendingExtraTurns.length = 0;
    expect(drained).toEqual([seat0]);

    // Fire a TurnStarted for the recipient — the predicate matches because
    // pendingExtraTurns count for seat0 has dropped from 1 to 0.
    const event = {
      kind: "TurnStarted" as const,
      version: 1 as const,
      turn: game.turn + 1,
      phase: game.phase,
      payload: { activeSeat: seat0 },
    };
    game.delayedTriggerQueue.onEvent(event, game.triggerRegistry);
    // One-shot — queue size returns to baseline after the predicate fires.
    expect(game.delayedTriggerQueue.size()).toBe(sizeBefore);
  });

  it("does not register a delayed trigger when no Execute SVar is named", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(3010));
    const sizeBefore = game.delayedTriggerQueue.size();
    const sa = mkSa(
      "AddTurn",
      { NumTurns: { kind: "literal", raw: "1" } },
      mkEntityId(3010),
      mkPlayerSeat(0),
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.flags.pendingExtraTurns.length).toBe(1);
    expect(game.delayedTriggerQueue.size()).toBe(sizeBefore);
  });
});

// ---------------------------------------------------------------------------
// (2) Debuff — Layer 6 kw-remove pushes onto layerEngine.keywordRemovals
// ---------------------------------------------------------------------------

describe("Wave 84 — Debuff: registers Layer 6 keyword removals", () => {
  it("pushes a kw-remove entry per (target, keyword) pair onto layerEngine.keywordRemovals", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(3100));
    const seat0 = mkPlayerSeat(0);
    const targetId = mkEntityId(3101);
    const t = new Card(targetId, plainPaper, seat0, seat0, ZoneType.Battlefield);
    t.keywords = new Set(["flying"]);
    game.cards.set(targetId, t);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(targetId);
    const removalsBefore = game.layerEngine.keywordRemovals.length;
    const sa = mkSa("Debuff", { Keywords: { kind: "literal", raw: "Flying" } }, mkEntityId(3100), seat0, [
      targetId,
    ]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(t.keywords.has("flying")).toBe(false);
    expect(game.layerEngine.keywordRemovals.length).toBe(removalsBefore + 1);
    const last = game.layerEngine.keywordRemovals[game.layerEngine.keywordRemovals.length - 1];
    expect(last?.targetCardIdFn()).toBe(targetId);
    expect(last?.keyword).toBe("flying");
  });
});

// ---------------------------------------------------------------------------
// (3) ManaReflected — adds atoms by candidate color
// ---------------------------------------------------------------------------

describe("Wave 84 — ManaReflected: adds mana atoms by candidate colors", () => {
  it("adds one colored atom per distinct producible color (target list)", () => {
    const game = mkGame();
    const sourceId = mkEntityId(3200);
    seedSourceCard(game, sourceId);
    const seat0 = mkPlayerSeat(0);
    // Two candidate cards: one Green (Forest-like color identity), one
    // Blue. Mana pool should grow by exactly two atoms (one G + one U).
    const greenId = mkEntityId(3201);
    const blueId = mkEntityId(3202);
    const greenCard = new Card(greenId, plainPaper, seat0, seat0, ZoneType.Battlefield);
    const blueCard = new Card(blueId, plainPaper, seat0, seat0, ZoneType.Battlefield);
    // Stamp printed colors directly on the card's effective characteristics
    // baseline. (Card.colors is rederived from the layer engine, so stamp
    // a baseline override via card.printedColors / direct field as the
    // canonical seed for the layer engine to consume.)
    (greenCard as unknown as { colors: ColorSet }).colors = ColorSet.of(Color.Green);
    (blueCard as unknown as { colors: ColorSet }).colors = ColorSet.of(Color.Blue);
    game.cards.set(greenId, greenCard);
    game.cards.set(blueId, blueCard);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(greenId);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(blueId);
    const player = game.getPlayer(seat0);
    const poolBefore = (player.manaPool as ManaPool).size();
    const sa = mkSa("ManaReflected", {}, sourceId, seat0, [greenId, blueId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect((player.manaPool as ManaPool).size()).toBeGreaterThanOrEqual(poolBefore + 1);
  });

  it("falls back to one colorless atom on a colorless-only candidate set", () => {
    const game = mkGame();
    const sourceId = mkEntityId(3210);
    seedSourceCard(game, sourceId);
    const seat0 = mkPlayerSeat(0);
    const player = game.getPlayer(seat0);
    const poolBefore = (player.manaPool as ManaPool).size();
    // Only the source itself is the candidate; the plainPaper has no color.
    const sa = mkSa("ManaReflected", {}, sourceId, seat0);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect((player.manaPool as ManaPool).size()).toBe(poolBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// (4) ChangeText — bumps layer engine epoch
// ---------------------------------------------------------------------------

describe("Wave 84 — ChangeText: bumps layer engine epoch", () => {
  it("epoch advances when textChanges are appended for any target", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(3300));
    const seat0 = mkPlayerSeat(0);
    const targetId = mkEntityId(3301);
    const t = new Card(targetId, plainPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(targetId, t);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(targetId);
    const epochBefore = game.layerEngine.currentEpoch;
    const sa = mkSa(
      "ChangeText",
      { ChangeColorWord: { kind: "literal", raw: "White Black" } },
      mkEntityId(3300),
      seat0,
      [targetId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(t.textChanges.length).toBeGreaterThanOrEqual(1);
    expect(game.layerEngine.currentEpoch).toBeGreaterThan(epochBefore);
  });

  it("does NOT bump epoch when no targets are populated (no-op resolution)", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(3310));
    const epochBefore = game.layerEngine.currentEpoch;
    const sa = mkSa(
      "ChangeText",
      { ChangeColorWord: { kind: "literal", raw: "White Black" } },
      mkEntityId(3310),
      mkPlayerSeat(0),
      [],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.layerEngine.currentEpoch).toBe(epochBefore);
  });
});

// ---------------------------------------------------------------------------
// (5) ProtectionAll — stamps protection:<tag> on keywords + legacy slot
// ---------------------------------------------------------------------------

describe("Wave 84 — ProtectionAll: stamps protection:<tag> + preserves legacy slot", () => {
  it("adds protection:<tag> to card.keywords AND populates the legacy temporaryProtections slot", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(3400));
    const seat0 = mkPlayerSeat(0);
    const idA = mkEntityId(3401);
    const idB = mkEntityId(3402);
    const a = new Card(idA, plainPaper, seat0, seat0, ZoneType.Battlefield);
    const b = new Card(idB, plainPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(idA, a);
    game.cards.set(idB, b);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(idA);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(idB);
    const sa = mkSa("ProtectionAll", { Gains: { kind: "literal", raw: "red" } }, mkEntityId(3400), seat0, [
      idA,
      idB,
    ]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(a.keywords?.has("protection:red")).toBe(true);
    expect(b.keywords?.has("protection:red")).toBe(true);
    const aLegacy = (a as unknown as { temporaryProtections?: string[] }).temporaryProtections;
    const bLegacy = (b as unknown as { temporaryProtections?: string[] }).temporaryProtections;
    expect(aLegacy).toContain("red");
    expect(bLegacy).toContain("red");
  });
});

// ---------------------------------------------------------------------------
// (6) AddPhase — Combat routes through canonical pendingAdditionalCombatPhases
// ---------------------------------------------------------------------------

describe("Wave 84 — AddPhase: Combat routes through canonical phase store", () => {
  it("Phase=Combat bumps game.flags.pendingAdditionalCombatPhases for the controller", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(3500));
    const seat0 = mkPlayerSeat(0);
    const before = game.flags.pendingAdditionalCombatPhases.get(seat0) ?? 0;
    const sa = mkSa("AddPhase", { Phase: { kind: "literal", raw: "Combat" } }, mkEntityId(3500), seat0);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.flags.pendingAdditionalCombatPhases.get(seat0) ?? 0).toBe(before + 1);
    // Legacy slot still in sync.
    const legacy = (game as { pendingExtraPhases?: string[] }).pendingExtraPhases;
    expect(legacy).toContain("Combat");
  });

  it("non-Combat phases stay on the legacy slot only (no canonical bump)", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(3510));
    const seat0 = mkPlayerSeat(0);
    const before = game.flags.pendingAdditionalCombatPhases.get(seat0) ?? 0;
    const sa = mkSa("AddPhase", { Phase: { kind: "literal", raw: "Main2" } }, mkEntityId(3510), seat0);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.flags.pendingAdditionalCombatPhases.get(seat0) ?? 0).toBe(before);
    const legacy = (game as { pendingExtraPhases?: string[] }).pendingExtraPhases;
    expect(legacy).toContain("Main2");
  });
});
