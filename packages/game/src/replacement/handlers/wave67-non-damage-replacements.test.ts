// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 67 — non-Damage parent replacement intent threading.
//
// Wave 56 wired the `ReplaceEffect` family (DB$ ReplaceEffect / ReplaceDamage
// / ReplaceMana / ReplaceToken / ReplaceCounter / ReplaceSplitDamage) and the
// `game.flags.activeReplacementIntent` side channel ONLY for Damage parents.
// Wave 67 extends the same machinery to four more parent event kinds:
//
//   - Moved        (zone change)        → Rest in Peace / Leyline of the Void
//   - AddCounter   (counter-add)        → Doubling Season / Hardened Scales
//   - CreateToken  (token creation)     → Anointed Procession / Parallel Lives
//   - ProduceMana  (mana production)    → Mana Reflection / Mirari's Wake
//
// Each parent's apply() consults `lookupReplaceWithAbility` for its
// `ReplaceWith$ <SVar>` and, when the SVar resolves to a ReplaceEffect-family
// handler, threads the in-flight intent through `runReplaceWithIntentMutation`
// so the SVar resolver's output flows back into the apply loop.
import "../../ability/effects/index.js";
import "./moved-replacement.js";
import "./add-counter-replacement.js";
import "./create-token-replacement.js";
import "./wave-20-replacements.js";
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
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Library } from "../../zone/zones/library.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { AddCounterReplacement } from "./add-counter-replacement.js";
import { CreateTokenReplacement } from "./create-token-replacement.js";
import { MovedReplacement } from "./moved-replacement.js";
import { ProduceManaReplacement } from "./wave-20-replacements.js";

const SOURCE = mkEntityId(10);
const REPL = mkEntityId(1);
const SEAT0 = mkPlayerSeat(0);

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

/**
 * Stamp a source card on `game` whose paperCard.definition exposes the given
 * SVar map. The replacement's apply() walks the source's SVar map to dispatch
 * `ReplaceWith$ <SVar>` lookups; without a definition+svars on the source,
 * the dispatch falls through to inline behavior.
 */
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
// Moved parent — Rest in Peace / Leyline of the Void / Eldrazi shuffle.
// ---------------------------------------------------------------------------

describe("Wave 67 — Moved parent threading", () => {
  it("Rest in Peace shape: redirects Battlefield→Graveyard to Exile via DB$ ReplaceEffect SVar", () => {
    const game = mkGame();
    const svars = new Map<string, SVarAst>();
    svars.set(
      "DBExileSvar",
      mkSvar({
        handlerKey: "ReplaceEffect",
        params: {
          VarName: { kind: "literal", raw: "toZone" },
          VarValue: { kind: "literal", raw: "Exile" },
        },
      } as unknown as EffectInvocation),
    );
    installSourceWithSvars(game, svars);

    const ast: ReplacementAst = {
      eventKind: "Moved",
      params: {
        Origin: { kind: "literal", raw: "Any" },
        Destination: { kind: "literal", raw: "Graveyard" },
        ValidCard: { kind: "literal", raw: "Card" },
        ReplaceWith: { kind: "literal", raw: "DBExileSvar" },
      },
      effect: { handlerKey: "DBExileSvar", params: {} },
    } as unknown as ReplacementAst;
    const ra = new MovedReplacement().build(ast, mkCtx(game));
    const intent: MutationIntent = {
      kind: "moveTo",
      cardId: mkEntityId(50),
      fromZone: ZoneType.Battlefield,
      toZone: ZoneType.Graveyard,
      toSeat: null,
      cause: "test",
    } as unknown as MutationIntent;
    const result = ra.apply(intent, game) as MutationIntent | null;
    expect(result).not.toBeNull();
    expect((result as { toZone?: string }).toZone).toBe("Exile");
    // Side channel cleared after apply().
    expect(game.flags.activeReplacementIntent).toBe(null);
  });

  it("Eldrazi shuffle shape: redirects Hand→Graveyard to Library via DB$ ReplaceEffect SVar", () => {
    const game = mkGame();
    const svars = new Map<string, SVarAst>();
    svars.set(
      "DBToLibrary",
      mkSvar({
        handlerKey: "ReplaceEffect",
        params: {
          VarName: { kind: "literal", raw: "toZone" },
          VarValue: { kind: "literal", raw: "Library" },
        },
      } as unknown as EffectInvocation),
    );
    installSourceWithSvars(game, svars);

    const ast: ReplacementAst = {
      eventKind: "Moved",
      params: {
        Destination: { kind: "literal", raw: "Graveyard" },
        ValidCard: { kind: "literal", raw: "Card" },
        ReplaceWith: { kind: "literal", raw: "DBToLibrary" },
      },
      effect: { handlerKey: "DBToLibrary", params: {} },
    } as unknown as ReplacementAst;
    const ra = new MovedReplacement().build(ast, mkCtx(game));
    const intent: MutationIntent = {
      kind: "moveTo",
      cardId: mkEntityId(50),
      fromZone: ZoneType.Hand,
      toZone: ZoneType.Graveyard,
      toSeat: null,
      cause: "test",
    } as unknown as MutationIntent;
    const result = ra.apply(intent, game) as MutationIntent | null;
    expect(result).not.toBeNull();
    expect((result as { toZone?: string }).toZone).toBe("Library");
  });
});

