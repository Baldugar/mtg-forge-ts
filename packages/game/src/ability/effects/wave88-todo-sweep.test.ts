// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 88 — Effect handler TODO sweep round 9.
//
// Closes inline TODO(advanced) tails on six effect handlers:
//   * wave-22:SwitchBlock — `game.blockRedirects` is now consulted by
//     CombatHandler.dealDamage. Damage that would land on a redirected
//     blocker is rerouted to the redirect target; missing entries pass
//     through; redirects whose target is no longer on the battlefield
//     fall back to the original blocker.
//   * wave-22:ExchangeControlVariant — `Until$ EOT` / `Until$ YourNextTurn`
//     route both control swaps through `changeControl` with the canonical
//     `until` option. Missing `Until$` keeps the legacy permanent-swap
//     behavior.
//   * wave-22:RollPlanarDice — the d6 face is rolled via `game.rng.nextInt`.
//     Faces map: 0 = chaos, 1 = planeswalk, 2-5 = blank. The final face
//     is mirrored on `game.flags.lastPlanarDieResult` for downstream
//     test introspection. `Amount$` controls the number of rolls.
//   * wave-21:AlterAttribute — numeric attribute changes stamp an
//     `attribute-changed` record on `game.decisionWarnings` (one per id +
//     attribute) and bump the layer-engine epoch so dependent grants
//     recompute.
//   * wave-19:AdvanceCrank — rotates the per-controller sprocket pointer
//     (1 -> 2 -> 3 -> 1) on `game.flags.attractions[seat].crankSprocket`.
//     The first crank lands on sprocket 1 (Forge's printed default).
//   * wave-19:ChangeTargets — proposed targets that no longer exist as
//     game entities are dropped (CR 608.2b legality re-check) and stamped
//     as `change-targets-illegal-target`; surviving rewrites stamp a
//     `stack-item-targets-changed` advisory record on decisionWarnings.
import "./index.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import { CombatHandler } from "../../combat/combat-handler.js";
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
) =>
  new SpellAbility(
    {
      kind: "spell",
      effect: { handlerKey, params: params as never },
      cost: { raw: "" },
    },
    sourceId,
    controllerSeat,
    new Map(),
    targets,
  );

const seedSourceCard = (game: Game, sourceId = mkEntityId(10), seat = mkPlayerSeat(0)): Card => {
  const c = new Card(sourceId, plainPaper, seat, seat, ZoneType.Battlefield);
  game.cards.set(sourceId, c);
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  bf?.add(sourceId);
  return c;
};

const addBfCard = (game: Game, id: ReturnType<typeof mkEntityId>, seat = mkPlayerSeat(0)): Card => {
  const c = new Card(id, plainPaper, seat, seat, ZoneType.Battlefield);
  game.cards.set(id, c);
  const bf = game.getPlayer(seat).zones.get(ZoneType.Battlefield);
  bf?.add(id);
  return c;
};

// ---------------------------------------------------------------------------
// (1) SwitchBlock — combat damage routes to the redirect target
// ---------------------------------------------------------------------------

