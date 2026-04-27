// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 56 — ReplaceEffect family unit tests. Six sub-effects that mutate
// the in-flight replacement intent through the
// `game.flags.activeReplacementIntent` side channel:
//   ReplaceEffect / ReplaceDamage / ReplaceMana / ReplaceToken /
//   ReplaceCounter / ReplaceSplitDamage.
//
// Plus an integration smoke driving DamageReplacement → DBPrevent SVar →
// ReplaceEffect rewrite → mutated intent flowing back through apply().
import "../../ability/effects/index.js";
import "./damage-replacement.js";
import type {
  EffectInvocation,
  LobbyPlayer,
  MutationIntent,
  PaperCard,
  ReplacementAst,
  SVarAst,
} from "@mtg-forge-ts/core";
import {
  CardType,
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { effectRegistry } from "../../ability/effect-registry.js";
import { SpellAbility } from "../../ability/spell-ability.js";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Library } from "../../zone/zones/library.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { DamageReplacement } from "./damage-replacement.js";
import { runReplaceWithIntentMutation } from "./replace-with-svar.js";

const SOURCE = mkEntityId(10);
const REPL = mkEntityId(1);
const SEAT0 = mkPlayerSeat(0);
const SEAT1 = mkPlayerSeat(1);

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
const paper: PaperCard = {
  name: "Test",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = () => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
  }
  return game;
};

const mkSa = (
  handlerKey: string,
  params: Record<string, { kind: string; raw: string }>,
  sourceId = SOURCE,
  controllerSeat = SEAT0,
) =>
  new SpellAbility(
    {
      kind: "spell",
      effect: { handlerKey, params: params as never },
      cost: { raw: "" },
    },
    sourceId,
    controllerSeat,
    new Map<string, SVarAst>(),
    [],
  );

const drainGen = (gen: Generator<unknown, void, unknown>): unknown[] => {
  const out: unknown[] = [];
  let r = gen.next();
  while (!r.done) {
    out.push(r.value);
    r = gen.next();
  }
  return out;
};

// ---------------------------------------------------------------------------
// Direct sub-effect resolver tests — set the slot manually, run the effect,
// read back.
// ---------------------------------------------------------------------------

describe("Wave 56 — ReplaceEffect family registration", () => {
  it("registers all six handler keys", () => {
    for (const k of [
      "ReplaceEffect",
      "ReplaceDamage",
      "ReplaceMana",
      "ReplaceToken",
      "ReplaceCounter",
      "ReplaceSplitDamage",
    ]) {
      expect(effectRegistry.has(k)).toBe(true);
    }
  });
});

describe("Wave 56 — ReplaceEffect (generic VarName/VarValue)", () => {
  it("rewrites a numeric field on the in-flight intent", () => {
    const game = mkGame();
    const intent: MutationIntent = {
      kind: "damage",
      sourceId: mkEntityId(99),
      targetKind: "player",
      targetId: SEAT1,
      amount: 7,
      isCombat: false,
    } as unknown as MutationIntent;
    game.flags.activeReplacementIntent = intent as unknown;
    const sa = mkSa("ReplaceEffect", {
      VarName: { kind: "literal", raw: "amount" },
      VarValue: { kind: "literal", raw: "0" },
    });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const out = game.flags.activeReplacementIntent as { amount?: number };
    expect(out.amount).toBe(0);
  });

  it("rewrites a string field (Destination redirect)", () => {
    const game = mkGame();
    const intent: MutationIntent = {
      kind: "moveTo",
      cardId: mkEntityId(50),
      toZone: ZoneType.Graveyard,
      toSeat: SEAT0,
      cause: "test",
    } as unknown as MutationIntent;
    game.flags.activeReplacementIntent = intent as unknown;
    const sa = mkSa("ReplaceEffect", {
      VarName: { kind: "literal", raw: "toZone" },
      VarValue: { kind: "literal", raw: "Exile" },
    });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const out = game.flags.activeReplacementIntent as { toZone?: string };
    expect(out.toZone).toBe("Exile");
  });

  it("is a no-op when the slot is empty", () => {
    const game = mkGame();
    game.flags.activeReplacementIntent = null;
    const sa = mkSa("ReplaceEffect", {
      VarName: { kind: "literal", raw: "amount" },
      VarValue: { kind: "literal", raw: "0" },
    });
    expect(() =>
      drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>),
    ).not.toThrow();
    expect(game.flags.activeReplacementIntent).toBe(null);
  });
});

