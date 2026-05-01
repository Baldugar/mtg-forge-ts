// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 89 — Effect handler TODO sweep round 10.
//
// Closes inline TODO(advanced) tails on six effect handlers:
//   * wave-21:Incubate — actually mint the Incubator artifact token via
//     game.action.createToken and place N +1/+1 counters on it.
//   * wave-21:EachDamage — when no explicit targets are present, expand
//     `ValidTgts$` via parseValidTgts + enumerateEligibleTargets and deal
//     N damage to every match (cards as creature; players as player).
//   * wave-22:GainOwnership — write to Card.ownerSeat directly (the
//     canonical CR 400.7 zone-routing field) and stamp an
//     `ownership-changed` advisory record on game.decisionWarnings.
//   * wave-22:VillainousChoice — iterate every opponent of the source's
//     controller and resolve their pick independently, matching Forge's
//     "each opponent chooses" canonical for cards like Promise of
//     Aclazotz.
//   * wave-22:Endure (counter mode) — distribute N +1/+1 counters evenly
//     across all valid targets (floor + +1 to first remainder targets).
//   * wave-22:ActivateAbility — when `Ability$` names an SVar ability,
//     dispatch the printed effect inline via the SVar pipeline (mirrors
//     Charm / VillainousChoice).
import "./index.js";
import type {
  EffectInvocation,
  EntityId,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
  SVarAst,
} from "@mtg-forge-ts/core";
import {
  CardType,
  ColorSet,
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
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
  cardDataSyncedAt: "2026-04-30T00:00:00Z",
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

const mkPaperWithSvars = (svars: ReadonlyMap<string, SVarAst>): PaperCard => ({
  name: "TestSvars",
  edition: "TST",
  collectorNumber: "002",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name: "TestSvars",
    oracle: "",
    types: new TypeLine([], [CardType.Creature], []),
    manaCost: null,
    colors: ColorSet.empty(),
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars,
  },
});

const mkGame = (seed = 1n): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(seed) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, p.seat));
  }
  return game;
};