describe("Wave 88 — SwitchBlock combat-damage redirect", () => {
  it("attacker damage that would land on the original blocker is rerouted to the redirect target", () => {
    const game = mkGame();
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    const attackerId = mkEntityId(7000);
    const blockerId = mkEntityId(7001);
    const redirectId = mkEntityId(7002);
    addBfCard(game, attackerId, seatA);
    addBfCard(game, blockerId, seatB);
    addBfCard(game, redirectId, seatB);
    // Stub LayerEngine.computeCharacteristics so the attacker has power 3.
    const orig = game.layerEngine.computeCharacteristics.bind(game.layerEngine);
    const stats = new Map<ReturnType<typeof mkEntityId>, { power: number; toughness: number }>([
      [attackerId, { power: 3, toughness: 3 }],
      [blockerId, { power: 0, toughness: 4 }],
      [redirectId, { power: 0, toughness: 4 }],
    ]);
    game.layerEngine.computeCharacteristics = (id) => {
      const s = stats.get(id);
      if (!s) return orig(id);
      const c = orig(id);
      // Replace the relevant slots without mutating the cached entry.
      return { ...c, power: s.power, toughness: s.toughness };
    };
    // Wire the redirect map.
    (
      game as { blockRedirects?: Map<ReturnType<typeof mkEntityId>, ReturnType<typeof mkEntityId>> }
    ).blockRedirects = new Map([[blockerId, redirectId]]);

    const handler = new CombatHandler(game);
    handler.declareAttackers([{ attackerId, defender: { kind: "player", seat: seatB } }]);
    handler.declareBlockers([{ blockerId, attackerIds: [attackerId] }]);
    handler.setBlockerOrder(attackerId, [blockerId]);
    const yields: unknown[] = [];
    const gen = handler.dealDamage(false);
    let step = gen.next();
    while (!step.done) {
      yields.push(step.value);
      step = gen.next();
    }
    // First call's events:
    const dmg = yields.flatMap((y) => {
      const yy = y as { kind?: string; event?: { kind: string; payload?: { targetId?: unknown } } };
      if (yy.kind !== "event" || yy.event?.kind !== "DamageDealt") return [];
      return [yy.event.payload?.targetId];
    });
    // The redirect lands the attacker's damage on `redirectId`, never on
    // the original `blockerId`.
    expect(dmg).toContain(redirectId);
    expect(dmg).not.toContain(blockerId);
  });

  it("missing redirects pass through unchanged", () => {
    const game = mkGame();
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    const attackerId = mkEntityId(7100);
    const blockerId = mkEntityId(7101);
    addBfCard(game, attackerId, seatA);
    addBfCard(game, blockerId, seatB);
    const orig = game.layerEngine.computeCharacteristics.bind(game.layerEngine);
    game.layerEngine.computeCharacteristics = (id) => {
      const c = orig(id);
      if (id === attackerId) return { ...c, power: 2, toughness: 2 };
      if (id === blockerId) return { ...c, power: 0, toughness: 5 };
      return c;
    };
    // Empty redirect map — no rerouting.
    (
      game as { blockRedirects?: Map<ReturnType<typeof mkEntityId>, ReturnType<typeof mkEntityId>> }
    ).blockRedirects = new Map();
    const handler = new CombatHandler(game);
    handler.declareAttackers([{ attackerId, defender: { kind: "player", seat: seatB } }]);
    handler.declareBlockers([{ blockerId, attackerIds: [attackerId] }]);
    handler.setBlockerOrder(attackerId, [blockerId]);
    const out: unknown[] = [];
    const gen = handler.dealDamage(false);
    let step = gen.next();
    while (!step.done) {
      out.push(step.value);
      step = gen.next();
    }
    const dmg = out.flatMap((y) => {
      const yy = y as { kind?: string; event?: { kind: string; payload?: { targetId?: unknown } } };
      if (yy.kind !== "event" || yy.event?.kind !== "DamageDealt") return [];
      return [yy.event.payload?.targetId];
    });
    expect(dmg).toContain(blockerId);
  });
});

// ---------------------------------------------------------------------------
// (2) ExchangeControlVariant — Until$ duration handling
// ---------------------------------------------------------------------------

