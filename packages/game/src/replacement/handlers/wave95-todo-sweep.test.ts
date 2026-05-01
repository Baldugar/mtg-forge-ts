// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 95 — closes the six TODO(advanced) tails on the Wave-48 replacement
// handlers (AssignDealDamage / DealtDamage / DeclareBlocker /
// PlanarDiceResult / SetInMotion / Tap). Each handler now carries a small
// apply-path beyond the prevent / passthrough baseline.
import "../../ability/effects/index.js";
import "../index.js";
import type {
  EffectInvocation,
  EntityId,
  LobbyPlayer,
  MutationIntent,
  PaperCard,
  ReplacementAst,
  SVarAst,
} from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Library } from "../../zone/zones/library.js";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";

const SOURCE = mkEntityId(10);
const ATTACKER = mkEntityId(20);
const OTHER_ATTACKER = mkEntityId(21);
const BLOCKER = mkEntityId(30);
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
const basePaper: PaperCard = {
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

const installSourceWithSvars = (game: Game, svars: Map<string, SVarAst>): void => {
  const sourcePaper = {
    ...basePaper,
    definition: {
      name: "Test",
      types: { has: () => false, hasSubtype: () => false },
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
};

const mkSvar = (ability: EffectInvocation): SVarAst => ({
  kind: "ability",
  raw: "test",
  ability,
});

const mkCtx = (game: Game): ReplacementBuildContext => ({
  game,
  sourceCardId: SOURCE,
  controllerSeat: SEAT0,
  replacementId: REPL,
});

// ---------------------------------------------------------------------------
// AssignDealDamage — RedirectTo$ Controller
// ---------------------------------------------------------------------------

describe("Wave 95 — AssignDealDamage RedirectTo$ Controller", () => {
  it("rewrites every assignment's targetId to the controller seat", () => {
    const game = mkGame();
    const ast: ReplacementAst = {
      eventKind: "AssignDealDamage",
      params: {
        ValidSource: { kind: "literal", raw: "Card.Self" },
        RedirectTo: { kind: "literal", raw: "Controller" },
      },
      effect: { handlerKey: "AssignDealDamage", params: {} },
      isSelf: true,
    } as unknown as ReplacementAst;
    const Cls = replacementHandlerRegistry.lookup("AssignDealDamage");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ra = new Cls().build(ast, mkCtx(game));
    const intent: MutationIntent = {
      kind: "assignDealDamage",
      sourceId: SOURCE,
      assignments: [
        { targetId: mkEntityId(80), amount: 3 },
        { targetId: mkEntityId(81), amount: 2 },
      ],
    } as unknown as MutationIntent;
    const result = ra.apply(intent, game) as MutationIntent | null;
    expect(result).not.toBeNull();
    const out = result as unknown as {
      assignments: { targetId: EntityId; amount: number }[];
    };
    expect(out.assignments).toHaveLength(2);
    for (const a of out.assignments) {
      expect(a.targetId as unknown as number).toBe(SEAT0 as unknown as number);
    }
    // Amounts preserved.
    expect(out.assignments[0]?.amount).toBe(3);
    expect(out.assignments[1]?.amount).toBe(2);
  });

  it("does NOT match an assignDealDamage from a different source under ValidSource$ Card.Self", () => {
    const game = mkGame();
    const ast: ReplacementAst = {
      eventKind: "AssignDealDamage",
      params: {
        ValidSource: { kind: "literal", raw: "Card.Self" },
        RedirectTo: { kind: "literal", raw: "Controller" },
      },
      effect: { handlerKey: "AssignDealDamage", params: {} },
      isSelf: true,
    } as unknown as ReplacementAst;
    const Cls = replacementHandlerRegistry.lookup("AssignDealDamage");
    if (!Cls) return;
    const ra = new Cls().build(ast, mkCtx(game));
    const intent: MutationIntent = {
      kind: "assignDealDamage",
      sourceId: mkEntityId(999),
      assignments: [{ targetId: mkEntityId(80), amount: 3 }],
    } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DealtDamage — Amount$ literal rewrite
// ---------------------------------------------------------------------------

describe("Wave 95 — DealtDamage Amount$ literal rewrite", () => {
  it("rewrites intent.amount to the literal value", () => {
    const game = mkGame();
    const ast: ReplacementAst = {
      eventKind: "DealtDamage",
      params: {
        Amount: { kind: "literal", raw: "0" },
      },
      effect: { handlerKey: "DealtDamage", params: {} },
    } as unknown as ReplacementAst;
    const Cls = replacementHandlerRegistry.lookup("DealtDamage");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ra = new Cls().build(ast, mkCtx(game));
    const intent: MutationIntent = {
      kind: "damage",
      sourceId: mkEntityId(70),
      targetKind: "creature",
      targetId: mkEntityId(80),
      amount: 5,
      isCombat: false,
    } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(true);
    const result = ra.apply(intent, game) as MutationIntent | null;
    expect(result).not.toBeNull();
    expect((result as { amount?: number }).amount).toBe(0);
  });

  it("Layer$ CantHappen returns null even if Amount also set", () => {
    const game = mkGame();
    const ast: ReplacementAst = {
      eventKind: "DealtDamage",
      params: {
        Layer: { kind: "literal", raw: "CantHappen" },
        Amount: { kind: "literal", raw: "7" },
      },
      effect: { handlerKey: "Prevent", params: {} },
    } as unknown as ReplacementAst;
    const Cls = replacementHandlerRegistry.lookup("DealtDamage");
    if (!Cls) return;
    const ra = new Cls().build(ast, mkCtx(game));
    const intent: MutationIntent = {
      kind: "damage",
      sourceId: mkEntityId(70),
      targetKind: "creature",
      targetId: mkEntityId(80),
      amount: 5,
      isCombat: false,
    } as unknown as MutationIntent;
    expect(ra.apply(intent, game)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DeclareBlocker — ValidAttacker$ Card.Self routing
// ---------------------------------------------------------------------------

describe("Wave 95 — DeclareBlocker ValidAttacker$ Card.Self", () => {
  it("matches a declareBlocker intent whose attackerIds includes the source", () => {
    const game = mkGame();
    const ast: ReplacementAst = {
      eventKind: "DeclareBlocker",
      params: {
        ValidAttacker: { kind: "literal", raw: "Card.Self" },
        Layer: { kind: "literal", raw: "CantHappen" },
      },
      effect: { handlerKey: "Prevent", params: {} },
      isSelf: true,
    } as unknown as ReplacementAst;
    const Cls = replacementHandlerRegistry.lookup("DeclareBlocker");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ra = new Cls().build(ast, mkCtx(game));
    const intent: MutationIntent = {
      kind: "declareBlocker",
      blockerId: BLOCKER,
      attackerIds: [SOURCE, OTHER_ATTACKER],
    } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(true);
    expect(ra.apply(intent, game)).toBeNull();
  });

  it("does NOT match a declareBlocker intent whose attackerIds excludes the source", () => {
    const game = mkGame();
    const ast: ReplacementAst = {
      eventKind: "DeclareBlocker",
      params: {
        ValidAttacker: { kind: "literal", raw: "Card.Self" },
        Layer: { kind: "literal", raw: "CantHappen" },
      },
      effect: { handlerKey: "Prevent", params: {} },
      isSelf: true,
    } as unknown as ReplacementAst;
    const Cls = replacementHandlerRegistry.lookup("DeclareBlocker");
    if (!Cls) return;
    const ra = new Cls().build(ast, mkCtx(game));
    const intent: MutationIntent = {
      kind: "declareBlocker",
      blockerId: BLOCKER,
      attackerIds: [ATTACKER, OTHER_ATTACKER],
    } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PlanarDiceResult — MatchFace + ResultFace face-rewrite
// ---------------------------------------------------------------------------

describe("Wave 95 — PlanarDiceResult MatchFace$/ResultFace$", () => {
  it("rewrites face from blank to chaos when MatchFace$ blank matches", () => {
    const game = mkGame();
    const ast: ReplacementAst = {
      eventKind: "PlanarDiceResult",
      params: {
        MatchFace: { kind: "literal", raw: "blank" },
        ResultFace: { kind: "literal", raw: "chaos" },
      },
      effect: { handlerKey: "PlanarDiceResult", params: {} },
    } as unknown as ReplacementAst;
    const Cls = replacementHandlerRegistry.lookup("PlanarDiceResult");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ra = new Cls().build(ast, mkCtx(game));
    const intent: MutationIntent = {
      kind: "planarDiceResult",
      seat: SEAT0,
      face: "blank",
    } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(true);
    const result = ra.apply(intent, game) as MutationIntent | null;
    expect(result).not.toBeNull();
    expect((result as { face?: string }).face).toBe("chaos");
  });

  it("does NOT match a planarDiceResult whose face mismatches MatchFace$", () => {
    const game = mkGame();
    const ast: ReplacementAst = {
      eventKind: "PlanarDiceResult",
      params: {
        MatchFace: { kind: "literal", raw: "blank" },
        ResultFace: { kind: "literal", raw: "chaos" },
      },
      effect: { handlerKey: "PlanarDiceResult", params: {} },
    } as unknown as ReplacementAst;
    const Cls = replacementHandlerRegistry.lookup("PlanarDiceResult");
    if (!Cls) return;
    const ra = new Cls().build(ast, mkCtx(game));
    const intent: MutationIntent = {
      kind: "planarDiceResult",
      seat: SEAT0,
      face: "chaos",
    } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SetInMotion — ReplaceWith$ <SVar> synchronous dispatch
// ---------------------------------------------------------------------------

describe("Wave 95 — SetInMotion ReplaceWith$ SVar dispatch", () => {
  it("returns null after running the SVar, treating canonical SetInMotion as replaced", () => {
    const game = mkGame();
    const svars = new Map<string, SVarAst>();
    // Use a known no-op-friendly handler — ReplaceEffect with no slot is a
    // safe no-op (getActiveIntent returns null and the handler returns).
    svars.set(
      "DBSubst",
      mkSvar({
        handlerKey: "ReplaceEffect",
        params: {
          VarName: { kind: "literal", raw: "schemeId" },
          VarValue: { kind: "literal", raw: "0" },
        },
      } as unknown as EffectInvocation),
    );
    installSourceWithSvars(game, svars);

    const ast: ReplacementAst = {
      eventKind: "SetInMotion",
      params: {
        ReplaceWith: { kind: "literal", raw: "DBSubst" },
      },
      effect: { handlerKey: "SetInMotion", params: {} },
    } as unknown as ReplacementAst;
    const Cls = replacementHandlerRegistry.lookup("SetInMotion");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ra = new Cls().build(ast, mkCtx(game));
    const intent: MutationIntent = {
      kind: "setInMotion",
      schemeId: mkEntityId(60),
      seat: SEAT1,
    } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(true);
    const result = ra.apply(intent, game);
    // SVar dispatch path treats the canonical event as replaced.
    expect(result).toBeNull();
  });

  it("falls through to identity when no ReplaceWith$ is set", () => {
    const game = mkGame();
    const ast: ReplacementAst = {
      eventKind: "SetInMotion",
      params: {},
      effect: { handlerKey: "SetInMotion", params: {} },
    } as unknown as ReplacementAst;
    const Cls = replacementHandlerRegistry.lookup("SetInMotion");
    if (!Cls) return;
    const ra = new Cls().build(ast, mkCtx(game));
    const intent: MutationIntent = {
      kind: "setInMotion",
      schemeId: mkEntityId(60),
      seat: SEAT1,
    } as unknown as MutationIntent;
    const result = ra.apply(intent, game);
    expect(result).not.toBeNull();
    expect((result as { kind?: string }).kind).toBe("setInMotion");
  });
});

// ---------------------------------------------------------------------------
// Tap — ReplaceWith$ <SVar> mana-pool boost ride-along
// ---------------------------------------------------------------------------

describe("Wave 95 — Tap ReplaceWith$ SVar ride-along", () => {
  it("returns the tap intent unchanged after running the SVar (canonical tap proceeds)", () => {
    const game = mkGame();
    const svars = new Map<string, SVarAst>();
    svars.set(
      "DBManaBoost",
      mkSvar({
        handlerKey: "ReplaceEffect",
        params: {
          VarName: { kind: "literal", raw: "boost" },
          VarValue: { kind: "literal", raw: "1" },
        },
      } as unknown as EffectInvocation),
    );
    installSourceWithSvars(game, svars);

    const ast: ReplacementAst = {
      eventKind: "Tap",
      params: {
        ValidCard: { kind: "literal", raw: "Card.Self" },
        ReplaceWith: { kind: "literal", raw: "DBManaBoost" },
      },
      effect: { handlerKey: "Tap", params: {} },
      isSelf: true,
    } as unknown as ReplacementAst;
    const Cls = replacementHandlerRegistry.lookup("Tap");
    expect(Cls).toBeDefined();
    if (!Cls) return;
    const ra = new Cls().build(ast, mkCtx(game));
    const intent: MutationIntent = {
      kind: "tap",
      cardId: SOURCE,
    } as unknown as MutationIntent;
    expect(ra.matches(intent)).toBe(true);
    const result = ra.apply(intent, game);
    // Tap still proceeds — intent flows through unchanged.
    expect(result).not.toBeNull();
    expect((result as { kind?: string }).kind).toBe("tap");
  });

  it("Layer$ CantHappen still blocks the tap when set, even if ReplaceWith$ is configured", () => {
    const game = mkGame();
    const ast: ReplacementAst = {
      eventKind: "Tap",
      params: {
        ValidCard: { kind: "literal", raw: "Card.Self" },
        Layer: { kind: "literal", raw: "CantHappen" },
        ReplaceWith: { kind: "literal", raw: "DBManaBoost" },
      },
      effect: { handlerKey: "Prevent", params: {} },
      isSelf: true,
    } as unknown as ReplacementAst;
    const Cls = replacementHandlerRegistry.lookup("Tap");
    if (!Cls) return;
    const ra = new Cls().build(ast, mkCtx(game));
    const intent: MutationIntent = {
      kind: "tap",
      cardId: SOURCE,
    } as unknown as MutationIntent;
    expect(ra.apply(intent, game)).toBeNull();
  });
});
