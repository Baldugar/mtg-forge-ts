// SPDX-License-Identifier: GPL-3.0-or-later
// Batch D2 + Wave 14b — GameLossReplacement tests. Verifies ValidPlayer$
// filtering (You/Opponent/Each/Player), Layer$ CantHappen full prevention,
// rejection of non-gameLoss intents, AND the Exquisite Archangel
// flagship: ReplaceWith$ ExileSetLife exiles the source and resets the
// controller's life to game.rules.startingLife.
import type { LobbyPlayer, MutationIntent, ReplacementAst, SVarAst } from "@mtg-forge-ts/core";
import { CardType, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { afterEach, describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { GameLossReplacement } from "./game-loss-replacement.js";

const SOURCE_ID = mkEntityId(20);
const REPL_ID = mkEntityId(2);
const ALICE = mkPlayerSeat(0);
const BOB = mkPlayerSeat(1);

const mkCtx = (): ReplacementBuildContext => ({
  game: {} as never,
  sourceCardId: SOURCE_ID,
  controllerSeat: ALICE,
  replacementId: REPL_ID,
});

/** Platinum Angel — "you can't lose" — Layer$ CantHappen on ValidPlayer$ You. */
const mkCantLoseSelfAst = (): ReplacementAst => ({
  eventKind: "GameLoss",
  params: {
    ValidPlayer: { kind: "literal", raw: "You" },
    Layer: { kind: "literal", raw: "CantHappen" },
  },
  effect: { handlerKey: "Prevent", params: {} },
});

const mkCantLoseAnyAst = (): ReplacementAst => ({
  eventKind: "GameLoss",
  params: {
    ValidPlayer: { kind: "literal", raw: "Player" },
    Layer: { kind: "literal", raw: "CantHappen" },
  },
  effect: { handlerKey: "Prevent", params: {} },
});

const mkLossIntent = (seat: ReturnType<typeof mkPlayerSeat>): MutationIntent => ({
  kind: "gameLoss",
  seat,
  cause: "life",
});

afterEach(() => {
  replacementHandlerRegistry.clear();
  replacementHandlerRegistry.register(GameLossReplacement);
});

replacementHandlerRegistry.register(GameLossReplacement);

describe("GameLossReplacement (Batch D2)", () => {
  it("is registered under eventKind 'GameLoss'", () => {
    expect(replacementHandlerRegistry.has("GameLoss")).toBe(true);
  });

  describe("ValidPlayer$ You + Layer$ CantHappen (Platinum Angel: 'You can't lose')", () => {
    it("matches when the controller would lose", () => {
      const Cls = replacementHandlerRegistry.lookup("GameLoss");
      if (!Cls) return;
      const ra = new Cls().build(mkCantLoseSelfAst(), mkCtx());
      expect(ra.matches(mkLossIntent(ALICE))).toBe(true);
    });

    it("does NOT match when an opponent would lose", () => {
      const Cls = replacementHandlerRegistry.lookup("GameLoss");
      if (!Cls) return;
      const ra = new Cls().build(mkCantLoseSelfAst(), mkCtx());
      expect(ra.matches(mkLossIntent(BOB))).toBe(false);
    });

    it("apply() returns null (loss prevented) on Layer$ CantHappen", () => {
      const Cls = replacementHandlerRegistry.lookup("GameLoss");
      if (!Cls) return;
      const ra = new Cls().build(mkCantLoseSelfAst(), mkCtx());
      const intent = mkLossIntent(ALICE);
      expect(ra.apply(intent, {})).toBeNull();
    });

    it("layer is 'cantHappen' for Layer$ CantHappen replacements", () => {
      const Cls = replacementHandlerRegistry.lookup("GameLoss");
      if (!Cls) return;
      const ra = new Cls().build(mkCantLoseSelfAst(), mkCtx());
      expect(ra.layer).toBe("cantHappen");
    });
  });

  describe("ValidPlayer$ Player (any player can't lose)", () => {
    it("matches any seat", () => {
      const Cls = replacementHandlerRegistry.lookup("GameLoss");
      if (!Cls) return;
      const ra = new Cls().build(mkCantLoseAnyAst(), mkCtx());
      expect(ra.matches(mkLossIntent(ALICE))).toBe(true);
      expect(ra.matches(mkLossIntent(BOB))).toBe(true);
    });
  });

  describe("non-gameLoss intent rejection", () => {
    it("does NOT match a non-gameLoss intent", () => {
      const Cls = replacementHandlerRegistry.lookup("GameLoss");
      if (!Cls) return;
      const ra = new Cls().build(mkCantLoseSelfAst(), mkCtx());
      const intent: MutationIntent = { kind: "damage", amount: 3 };
      expect(ra.matches(intent)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Wave 14b — Exquisite Archangel ReplaceWith$ SVar redirect
  // ---------------------------------------------------------------------------

  describe("ReplaceWith$ ExileSetLife (Exquisite Archangel) — Wave 14b", () => {
    const ARCHANGEL_ID = mkEntityId(900);

    const aliceLP: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
    const bobLP: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };
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
      cardDataSyncedAt: "2026-04-23T00:00:00Z",
      crVersion: "2024-11-08",
      seed: "01",
    };

    /**
     * Build an Exquisite Archangel paper card with the canonical SVar trio
     * (ExileSetLife → ChangeZone Battlefield→Exile Defined$ Self with
     * SubAbility$ DBSetLife → SetLife Defined$ You LifeAmount$ X with
     * SVar:X = Count$YourStartingLife).
     */
    const mkArchangelPaper = () => {
      const svars = new Map<string, SVarAst>();
      svars.set("ExileSetLife", {
        kind: "ability",
        raw: "DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile | Defined$ Self | SubAbility$ DBSetLife",
        ability: {
          handlerKey: "ChangeZone",
          params: {
            Origin: { kind: "literal", raw: "Battlefield" },
            Destination: { kind: "literal", raw: "Exile" },
            Defined: { kind: "literal", raw: "Self" },
            SubAbility: { kind: "literal", raw: "DBSetLife" },
          },
          subAbility: {
            handlerKey: "SetLife",
            params: {
              Defined: { kind: "literal", raw: "You" },
              LifeAmount: { kind: "literal", raw: "X" },
            },
          },
        },
      });
      svars.set("DBSetLife", {
        kind: "ability",
        raw: "DB$ SetLife | Defined$ You | LifeAmount$ X",
        ability: {
          handlerKey: "SetLife",
          params: {
            Defined: { kind: "literal", raw: "You" },
            LifeAmount: { kind: "literal", raw: "X" },
          },
        },
      });
      svars.set("X", {
        kind: "value",
        raw: "Count$YourStartingLife",
      });
      return {
        oracleId: "oracle-archangel",
        printingId: "ori:008",
        name: "Exquisite Archangel",
        flags: { isToken: false, isMeldResult: false, isEmblem: false, isAttraction: false },
        definition: {
          name: "Exquisite Archangel",
          types: {
            has: (t: string) => t === CardType.Creature,
            hasSubtype: (s: string) => s === "Angel",
          },
          superTypes: new Set<string>(),
          subTypes: new Set(["Angel"]),
          colors: new Set<string>(),
          abilities: [],
          triggers: [],
          statics: [],
          replacements: [],
          keywords: [],
          svars,
        },
      };
    };

    const mkArchangelAst = (): ReplacementAst => ({
      eventKind: "GameLoss",
      params: {
        ValidPlayer: { kind: "literal", raw: "You" },
        ReplaceWith: { kind: "literal", raw: "ExileSetLife" },
      },
      effect: { handlerKey: "Replace", params: {} },
    });

    const mkLossIntentLocal = (seat: ReturnType<typeof mkPlayerSeat>): MutationIntent => ({
      kind: "gameLoss",
      seat,
      cause: "life",
    });

    const buildScenario = () => {
      const game = new Game({ lobbyPlayers: [aliceLP, bobLP], rules, meta, rng: new SeededRng(1n) });
      const aliceSeat = mkPlayerSeat(0);
      // The Game ctor doesn't populate per-player zones — that's MatchSetup's
      // job. Mint just the Battlefield zone Alice needs for this scenario.
      const alicePlayer = game.getPlayer(aliceSeat);
      alicePlayer.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, aliceSeat));
      // Drop life to 0 so a GameLoss intent is the realistic input.
      alicePlayer.life = 0;
      const archangel = new Card(
        ARCHANGEL_ID,
        mkArchangelPaper() as never,
        aliceSeat,
        aliceSeat,
        ZoneType.Battlefield,
      );
      game.cards.set(ARCHANGEL_ID, archangel);
      alicePlayer.zones.get(ZoneType.Battlefield)?.add(ARCHANGEL_ID);
      return { game, aliceSeat, archangel };
    };

    it("apply() returns null (loss prevented), exiles the source, and resets life to startingLife", () => {
      const { game, aliceSeat, archangel } = buildScenario();
      const Cls = replacementHandlerRegistry.lookup("GameLoss");
      if (!Cls) return;
      const ra = new Cls().build(mkArchangelAst(), {
        game,
        sourceCardId: ARCHANGEL_ID,
        controllerSeat: aliceSeat,
        replacementId: REPL_ID,
      });

      // Sanity — Alice on the brink, Archangel on the battlefield.
      expect(game.getPlayer(aliceSeat).life).toBe(0);
      expect(archangel.zone).toBe(ZoneType.Battlefield);

      const result = ra.apply(mkLossIntentLocal(aliceSeat), game);

      // Loss prevented → null return.
      expect(result).toBeNull();
      // Archangel has been exiled.
      expect(archangel.zone).toBe(ZoneType.Exile);
      const battlefield = game.getPlayer(aliceSeat).zones.get(ZoneType.Battlefield);
      expect(battlefield?.contains(ARCHANGEL_ID)).toBe(false);
      expect(game.sharedZones.exile.contains(ARCHANGEL_ID)).toBe(true);
      // Life reset to startingLife (20).
      expect(game.getPlayer(aliceSeat).life).toBe(20);
    });

    it("matches a GameLoss intent on the controller (ValidPlayer$ You)", () => {
      const { game, aliceSeat } = buildScenario();
      const Cls = replacementHandlerRegistry.lookup("GameLoss");
      if (!Cls) return;
      const ra = new Cls().build(mkArchangelAst(), {
        game,
        sourceCardId: ARCHANGEL_ID,
        controllerSeat: aliceSeat,
        replacementId: REPL_ID,
      });
      expect(ra.matches(mkLossIntentLocal(aliceSeat))).toBe(true);
    });

    it("does NOT match a GameLoss intent on the opponent (ValidPlayer$ You)", () => {
      const { game, aliceSeat } = buildScenario();
      const bobSeat = mkPlayerSeat(1);
      const Cls = replacementHandlerRegistry.lookup("GameLoss");
      if (!Cls) return;
      const ra = new Cls().build(mkArchangelAst(), {
        game,
        sourceCardId: ARCHANGEL_ID,
        controllerSeat: aliceSeat,
        replacementId: REPL_ID,
      });
      expect(ra.matches(mkLossIntentLocal(bobSeat))).toBe(false);
    });

    it("falls through to no-op redirect when ReplaceWith$ SVar is missing on the card", () => {
      const { game, aliceSeat, archangel } = buildScenario();
      // Drop the SVar so the lookup fails — the canonical loss must proceed.
      (archangel.paperCard.definition?.svars as Map<string, SVarAst>).delete("ExileSetLife");
      const Cls = replacementHandlerRegistry.lookup("GameLoss");
      if (!Cls) return;
      const ra = new Cls().build(mkArchangelAst(), {
        game,
        sourceCardId: ARCHANGEL_ID,
        controllerSeat: aliceSeat,
        replacementId: REPL_ID,
      });
      const intent = mkLossIntentLocal(aliceSeat);
      const result = ra.apply(intent, game);
      // No redirect → return the original intent unchanged.
      expect(result).toBe(intent);
      // No state mutation.
      expect(archangel.zone).toBe(ZoneType.Battlefield);
      expect(game.getPlayer(aliceSeat).life).toBe(0);
    });
  });

  describe("ValidPlayer$ Opponent", () => {
    const mkOppLossAst = (): ReplacementAst => ({
      eventKind: "GameLoss",
      params: {
        ValidPlayer: { kind: "literal", raw: "Opponent" },
        Layer: { kind: "literal", raw: "CantHappen" },
      },
      effect: { handlerKey: "Prevent", params: {} },
    });

    it("matches when an opponent would lose", () => {
      const Cls = replacementHandlerRegistry.lookup("GameLoss");
      if (!Cls) return;
      const ra = new Cls().build(mkOppLossAst(), mkCtx());
      expect(ra.matches(mkLossIntent(BOB))).toBe(true);
    });

    it("does NOT match when the controller would lose", () => {
      const Cls = replacementHandlerRegistry.lookup("GameLoss");
      if (!Cls) return;
      const ra = new Cls().build(mkOppLossAst(), mkCtx());
      expect(ra.matches(mkLossIntent(ALICE))).toBe(false);
    });
  });
});