describe("Wave 88 — ExchangeControlVariant Until$ duration", () => {
  it("Until$ EOT routes both control swaps through changeControl with the until option", () => {
    const game = mkGame();
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    const sourceId = mkEntityId(7200);
    const aId = mkEntityId(7201);
    const bId = mkEntityId(7202);
    seedSourceCard(game, sourceId, seatA);
    addBfCard(game, aId, seatA);
    addBfCard(game, bId, seatB);
    // Spy: capture changeControl calls.
    const calls: unknown[] = [];
    const orig = game.action.changeControl.bind(game.action);
    (game.action as unknown as { changeControl: typeof orig }).changeControl = ((
      cardId: ReturnType<typeof mkEntityId>,
      newController: ReturnType<typeof mkPlayerSeat>,
      reason: unknown,
    ) => {
      calls.push({ cardId, newController, reason });
      return orig(cardId, newController, reason as never);
    }) as typeof orig;
    const sa = mkSa("ExchangeControlVariant", { Until: { kind: "literal", raw: "EOT" } }, sourceId, seatA, [
      aId,
      bId,
    ]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const c = call as { reason: { until?: { kind: string } } | unknown };
      const reason = c.reason as { until?: { kind: string } };
      expect(reason.until?.kind).toBe("untilEndOfTurn");
    }
  });

  it("missing Until$ keeps the legacy permanent-swap path (no until option)", () => {
    const game = mkGame();
    const seatA = mkPlayerSeat(0);
    const seatB = mkPlayerSeat(1);
    const sourceId = mkEntityId(7300);
    const aId = mkEntityId(7301);
    const bId = mkEntityId(7302);
    seedSourceCard(game, sourceId, seatA);
    addBfCard(game, aId, seatA);
    addBfCard(game, bId, seatB);
    const calls: unknown[] = [];
    const orig = game.action.changeControl.bind(game.action);
    (game.action as unknown as { changeControl: typeof orig }).changeControl = ((
      cardId: ReturnType<typeof mkEntityId>,
      newController: ReturnType<typeof mkPlayerSeat>,
      reason: unknown,
    ) => {
      calls.push({ cardId, newController, reason });
      return orig(cardId, newController, reason as never);
    }) as typeof orig;
    const sa = mkSa("ExchangeControlVariant", {}, sourceId, seatA, [aId, bId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      // Without Until$, the third arg is the bare sourceId (not an object).
      const c = call as { reason: unknown };
      expect(typeof c.reason).not.toBe("object");
    }
  });
});

// ---------------------------------------------------------------------------
// (3) RollPlanarDice — RNG-driven roll
// ---------------------------------------------------------------------------

describe("Wave 88 — RollPlanarDice RNG-driven roll", () => {
  it("emits PlanarDieRolled with one of the canonical faces and stamps lastPlanarDieResult", () => {
    const game = mkGame(42n);
    const sourceId = mkEntityId(7400);
    seedSourceCard(game, sourceId);
    const sa = mkSa("RollPlanarDice", {}, sourceId);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const rolled = yields.find(
      (y): y is { kind: "event"; event: { kind: string; payload: { result: string } } } =>
        typeof y === "object" &&
        y !== null &&
        (y as { kind?: string }).kind === "event" &&
        (y as { event?: { kind?: string } }).event?.kind === "PlanarDieRolled",
    );
    expect(rolled).toBeDefined();
    expect(["chaos", "planeswalk", "blank"]).toContain(rolled?.event.payload.result);
    expect(["chaos", "planeswalk", "blank"]).toContain(
      (game.flags as unknown as { lastPlanarDieResult?: string }).lastPlanarDieResult,
    );
  });

  it("Amount$ N produces N PlanarDieRolled pulses", () => {
    const game = mkGame(7n);
    const sourceId = mkEntityId(7410);
    seedSourceCard(game, sourceId);
    const sa = mkSa("RollPlanarDice", { Amount: { kind: "literal", raw: "3" } }, sourceId);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const rolls = yields.filter(
      (y) =>
        typeof y === "object" &&
        y !== null &&
        (y as { kind?: string }).kind === "event" &&
        (y as { event?: { kind?: string } }).event?.kind === "PlanarDieRolled",
    );
    expect(rolls).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// (4) AlterAttribute — decisionWarnings + epoch bump
// ---------------------------------------------------------------------------

describe("Wave 88 — AlterAttribute decisionWarnings + epoch bump", () => {
  it("stamps an attribute-changed record per id when the value moved", () => {
    const game = mkGame();
    const sourceId = mkEntityId(7500);
    seedSourceCard(game, sourceId);
    const before = game.layerEngine.currentEpoch;
    const sa = mkSa(
      "AlterAttribute",
      {
        Attribute: { kind: "literal", raw: "ring-level" },
        Amount: { kind: "literal", raw: "2" },
      },
      sourceId,
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const warn = game.decisionWarnings.find((w) => w.kind === "attribute-changed");
    expect(warn).toBeDefined();
    expect(warn?.detail).toContain("ring-level");
    expect(warn?.detail).toContain("0->2");
    // Epoch bumped on numeric mutation.
    expect(game.layerEngine.currentEpoch).toBeGreaterThan(before);
  });

  it("zero-delta numeric writes do not stamp a warning (no-op)", () => {
    const game = mkGame();
    const sourceId = mkEntityId(7510);
    seedSourceCard(game, sourceId);
    const sa = mkSa(
      "AlterAttribute",
      {
        Attribute: { kind: "literal", raw: "ring-level" },
        Amount: { kind: "literal", raw: "0" },
      },
      sourceId,
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const warn = game.decisionWarnings.find((w) => w.kind === "attribute-changed");
    expect(warn).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (5) AdvanceCrank — sprocket pointer rotation
// ---------------------------------------------------------------------------

describe("Wave 88 — AdvanceCrank sprocket-pointer rotation", () => {
  it("first crank lands on sprocket 1; subsequent cranks rotate 1 -> 2 -> 3 -> 1", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(7600);
    seedSourceCard(game, sourceId, seat0);
    const sa = mkSa("AdvanceCrank", {}, sourceId, seat0);
    const readPointer = (): number | undefined => {
      const rec = game.flags.attractions.get(seat0) as { crankSprocket?: number } | undefined;
      return rec?.crankSprocket;
    };
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(readPointer()).toBe(1);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(readPointer()).toBe(2);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(readPointer()).toBe(3);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(readPointer()).toBe(1);
  });

  it("does not clobber sibling attractions slots (assembledContraptions etc.)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(7700);
    seedSourceCard(game, sourceId, seat0);
    // Pre-seed an unrelated slot.
    game.flags.attractions.set(seat0, { assembledContraptions: 5 });
    const sa = mkSa("AdvanceCrank", {}, sourceId, seat0);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const rec = game.flags.attractions.get(seat0) as
      | { crankSprocket?: number; assembledContraptions?: number }
      | undefined;
    expect(rec?.crankSprocket).toBe(1);
    expect(rec?.assembledContraptions).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// (6) ChangeTargets — legality re-check + decision warnings
// ---------------------------------------------------------------------------

describe("Wave 88 — ChangeTargets legality re-check", () => {
  it("drops proposed targets that are not addressable on the game and stamps a warning", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(7800);
    seedSourceCard(game, sourceId, seat0);
    // Seed a stack item with id matching the first target.
    const stackItemId = mkEntityId(7801);
    const validTargetId = mkEntityId(7802);
    addBfCard(game, validTargetId, seat0);
    const ghostTargetId = mkEntityId(9999); // not in game.cards
    // Push a fake stack item so the handler finds it.
    game.sharedZones.stack.push({
      id: stackItemId,
      sourceCardId: sourceId,
      controllerSeat: seat0,
      kind: "spell",
      isCast: true,
      targets: [],
      modes: [],
      xValue: null,
      costPaid: null,
      provenance: {
        originZone: ZoneType.Hand,
        altCostUsed: null,
        additionalCostsPaid: [],
      },
    });
    const sa = mkSa("ChangeTargets", {}, sourceId, seat0, [stackItemId, validTargetId, ghostTargetId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    // A warning records the dropped ghost target.
    const dropped = game.decisionWarnings.find((w) => w.kind === "change-targets-illegal-target");
    expect(dropped).toBeDefined();
    expect(dropped?.detail).toContain(`${ghostTargetId}`);
    // And a stack-item-targets-changed advisory record fires once.
    const advisory = game.decisionWarnings.find((w) => w.kind === "stack-item-targets-changed");
    expect(advisory).toBeDefined();
    // Survivor: the valid target made it onto the stack item's targets.
    const item = game.sharedZones.stack
      .toArray()
      .find((it: { id: ReturnType<typeof mkEntityId> }) => it.id === stackItemId) as
      | { targets: readonly ReturnType<typeof mkEntityId>[] }
      | undefined;
    expect(item?.targets).toEqual([validTargetId]);
  });
});