// ---------------------------------------------------------------------------
// AddCounter parent — Doubling Season / Hardened Scales / Vorinclex.
// ---------------------------------------------------------------------------

describe("Wave 67 — AddCounter parent threading", () => {
  it("Doubling Season +1/+1 counter shape: doubles via DB$ ReplaceCounter SVar", () => {
    const game = mkGame();
    const svars = new Map<string, SVarAst>();
    svars.set(
      "DBDouble",
      mkSvar({
        handlerKey: "ReplaceCounter",
        params: { Multiplier: { kind: "literal", raw: "2" } },
      } as unknown as EffectInvocation),
    );
    installSourceWithSvars(game, svars);

    const ast: ReplacementAst = {
      eventKind: "AddCounter",
      params: {
        ValidCard: { kind: "literal", raw: "Permanent" },
        ReplaceWith: { kind: "literal", raw: "DBDouble" },
      },
      effect: { handlerKey: "DBDouble", params: {} },
    } as unknown as ReplacementAst;
    const ra = new AddCounterReplacement().build(ast, mkCtx(game));
    const intent: MutationIntent = {
      kind: "addCounter",
      cardId: mkEntityId(50),
      counterType: CounterType.PlusOnePlusOne,
      amount: 2,
      sourceId: null,
    } as unknown as MutationIntent;
    const result = ra.apply(intent, game) as MutationIntent | null;
    expect(result).not.toBeNull();
    // 2 base × 2 multiplier = 4
    expect((result as { amount?: number }).amount).toBe(4);
  });

  it("Doubling Season planeswalker loyalty counter shape: doubles loyalty placed at ETB", () => {
    const game = mkGame();
    const svars = new Map<string, SVarAst>();
    svars.set(
      "DBDouble",
      mkSvar({
        handlerKey: "ReplaceCounter",
        params: { Multiplier: { kind: "literal", raw: "2" } },
      } as unknown as EffectInvocation),
    );
    installSourceWithSvars(game, svars);

    const ast: ReplacementAst = {
      eventKind: "AddCounter",
      params: {
        ValidCard: { kind: "literal", raw: "Permanent" },
        ReplaceWith: { kind: "literal", raw: "DBDouble" },
      },
      effect: { handlerKey: "DBDouble", params: {} },
    } as unknown as ReplacementAst;
    const ra = new AddCounterReplacement().build(ast, mkCtx(game));
    const intent: MutationIntent = {
      kind: "addCounter",
      cardId: mkEntityId(50),
      counterType: CounterType.Loyalty,
      amount: 3, // PW with 3 starting loyalty
      sourceId: null,
    } as unknown as MutationIntent;
    const result = ra.apply(intent, game) as MutationIntent | null;
    expect(result).not.toBeNull();
    expect((result as { amount?: number }).amount).toBe(6);
    // CounterType preserved.
    expect((result as { counterType?: unknown }).counterType).toBe(CounterType.Loyalty);
  });
});

// ---------------------------------------------------------------------------
// CreateToken parent — Anointed Procession / Parallel Lives + stacking.
// ---------------------------------------------------------------------------