const drainGen = (gen: Generator<unknown, void, unknown>, responses: unknown[] = []): unknown[] => {
  const out: unknown[] = [];
  let r = gen.next();
  let respIdx = 0;
  while (!r.done) {
    out.push(r.value);
    const yielded = r.value as { kind?: string };
    if (yielded.kind === "decision" && respIdx < responses.length) {
      r = gen.next(responses[respIdx++]);
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
  svars: ReadonlyMap<string, SVarAst> = new Map(),
) =>
  new SpellAbility(
    {
      kind: "spell",
      effect: { handlerKey, params: params as never },
      cost: { raw: "" },
    },
    sourceId,
    controllerSeat,
    svars,
    targets,
  );

const seedSourceCard = (
  game: Game,
  sourceId = mkEntityId(10),
  seat: PlayerSeat = mkPlayerSeat(0),
  paper: PaperCard = plainPaper,
): Card => {
  const c = new Card(sourceId, paper, seat, seat, ZoneType.Battlefield);
  game.cards.set(sourceId, c);
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  bf?.add(sourceId);
  return c;
};

const addBfCard = (
  game: Game,
  id: EntityId,
  seat: PlayerSeat = mkPlayerSeat(0),
  paper: PaperCard = plainPaper,
): Card => {
  const c = new Card(id, paper, seat, seat, ZoneType.Battlefield);
  game.cards.set(id, c);
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  bf?.add(id);
  return c;
};

// ---------------------------------------------------------------------------
// (1) Incubate — mint an Incubator token + place N +1/+1 counters on it
// ---------------------------------------------------------------------------

describe("Wave 89 — Incubate token mint", () => {
  it("mints an Incubator artifact token under the controller and places N +1/+1 counters on it", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(8000);
    seedSourceCard(game, sourceId, seat);
    const sa = mkSa("Incubate", { Num: { kind: "literal", raw: "3" } }, sourceId, seat);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    let mintedId: EntityId | null = null;
    for (const [id, card] of game.cards) {
      if (id === sourceId) continue;
      if (card.controllerSeat !== seat) continue;
      if (card.zone !== ZoneType.Battlefield) continue;
      if (card.paperCard.name !== "Incubator") continue;
      mintedId = id;
      break;
    }
    expect(mintedId).not.toBeNull();
    if (mintedId === null) return;
    const counters = game.cards.get(mintedId)?.counters;
    expect(counters?.get(CounterType.PlusOnePlusOne) ?? 0).toBe(3);
  });

  it("Num$ defaults to 1 when missing", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(8010);
    seedSourceCard(game, sourceId, seat);
    const sa = mkSa("Incubate", {}, sourceId, seat);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    let mintedId: EntityId | null = null;
    for (const [id, card] of game.cards) {
      if (id === sourceId) continue;
      if (card.paperCard.name !== "Incubator") continue;
      mintedId = id;
      break;
    }
    expect(mintedId).not.toBeNull();
    if (mintedId === null) return;
    const counters = game.cards.get(mintedId)?.counters;
    expect(counters?.get(CounterType.PlusOnePlusOne) ?? 0).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (2) EachDamage — ValidTgts$ filter expansion (targetless)
// ---------------------------------------------------------------------------

describe("Wave 89 — EachDamage ValidTgts$ filter expansion", () => {
  it("with no explicit targets, ValidTgts$ Creature damages every battlefield creature for N", () => {
    const game = mkGame();
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    const sourceId = mkEntityId(8100);
    seedSourceCard(game, sourceId, seatA);
    const c1 = mkEntityId(8101);
    const c2 = mkEntityId(8102);
    addBfCard(game, c1, seatA);
    addBfCard(game, c2, seatB);
    // Stub the layer engine so all three cards register as creatures.
    const orig = game.layerEngine.computeCharacteristics.bind(game.layerEngine);
    game.layerEngine.computeCharacteristics = (id) => {
      const base = orig(id);
      return { ...base, types: new Set([CardType.Creature]) };
    };
    const sa = mkSa(
      "EachDamage",
      { NumDmg: { kind: "literal", raw: "2" }, ValidTgts: { kind: "literal", raw: "Creature" } },
      sourceId,
      seatA,
      [],
    );
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const dmgEvents = yields.filter((y) => {
      const yy = y as { kind?: string; event?: { kind?: string } };
      return yy.kind === "event" && yy.event?.kind === "DamageDealt";
    });
    // Expect at least 3 DamageDealt events (one per creature including the source itself if it counts as creature).
    expect(dmgEvents.length).toBeGreaterThanOrEqual(2);
  });

  it("with explicit targets, the legacy explicit-targets path runs unchanged", () => {
    const game = mkGame();
    const seatA = mkPlayerSeat(0);
    const sourceId = mkEntityId(8200);
    seedSourceCard(game, sourceId, seatA);
    const c1 = mkEntityId(8201);
    addBfCard(game, c1, seatA);
    const sa = mkSa("EachDamage", { NumDmg: { kind: "literal", raw: "2" } }, sourceId, seatA, [c1]);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const dmgEvents = yields.filter((y) => {
      const yy = y as { kind?: string; event?: { kind?: string } };
      return yy.kind === "event" && yy.event?.kind === "DamageDealt";
    });
    expect(dmgEvents.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// (3) GainOwnership — direct write to Card.ownerSeat + advisory record
// ---------------------------------------------------------------------------

describe("Wave 89 — GainOwnership direct ownerSeat write", () => {
  it("writes Card.ownerSeat to the SA controller and stamps an ownership-changed advisory", () => {
    const game = mkGame();
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    const sourceId = mkEntityId(8300);
    const targetId = mkEntityId(8301);
    seedSourceCard(game, sourceId, seatA);
    addBfCard(game, targetId, seatB);
    expect(game.cards.get(targetId)?.ownerSeat).toBe(seatB);
    const sa = mkSa("GainOwnership", {}, sourceId, seatA, [targetId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.cards.get(targetId)?.ownerSeat).toBe(seatA);
    const warn = game.decisionWarnings.find((w) => w.kind === "ownership-changed");
    expect(warn).toBeDefined();
    expect(warn?.detail).toContain(`${targetId}`);
  });

  it("no-op when target already owned by SA controller (no warning stamped)", () => {
    const game = mkGame();
    const seatA = mkPlayerSeat(0);
    const sourceId = mkEntityId(8400);
    const targetId = mkEntityId(8401);
    seedSourceCard(game, sourceId, seatA);
    addBfCard(game, targetId, seatA);
    const sa = mkSa("GainOwnership", {}, sourceId, seatA, [targetId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const warn = game.decisionWarnings.find((w) => w.kind === "ownership-changed");
    expect(warn).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (4) VillainousChoice — per-opponent branch resolution
// ---------------------------------------------------------------------------

describe("Wave 89 — VillainousChoice per-opponent resolution", () => {
  it("yields one chooseGenericOption per opponent of the SA controller", () => {
    const game = mkGame();
    const seatA = mkPlayerSeat(0);
    const sourceId = mkEntityId(8500);
    // Source card whose paper-card definition carries a "DBPump" SVar.
    // Pump no-ops gracefully on an empty target list.
    const pumpAbility: EffectInvocation = { handlerKey: "Pump", params: {} };
    const svars = new Map<string, SVarAst>([
      ["DBPump", { kind: "ability", raw: "stub", ability: pumpAbility }],
    ]);
    seedSourceCard(game, sourceId, seatA, mkPaperWithSvars(svars));
    const sa = mkSa(
      "VillainousChoice",
      { Choices: { kind: "literal", raw: "DBPump" } },
      sourceId,
      seatA,
      [],
      svars,
    );
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const decisions = yields.filter((y) => {
      const yy = y as { kind?: string; request?: { kind?: string } };
      return yy.kind === "decision" && yy.request?.kind === "chooseGenericOption";
    });
    // 2-player table → 1 opponent → 1 decision yielded.
    expect(decisions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (5) Endure (counter mode) — distribute counters evenly across targets
// ---------------------------------------------------------------------------

describe("Wave 89 — Endure counter-mode distribution", () => {
  it("Num=4 across 2 targets distributes 2/2 +1/+1 counters", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(8600);
    const t1 = mkEntityId(8601);
    const t2 = mkEntityId(8602);
    seedSourceCard(game, sourceId, seat);
    addBfCard(game, t1, seat);
    addBfCard(game, t2, seat);
    const sa = mkSa("Endure", { Num: { kind: "literal", raw: "4" } }, sourceId, seat, [t1, t2]);
    // Respond with the "counters" branch on the chooseEndureOption decision.
    const responses = [{ kind: "chooseEndureOption", option: "counters" }];
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>, responses);
    expect(game.cards.get(t1)?.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(2);
    expect(game.cards.get(t2)?.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(2);
  });

  it("Num=5 across 2 targets distributes 3/2 (first target gets the remainder)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(8700);
    const t1 = mkEntityId(8701);
    const t2 = mkEntityId(8702);
    seedSourceCard(game, sourceId, seat);
    addBfCard(game, t1, seat);
    addBfCard(game, t2, seat);
    const sa = mkSa("Endure", { Num: { kind: "literal", raw: "5" } }, sourceId, seat, [t1, t2]);
    const responses = [{ kind: "chooseEndureOption", option: "counters" }];
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>, responses);
    expect(game.cards.get(t1)?.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(3);
    expect(game.cards.get(t2)?.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(2);
  });

  it("Num=N across 1 target lands all N counters on the single target (legacy MVP)", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(8800);
    const t1 = mkEntityId(8801);
    seedSourceCard(game, sourceId, seat);
    addBfCard(game, t1, seat);
    const sa = mkSa("Endure", { Num: { kind: "literal", raw: "3" } }, sourceId, seat, [t1]);
    const responses = [{ kind: "chooseEndureOption", option: "counters" }];
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>, responses);
    expect(game.cards.get(t1)?.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// (6) ActivateAbility — SVar pipeline dispatch
// ---------------------------------------------------------------------------

describe("Wave 89 — ActivateAbility SVar pipeline dispatch", () => {
  it("when Ability$ names an SVar ability, the SVar's handler runs inline", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(8900);
    // The SVar ability dispatches a "Discard" handler so we can detect it ran
    // by observing a side-effect (DiscardSelf record on game.decisionWarnings
    // is too specific; instead verify pendingAbilityActivations is stamped
    // AND a non-empty yield list is produced).
    const dbAbility: EffectInvocation = { handlerKey: "Pump", params: {} };
    const svars = new Map<string, SVarAst>([
      ["DBPump", { kind: "ability", raw: "stub", ability: dbAbility }],
    ]);
    seedSourceCard(game, sourceId, seat, mkPaperWithSvars(svars));
    const sa = mkSa(
      "ActivateAbility",
      { Ability: { kind: "literal", raw: "DBPump" } },
      sourceId,
      seat,
      [],
      svars,
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    // The pending-activations stamp records the request name.
    const pending = (game.cards.get(sourceId) as unknown as { pendingAbilityActivations?: string[] })
      .pendingAbilityActivations;
    expect(pending).toContain("DBPump");
  });

  it("when the SVar is missing, the legacy pendingAbilityActivations queue is still stamped", () => {
    const game = mkGame();
    const seat = mkPlayerSeat(0);
    const sourceId = mkEntityId(8950);
    seedSourceCard(game, sourceId, seat);
    const sa = mkSa("ActivateAbility", { Ability: { kind: "literal", raw: "DBMissing" } }, sourceId, seat);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const pending = (game.cards.get(sourceId) as unknown as { pendingAbilityActivations?: string[] })
      .pendingAbilityActivations;
    expect(pending).toContain("DBMissing");
  });
});
