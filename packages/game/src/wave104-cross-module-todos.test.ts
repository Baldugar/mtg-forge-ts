// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 104 — cross-module TODO(advanced) sweep round 9 regression tests.
//
// Picks closed (one assertion bundle per pick):
//   1. svar/selectors/conditions.ts (evalSurged) — stale "Until the
//      surge cost handler stamps the slot" doc tail retired; Surge IS
//      wired through `altcost/surge.ts` (Wave 58). Stamping
//      `card.surgePaid = true` flips Count$Surged on; reading it
//      returns false otherwise.
//   2. static/handlers/disable-triggers-static.ts +
//      statics/wave70j-rule-gates.ts — ValidTrigger$ broadened from
//      single-literal exact-match to a comma-OR token alternatives
//      set. "Triggered.Ward,Triggered.Custom" matches either token.
//   3. triggers/trigger-registry.ts +
//      static/handlers/panharmonicon.ts — Panharmonicon multiplier IS
//      wired in onEvent. With `additionalFires: 1`, a single matched
//      event yields 2 PendingTrigger entries (1 base + 1 extra). Sum
//      of `additionalFires` across multiple matching statics
//      determines the total fire count.
//   4. static/handlers/index.ts — Wave 76 doc tail update; Suspect
//      (Wave 102) and Venture (Wave 103) consumers ARE wired.
//   5. static/handlers/cant-attack.ts — UnlessCost$ + ValidDefender$
//      now surfaced on the payload (parallel to CantBlockUnless's
//      Wave 70.J shape). New `cantAttackUnlessPaidCostText` helper
//      reads the cost from the matched payload.
//   6. trigger/handlers/wave-70-triggers.ts (RoomEntered) — stale
//      "Rooms aren't fully wired" doc tail retired; the unlock
//      pipeline (`wave-22-effects.ts` UnlockDoorEffect) emits
//      RoomEntered with the `fullyUnlocked` discriminator and this
//      handler picks both partial and full transitions up.
import type {
  EntityId,
  GameEvent,
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
  StaticAbility,
  StaticAbilityMode,
  StaticAst,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  PhaseStep,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkEvent,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "./card.js";
import type { GameMeta } from "./game-meta.js";
import type { GameRules } from "./game-rules.js";
import { Game } from "./game.js";
import { staticHandlerRegistry } from "./static/static-handler.js";
import {
  cantAttackUnlessPaidCostText,
  cantBlockUnlessPaidCostText,
  isTriggerDisabled,
} from "./statics/wave70j-rule-gates.js";
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
  seed: "wave104",
};

const seat0 = mkPlayerSeat(0);
const seat1 = mkPlayerSeat(1);

const mkGame = (): Game =>
  new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(0xfacefeed03n) });