describe("Wave 56 — ReplaceDamage", () => {
  it("rewrites Amount on a damage intent", () => {
    const game = mkGame();
    const intent: MutationIntent = {
      kind: "damage",
      sourceId: mkEntityId(99),
      targetKind: "player",
      targetId: SEAT1,
      amount: 5,
      isCombat: false,
    } as unknown as MutationIntent;
    game.flags.activeReplacementIntent = intent as unknown;
    const sa = mkSa("ReplaceDamage", { Amount: { kind: "literal", raw: "1" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const out = game.flags.activeReplacementIntent as { amount?: number };
    expect(out.amount).toBe(1);
  });

  it("Target$ You routes damage to the controller's seat", () => {
    const game = mkGame();
    const intent: MutationIntent = {
      kind: "damage",
      sourceId: mkEntityId(99),
      targetKind: "creature",
      targetId: mkEntityId(60),
      amount: 3,
      isCombat: false,
    } as unknown as MutationIntent;
    game.flags.activeReplacementIntent = intent as unknown;
    const sa = mkSa("ReplaceDamage", { Target: { kind: "literal", raw: "You" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const out = game.flags.activeReplacementIntent as { targetKind?: string; targetId?: unknown };
    expect(out.targetKind).toBe("player");
    expect(out.targetId).toBe(SEAT0);
  });

  it("is a no-op on a non-damage intent", () => {
    const game = mkGame();
    const intent: MutationIntent = {
      kind: "drawCards",
      seat: SEAT0,
      count: 1,
    } as unknown as MutationIntent;
    game.flags.activeReplacementIntent = intent as unknown;
    const sa = mkSa("ReplaceDamage", { Amount: { kind: "literal", raw: "0" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const out = game.flags.activeReplacementIntent as { amount?: number };
    expect(out.amount).toBeUndefined();
  });
});

describe("Wave 56 — ReplaceMana", () => {
  it("From/To swaps a mana symbol", () => {
    const game = mkGame();
    const intent: MutationIntent = {
      kind: "produceMana",
      seat: SEAT0,
      sourceId: SOURCE,
      symbols: ["B", "B", "C"],
    } as unknown as MutationIntent;
    game.flags.activeReplacementIntent = intent as unknown;
    const sa = mkSa("ReplaceMana", {
      From: { kind: "literal", raw: "B" },
      To: { kind: "literal", raw: "G" },
    });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const out = game.flags.activeReplacementIntent as { symbols?: readonly string[] };
    expect(out.symbols).toEqual(["G", "G", "C"]);
  });

  it("Color$ X recolors all symbols", () => {
    const game = mkGame();
    const intent: MutationIntent = {
      kind: "produceMana",
      seat: SEAT0,
      sourceId: SOURCE,
      symbols: ["W", "U"],
    } as unknown as MutationIntent;
    game.flags.activeReplacementIntent = intent as unknown;
    const sa = mkSa("ReplaceMana", { Color: { kind: "literal", raw: "R" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const out = game.flags.activeReplacementIntent as { symbols?: readonly string[] };
    expect(out.symbols).toEqual(["R", "R"]);
  });
});

describe("Wave 56 — ReplaceToken", () => {
  it("Multiplier$ 2 doubles count", () => {
    const game = mkGame();
    const intent: MutationIntent = {
      kind: "createToken",
      controllerSeat: SEAT0,
      paperCard: paper,
      count: 1,
      isCopy: false,
      copyOf: null,
    } as unknown as MutationIntent;
    game.flags.activeReplacementIntent = intent as unknown;
    const sa = mkSa("ReplaceToken", { Multiplier: { kind: "literal", raw: "2" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const out = game.flags.activeReplacementIntent as { count?: number };
    expect(out.count).toBe(2);
  });

  it("Color$ stamps tokenColorOverride slot", () => {
    const game = mkGame();
    const intent: MutationIntent = {
      kind: "createToken",
      controllerSeat: SEAT0,
      paperCard: paper,
      count: 1,
      isCopy: false,
      copyOf: null,
    } as unknown as MutationIntent;
    game.flags.activeReplacementIntent = intent as unknown;
    const sa = mkSa("ReplaceToken", { Color: { kind: "literal", raw: "G" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const out = game.flags.activeReplacementIntent as { tokenColorOverride?: string };
    expect(out.tokenColorOverride).toBe("G");
  });
});

describe("Wave 56 — ReplaceCounter", () => {
  it("Multiplier$ 2 doubles amount", () => {
    const game = mkGame();
    const intent: MutationIntent = {
      kind: "addCounter",
      cardId: mkEntityId(50),
      counterType: CounterType.PlusOnePlusOne,
      amount: 3,
      sourceId: null,
    } as unknown as MutationIntent;
    game.flags.activeReplacementIntent = intent as unknown;
    const sa = mkSa("ReplaceCounter", { Multiplier: { kind: "literal", raw: "2" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const out = game.flags.activeReplacementIntent as { amount?: number };
    expect(out.amount).toBe(6);
  });

  it("CounterType$ override swaps the kind", () => {
    const game = mkGame();
    const intent: MutationIntent = {
      kind: "addCounter",
      cardId: mkEntityId(50),
      counterType: CounterType.PlusOnePlusOne,
      amount: 1,
      sourceId: null,
    } as unknown as MutationIntent;
    game.flags.activeReplacementIntent = intent as unknown;
    const sa = mkSa("ReplaceCounter", { CounterType: { kind: "literal", raw: "KO" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const out = game.flags.activeReplacementIntent as { counterType?: unknown };
    expect(out.counterType).toBe("KO");
  });
});

describe("Wave 56 — ReplaceSplitDamage", () => {
  it("partitions damage into N requests", () => {
    const game = mkGame();
    const intent: MutationIntent = {
      kind: "damage",
      sourceId: mkEntityId(99),
      targetKind: "player",
      targetId: SEAT1,
      amount: 6,
      isCombat: false,
    } as unknown as MutationIntent;
    game.flags.activeReplacementIntent = intent as unknown;
    const sa = mkSa("ReplaceSplitDamage", { NumTargets: { kind: "literal", raw: "2" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const out = game.flags.activeReplacementIntent as {
      splitDamageRequests?: readonly { index: number; amount: number }[];
    };
    expect(out.splitDamageRequests?.length).toBe(2);
    expect(out.splitDamageRequests?.[0]?.amount).toBe(3);
    expect(out.splitDamageRequests?.[1]?.amount).toBe(3);
  });

  it("uneven amount routes the remainder onto the first slot", () => {
    const game = mkGame();
    const intent: MutationIntent = {
      kind: "damage",
      sourceId: mkEntityId(99),
      targetKind: "player",
      targetId: SEAT1,
      amount: 7,
      isCombat: false,
    } as unknown as MutationIntent;
    game.flags.activeReplacementIntent = intent as unknown;
    const sa = mkSa("ReplaceSplitDamage", { NumTargets: { kind: "literal", raw: "2" } });
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const out = game.flags.activeReplacementIntent as {
      splitDamageRequests?: readonly { index: number; amount: number }[];
    };
    expect(out.splitDamageRequests?.[0]?.amount).toBe(4);
    expect(out.splitDamageRequests?.[1]?.amount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Integration smoke — DamageReplacement parent → DBPrevent SVar → ReplaceEffect
// rewrite → mutated intent flowing back through apply().
// ---------------------------------------------------------------------------

describe("Wave 56 — DamageReplacement integration with ReplaceEffect", () => {
  it("DBPrevent SVar (ReplaceEffect amount=0) zeros the damage intent", () => {
    const game = mkGame();
    // Build a source paper that exposes a DBPrevent SVar resolving to
    // DB$ ReplaceEffect | VarName$ amount | VarValue$ 0.
    const svars = new Map<string, SVarAst>();
    const replaceAbility: EffectInvocation = {
      handlerKey: "ReplaceEffect",
      params: {
        VarName: { kind: "literal", raw: "amount" },
        VarValue: { kind: "literal", raw: "0" },
      },
    } as unknown as EffectInvocation;
    svars.set("DBPrevent", {
      kind: "ability",
      raw: "DB$ ReplaceEffect | VarName$ amount | VarValue$ 0",
      ability: replaceAbility,
    });
    const sourcePaper = {
      ...paper,
      definition: {
        name: "Test",
        types: { has: (t: string) => t === CardType.Enchantment, hasSubtype: () => false },
        superTypes: new Set<string>(),
        subTypes: new Set<string>(),
        colors: new Set<string>(),
        abilities: [],
        triggers: [],
        statics: [],
        replacements: [],
        keywords: [],
        svars,
      },
    } as unknown as PaperCard;
    const source = new Card(SOURCE, sourcePaper, SEAT0, SEAT0, ZoneType.Battlefield);
    game.cards.set(SOURCE, source);

    const ast: ReplacementAst = {
      eventKind: "DamageDone",
      params: {
        ValidTarget: { kind: "literal", raw: "Any" },
        ReplaceWith: { kind: "literal", raw: "DBPrevent" },
      },
      effect: { handlerKey: "DBPrevent", params: {} },
    } as unknown as ReplacementAst;
    const ctx: ReplacementBuildContext = {
      game,
      sourceCardId: SOURCE,
      controllerSeat: SEAT0,
      replacementId: REPL,
    };
    const ra = new DamageReplacement().build(ast, ctx);
    const intent: MutationIntent = {
      kind: "damage",
      sourceId: mkEntityId(99),
      targetKind: "player",
      targetId: SEAT1,
      amount: 5,
      isCombat: false,
    } as unknown as MutationIntent;
    const result = ra.apply(intent, game) as MutationIntent | null;
    expect(result).not.toBeNull();
    expect((result as { amount?: number }).amount).toBe(0);
    // Side channel cleared after apply().
    expect(game.flags.activeReplacementIntent).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Helper exercise — runReplaceWithIntentMutation directly drives an SVar
// dispatch over an arbitrary intent.
// ---------------------------------------------------------------------------

describe("Wave 56 — runReplaceWithIntentMutation helper", () => {
  it("runs a ReplaceCounter SVar and returns the doubled intent", () => {
    const game = mkGame();
    const ability: EffectInvocation = {
      handlerKey: "ReplaceCounter",
      params: { Multiplier: { kind: "literal", raw: "2" } },
    } as unknown as EffectInvocation;
    const intent: MutationIntent = {
      kind: "addCounter",
      cardId: mkEntityId(50),
      counterType: CounterType.PlusOnePlusOne,
      amount: 1,
      sourceId: null,
    } as unknown as MutationIntent;
    const result = runReplaceWithIntentMutation(game, SOURCE, SEAT0, ability, intent);
    expect(result).not.toBeNull();
    expect((result as { amount?: number }).amount).toBe(2);
    // Slot reset to prior (null) after runner exits.
    expect(game.flags.activeReplacementIntent).toBe(null);
  });
});