describe("Wave 67 — CreateToken parent threading", () => {
  it("Anointed Procession shape: doubles count via DB$ ReplaceToken SVar", () => {
    const game = mkGame();
    const svars = new Map<string, SVarAst>();
    svars.set(
      "DBDouble",
      mkSvar({
        handlerKey: "ReplaceToken",
        params: { Multiplier: { kind: "literal", raw: "2" } },
      } as unknown as EffectInvocation),
    );
    installSourceWithSvars(game, svars);

    const ast: ReplacementAst = {
      eventKind: "CreateToken",
      params: {
        ValidPlayer: { kind: "literal", raw: "You" },
        ReplaceWith: { kind: "literal", raw: "DBDouble" },
      },
      effect: { handlerKey: "DBDouble", params: {} },
    } as unknown as ReplacementAst;
    const ra = new CreateTokenReplacement().build(ast, mkCtx(game));
    const intent: MutationIntent = {
      kind: "createToken",
      controllerSeat: SEAT0,
      paperCard: basePaper,
      count: 1,
      isCopy: false,
      copyOf: null,
    } as unknown as MutationIntent;
    const result = ra.apply(intent, game) as MutationIntent | null;
    expect(result).not.toBeNull();
    expect((result as { count?: number }).count).toBe(2);
  });

  it("Stacked doublers: 2x Anointed Procession applied sequentially yields 4× tokens", () => {
    const game = mkGame();
    const svars = new Map<string, SVarAst>();
    svars.set(
      "DBDouble",
      mkSvar({
        handlerKey: "ReplaceToken",
        params: { Multiplier: { kind: "literal", raw: "2" } },
      } as unknown as EffectInvocation),
    );
    installSourceWithSvars(game, svars);

    const ast: ReplacementAst = {
      eventKind: "CreateToken",
      params: {
        ValidPlayer: { kind: "literal", raw: "You" },
        ReplaceWith: { kind: "literal", raw: "DBDouble" },
      },
      effect: { handlerKey: "DBDouble", params: {} },
    } as unknown as ReplacementAst;
    const ra1 = new CreateTokenReplacement().build(ast, mkCtx(game));
    const ra2 = new CreateTokenReplacement().build(ast, mkCtx(game));
    const intent: MutationIntent = {
      kind: "createToken",
      controllerSeat: SEAT0,
      paperCard: basePaper,
      count: 1,
      isCopy: false,
      copyOf: null,
    } as unknown as MutationIntent;
    // Apply first Anointed Procession.
    const after1 = ra1.apply(intent, game) as MutationIntent;
    expect((after1 as { count?: number }).count).toBe(2);
    // Apply second Anointed Procession to the (already-doubled) intent —
    // mirrors the multi-replacement-on-same-event apply-loop semantics.
    const after2 = ra2.apply(after1, game) as MutationIntent;
    expect((after2 as { count?: number }).count).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// ProduceMana parent — Wave 20 inline shape preserved + Wave 67 SVar shape.
// ---------------------------------------------------------------------------

describe("Wave 67 — ProduceMana parent threading", () => {
  it("Wave 20 inline shape preserved: bare Multiplier$ 2 still doubles symbols", () => {
    const game = mkGame();
    // No SVar map / source card needed — inline path runs without lookup.
    const ast: ReplacementAst = {
      eventKind: "ProduceMana",
      params: {
        ValidPlayer: { kind: "literal", raw: "You" },
        Multiplier: { kind: "literal", raw: "2" },
      },
      effect: { handlerKey: "Mana", params: {} },
    } as unknown as ReplacementAst;
    const ra = new ProduceManaReplacement().build(ast, mkCtx(game));
    const intent: MutationIntent = {
      kind: "produceMana",
      seat: SEAT0,
      sourceId: SOURCE,
      symbols: ["G"],
    } as unknown as MutationIntent;
    const result = ra.apply(intent, game) as MutationIntent | null;
    expect(result).not.toBeNull();
    expect((result as { symbols?: readonly string[] }).symbols).toEqual(["G", "G"]);
  });

  it("Wave 67 SVar-bodied shape: ReplaceWith$ DBDouble dispatches to DB$ ReplaceMana", () => {
    const game = mkGame();
    // Recolor instead of just doubling — exercises the side-channel runner
    // path independently of the inline Multiplier path.
    const svars = new Map<string, SVarAst>();
    svars.set(
      "DBRecolor",
      mkSvar({
        handlerKey: "ReplaceMana",
        params: {
          From: { kind: "literal", raw: "B" },
          To: { kind: "literal", raw: "G" },
        },
      } as unknown as EffectInvocation),
    );
    installSourceWithSvars(game, svars);

    const ast: ReplacementAst = {
      eventKind: "ProduceMana",
      params: {
        ValidPlayer: { kind: "literal", raw: "You" },
        ReplaceWith: { kind: "literal", raw: "DBRecolor" },
      },
      effect: { handlerKey: "DBRecolor", params: {} },
    } as unknown as ReplacementAst;
    const ra = new ProduceManaReplacement().build(ast, mkCtx(game));
    const intent: MutationIntent = {
      kind: "produceMana",
      seat: SEAT0,
      sourceId: SOURCE,
      symbols: ["B", "B", "C"],
    } as unknown as MutationIntent;
    const result = ra.apply(intent, game) as MutationIntent | null;
    expect(result).not.toBeNull();
    expect((result as { symbols?: readonly string[] }).symbols).toEqual(["G", "G", "C"]);
    // Side channel cleared after apply().
    expect(game.flags.activeReplacementIntent).toBe(null);
  });
});

// Side-effect import marker — used by CardType for the unused-import guard.
void CardType;