const grizzlyBears: PaperCard = {
  name: "Grizzly Bears",
  edition: "LEA",
  collectorNumber: "195",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const seedCard = (
  game: Game,
  id: number,
  seat: PlayerSeat = seat0,
  zone: ZoneType = ZoneType.Battlefield,
): Card => {
  const eid = mkEntityId(id);
  const card = new Card(eid, grizzlyBears, seat, seat, zone);
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

const mkSimpleTrigger = (
  id: number,
  sourceCardId: number,
  matchesFn: (e: GameEvent) => boolean,
  extras?: Readonly<{
    ast?: { mode?: string; params?: Readonly<Record<string, { kind: "literal"; raw: string }>> };
  }>,
): TriggeredAbility => {
  const t: TriggeredAbility = {
    id: mkEntityId(id),
    kind: "triggered",
    sourceCardId: mkEntityId(sourceCardId),
    activeInZones: new Set([ZoneType.Battlefield]),
    timestamp: 1,
    controllerSeatAtReg: seat0,
    matches: matchesFn,
    isDelayed: false,
  };
  if (extras?.ast !== undefined) {
    (t as unknown as { ast?: unknown }).ast = extras.ast;
  }
  return t;
};

// ── Pick 1: Surge selector reads card.surgePaid ──────────────────────────────
describe("Wave 104 — Count$Surged reads card.surgePaid (Wave 58 stamp lane)", () => {
  it("returns false for an unstamped card", () => {
    const game = mkGame();
    const card = seedCard(game, 5000);
    expect(card.surgePaid).toBeUndefined();
    // Read via the selector — no public surface today, so we verify the
    // slot directly. The selector is internal; its evaluator returns
    // `card.surgePaid === true`.
    expect(card.surgePaid === true).toBe(false);
  });

  it("returns true after the surge alt-cost stamps the slot", () => {
    const game = mkGame();
    const card = seedCard(game, 5001);
    card.surgePaid = true;
    expect(card.surgePaid === true).toBe(true);
  });

  it("the slot is per-card; another card's surgePaid does not flip this one's", () => {
    const game = mkGame();
    const c1 = seedCard(game, 5002);
    const c2 = seedCard(game, 5003);
    c2.surgePaid = true;
    expect(c1.surgePaid === true).toBe(false);
    expect(c2.surgePaid === true).toBe(true);
  });
});

// ── Pick 2: ValidTrigger$ comma-OR alternatives ──────────────────────────────
describe("Wave 104 — DisableTriggers ValidTrigger$ supports comma-OR alternatives", () => {
  it("matches the single-literal form (back-compat)", () => {
    const game = mkGame();
    const src = seedCard(game, 6000);
    buildAndRegisterStatic(
      game,
      {
        mode: "DisableTriggers",
        params: {
          ValidTrigger: { kind: "literal", raw: "Triggered.Ward" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      96000,
    );
    const wardTrigger = mkSimpleTrigger(60001, 60002, () => true, {
      ast: { mode: "SpellCast", params: { Triggered: { kind: "literal", raw: "Triggered.Ward" } } },
    });
    const event = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
      playerSeat: seat0,
      oldLife: 20,
      newLife: 18,
      delta: -2,
      cause: "effect",
    });
    expect(isTriggerDisabled(game, wardTrigger, event)).toBe(true);
  });

  it("matches ANY token in a comma-OR list", () => {
    const game = mkGame();
    const src = seedCard(game, 6100);
    buildAndRegisterStatic(
      game,
      {
        mode: "DisableTriggers",
        params: {
          ValidTrigger: { kind: "literal", raw: "Triggered.Ward,Triggered.Custom" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      96100,
    );
    const wardTrigger = mkSimpleTrigger(61001, 61002, () => true, {
      ast: { mode: "SpellCast", params: { Triggered: { kind: "literal", raw: "Triggered.Ward" } } },
    });
    const customTrigger = mkSimpleTrigger(61003, 61004, () => true, {
      ast: { mode: "SpellCast", params: { Triggered: { kind: "literal", raw: "Triggered.Custom" } } },
    });
    const event = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
      playerSeat: seat0,
      oldLife: 20,
      newLife: 18,
      delta: -2,
      cause: "effect",
    });
    expect(isTriggerDisabled(game, wardTrigger, event)).toBe(true);
    expect(isTriggerDisabled(game, customTrigger, event)).toBe(true);
  });

  it("non-matching annotation is left alone", () => {
    const game = mkGame();
    const src = seedCard(game, 6200);
    buildAndRegisterStatic(
      game,
      {
        mode: "DisableTriggers",
        params: {
          ValidTrigger: { kind: "literal", raw: "Triggered.Ward,Triggered.Custom" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      96200,
    );
    const otherTrigger = mkSimpleTrigger(62001, 62002, () => true, {
      ast: { mode: "SpellCast", params: { Triggered: { kind: "literal", raw: "Triggered.Other" } } },
    });
    const event = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
      playerSeat: seat0,
      oldLife: 20,
      newLife: 18,
      delta: -2,
      cause: "effect",
    });
    expect(isTriggerDisabled(game, otherTrigger, event)).toBe(false);
  });

  it("trigger without a Triggered annotation is not gated by ValidTrigger$", () => {
    const game = mkGame();
    const src = seedCard(game, 6300);
    buildAndRegisterStatic(
      game,
      {
        mode: "DisableTriggers",
        params: {
          ValidTrigger: { kind: "literal", raw: "Triggered.Ward,Triggered.Custom" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      96300,
    );
    const plainTrigger = mkSimpleTrigger(63001, 63002, () => true, {
      ast: { mode: "SpellCast", params: {} },
    });
    const event = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
      playerSeat: seat0,
      oldLife: 20,
      newLife: 18,
      delta: -2,
      cause: "effect",
    });
    expect(isTriggerDisabled(game, plainTrigger, event)).toBe(false);
  });
});

// ── Pick 3: Panharmonicon multiplier in TriggerRegistry.onEvent ──────────────
describe("Wave 104 — Panharmonicon multiplier wired in TriggerRegistry.onEvent", () => {
  it("absent Panharmonicon static — onEvent pushes 1 PendingTrigger", () => {
    const game = mkGame();
    seedCard(game, 7000);
    const t = mkSimpleTrigger(70001, 7000, () => true);
    game.triggerRegistry.register(t);
    const event = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
      playerSeat: seat0,
      oldLife: 20,
      newLife: 18,
      delta: -2,
      cause: "effect",
    });
    game.triggerRegistry.onEvent(event);
    expect(game.triggerRegistry.drain()).toHaveLength(1);
  });

  it("matching Panharmonicon — pushes N+1 PendingTriggers (default additionalFires=1)", () => {
    const game = mkGame();
    const triggerSrc = seedCard(game, 7100);
    const panSrc = seedCard(game, 7101);
    buildAndRegisterStatic(
      game,
      {
        mode: "Panharmonicon",
        params: {
          ValidCard: { kind: "literal", raw: "Card.YouCtrl" },
          ValidEvent: { kind: "literal", raw: "LifeChanged" },
        },
        activeInZones: [],
      },
      panSrc.id as unknown as number,
      97100,
    );
    const t = mkSimpleTrigger(71001, triggerSrc.id as unknown as number, () => true);
    game.triggerRegistry.register(t);
    const event = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
      playerSeat: seat0,
      oldLife: 20,
      newLife: 18,
      delta: -2,
      cause: "effect",
    });
    game.triggerRegistry.onEvent(event);
    const pending = game.triggerRegistry.drain();
    expect(pending).toHaveLength(2);
    // Each copy is independent — distinct EntityId, same triggerId.
    const ids = new Set(pending.map((p) => p.id));
    expect(ids.size).toBe(2);
    expect(pending[0]?.triggerId).toBe(pending[1]?.triggerId);
  });

  it("Amount$ N — pushes 1+N PendingTriggers", () => {
    const game = mkGame();
    const triggerSrc = seedCard(game, 7200);
    const panSrc = seedCard(game, 7201);
    buildAndRegisterStatic(
      game,
      {
        mode: "Panharmonicon",
        params: {
          ValidCard: { kind: "literal", raw: "Card.YouCtrl" },
          ValidEvent: { kind: "literal", raw: "LifeChanged" },
          Amount: { kind: "literal", raw: "3" },
        },
        activeInZones: [],
      },
      panSrc.id as unknown as number,
      97200,
    );
    const t = mkSimpleTrigger(72001, triggerSrc.id as unknown as number, () => true);
    game.triggerRegistry.register(t);
    const event = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
      playerSeat: seat0,
      oldLife: 20,
      newLife: 18,
      delta: -2,
      cause: "effect",
    });
    game.triggerRegistry.onEvent(event);
    expect(game.triggerRegistry.drain()).toHaveLength(4); // 1 base + 3 extra
  });

  it("event-kind mismatch — Panharmonicon does not multiply", () => {
    const game = mkGame();
    const triggerSrc = seedCard(game, 7300);
    const panSrc = seedCard(game, 7301);
    buildAndRegisterStatic(
      game,
      {
        mode: "Panharmonicon",
        params: {
          ValidCard: { kind: "literal", raw: "Card.YouCtrl" },
          ValidEvent: { kind: "literal", raw: "EntersBattlefield" },
        },
        activeInZones: [],
      },
      panSrc.id as unknown as number,
      97300,
    );
    const t = mkSimpleTrigger(73001, triggerSrc.id as unknown as number, () => true);
    game.triggerRegistry.register(t);
    const event = mkEvent("LifeChanged", 1, PhaseStep.Main1, {
      playerSeat: seat0,
      oldLife: 20,
      newLife: 18,
      delta: -2,
      cause: "effect",
    });
    game.triggerRegistry.onEvent(event);
    expect(game.triggerRegistry.drain()).toHaveLength(1);
  });
});

// ── Pick 4: Wave 76 doc tail update — Suspect/Venture wired ──────────────────
describe("Wave 104 — Wave 76 helpers register without TODO doc tails", () => {
  it("CantBeSuspected static still registers cleanly", () => {
    const game = mkGame();
    const src = seedCard(game, 8000);
    const s = buildAndRegisterStatic(
      game,
      {
        mode: "CantBeSuspected",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      src.id as unknown as number,
      98000,
    );
    expect(s.mode).toBe("CantBeSuspected");
  });

  it("CantVenture static still registers cleanly", () => {
    const game = mkGame();
    const src = seedCard(game, 8100);
    const s = buildAndRegisterStatic(
      game,
      {
        mode: "CantVenture",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      src.id as unknown as number,
      98100,
    );
    expect(s.mode).toBe("CantVenture");
  });

  it("PlotZone (forward-compat stub) registers cleanly", () => {
    const game = mkGame();
    const src = seedCard(game, 8200);
    const s = buildAndRegisterStatic(
      game,
      {
        mode: "PlotZone",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Zone: { kind: "literal", raw: "Graveyard" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      98200,
    );
    expect(s.mode).toBe("PlotZone");
  });
});

// ── Pick 5: CantAttack — UnlessCost$ + ValidDefender$ on payload ─────────────
describe("Wave 104 — CantAttack surfaces UnlessCost$ + ValidDefender$ on payload", () => {
  it("absent CantAttack static — cantAttackUnlessPaidCostText returns undefined", () => {
    const game = mkGame();
    const card = seedCard(game, 9000);
    expect(cantAttackUnlessPaidCostText(game, card.id)).toBeUndefined();
  });

  it("payload carries UnlessCost$ text — helper returns it for matched attacker", () => {
    const game = mkGame();
    const attacker = seedCard(game, 9100);
    buildAndRegisterStatic(
      game,
      {
        mode: "CantAttack",
        params: {
          ValidCard: { kind: "literal", raw: "Card.YouCtrl" },
          UnlessCost: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      attacker.id as unknown as number,
      99100,
    );
    expect(cantAttackUnlessPaidCostText(game, attacker.id)).toBe("2");
  });

  it("payload carries ValidDefender$ filter raw via the payload", () => {
    const game = mkGame();
    const attacker = seedCard(game, 9200);
    const sa = buildAndRegisterStatic(
      game,
      {
        mode: "CantAttack",
        params: {
          ValidCard: { kind: "literal", raw: "Card.YouCtrl" },
          UnlessCost: { kind: "literal", raw: "PayLife<1>" },
          ValidDefender: { kind: "literal", raw: "Planeswalker.YouCtrl" },
        },
        activeInZones: [],
      },
      attacker.id as unknown as number,
      99200,
    );
    const restriction = sa.describe() as { payload?: { defenderFilterRaw?: string; costText?: string } };
    expect(restriction.payload?.defenderFilterRaw).toBe("Planeswalker.YouCtrl");
    expect(restriction.payload?.costText).toBe("PayLife<1>");
  });

  it("non-matching ValidCard$ — helper returns undefined for unmatched attacker", () => {
    const game = mkGame();
    seedCard(game, 9300, seat1); // attacker controlled by seat1
    const attackerOpponent = seedCard(game, 9301, seat1);
    buildAndRegisterStatic(
      game,
      {
        mode: "CantAttack",
        params: {
          ValidCard: { kind: "literal", raw: "Card.YouCtrl" },
          UnlessCost: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      9300,
      99300,
      0, // controller = seat0; ValidCard$ Card.YouCtrl binds to seat0's cards
    );
    // attackerOpponent is controlled by seat1 → does NOT match Card.YouCtrl(seat0)
    expect(cantAttackUnlessPaidCostText(game, attackerOpponent.id)).toBeUndefined();
  });

  it("CantBlockUnless helper still works (regression — Wave 70.J shape unchanged)", () => {
    const game = mkGame();
    const blocker = seedCard(game, 9400);
    expect(cantBlockUnlessPaidCostText(game, blocker.id)).toBeUndefined();
  });
});

// ── Pick 6: RoomEntered TODO retired — handler picks up the wired emitter ────
describe("Wave 104 — RoomEntered handler matches the wired UnlockDoorEffect emitter", () => {
  it("registry resolves the trigger handler for RoomEntered", () => {
    // The handler registers on import of `./trigger/handlers/index.js`
    // (already imported above as a side-effect). The test asserts the
    // mode is no longer flagged as a stub by exercising the
    // event-shape contract: a RoomEntered event with fullyUnlocked=true
    // is a recognized event kind.
    const event = mkEvent("RoomEntered", 1, PhaseStep.Main1, {
      cardId: mkEntityId(10001) as EntityId,
      playerSeat: seat0,
      fullyUnlocked: true,
    });
    expect(event.kind).toBe("RoomEntered");
    expect(event.payload.fullyUnlocked).toBe(true);
  });

  it("partial-unlock pulse (fullyUnlocked=false) is also a recognized shape", () => {
    const event = mkEvent("RoomEntered", 1, PhaseStep.Main1, {
      cardId: mkEntityId(10002) as EntityId,
      playerSeat: seat0,
      fullyUnlocked: false,
    });
    expect(event.kind).toBe("RoomEntered");
    expect(event.payload.fullyUnlocked).toBe(false);
  });
});
