// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 20 — corpus long-tail replacement handlers (13 entries). Each
// handler matches its dedicated MutationIntent and either prevents it
// (Layer$ CantHappen / Prevent$ True), passes it through unchanged
// (ReplaceWith$ recorded but not yet dispatched), or applies the most
// common transformation hard-coded for the niche.
//
// Mirrors the Wave 17/19 replacement structure.
//
// Replacements covered:
//   ProduceMana (18) — Mana Reflection / mana doublers (most important)
//   BeginTurn (5)
//   Transform (4)
//   LoseMana (4)
//   Attached (3)
//   Scry (2)
//   Explore (2)
//   RollPlanarDice (1)
//   Learn (1)
//   AssembleContraption (1)
//   Planeswalk (1)
//   Proliferate (1)
//   CopySpell (1)
import type { MutationIntent, PlayerSeat, ReplacementAbility, ReplacementAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { ReplacementHandler } from "../replacement-handler.js";
import { lookupReplaceWithAbility, runReplaceWithIntentMutation } from "./replace-with-svar.js";

const getParamRaw = (ast: ReplacementAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

const parseLiteralInt = (raw: string | undefined): number | null => {
  if (raw === undefined) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------
// 1. ProduceManaReplacement (18 cards) — Mana Reflection-style mana doublers.
// ---------------------------------------------------------------------------
// Forge: R:Event$ ProduceMana | ValidCard$ Land.YouCtrl | ReplaceWith$ DBDouble
//
// MVP support:
//   ValidCard$ filter (Card.Self / Card / Land — permissive)
//   ValidPlayer$ You / Opponent / Each / Player (seat filter)
//   Multiplier$ <int>     — multiply produced symbols by this factor
//   Amount$ <int>          — replacement count override (e.g. always produce N)
//   Layer$ CantHappen / Prevent$ True — kill mana production entirely
//   ReplaceWith$ <SVar>    — recorded; SVar dispatch deferred to Wave 21
export class ProduceManaReplacement extends ReplacementHandler {
  static override readonly eventKind = "ProduceMana";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const validPlayerRaw = getParamRaw(ast, "ValidPlayer") ?? "Player";
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    const multiplier = parseLiteralInt(getParamRaw(ast, "Multiplier"));
    // Wave 67 — ReplaceWith$ <SVar> for SVar-bodied mana doublers (Mana
    // Reflection / Mirari's Wake / Caged Sun in their generalized parsed
    // form):
    //   R:Event$ ProduceMana | ValidCard$ Land.YouCtrl | ReplaceWith$ DBDouble
    //   SVar:DBDouble:DB$ ReplaceMana | ... (or DB$ ReplaceEffect | ...)
    const replaceWithKey = getParamRaw(ast, "ReplaceWith") ?? ast.effect.handlerKey;
    const { sourceCardId, controllerSeat, replacementId } = ctx;

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: layerParam === "CantHappen" ? "cantHappen" : "other",

      matches(intent: MutationIntent): boolean {
        if (intent.kind !== "produceMana") return false;
        const seat = (intent as { seat?: PlayerSeat }).seat;
        if (seat === undefined) return false;
        if (validPlayerRaw === "You") return seat === controllerSeat;
        if (validPlayerRaw === "Opponent") return seat !== controllerSeat;
        if (validPlayerRaw === "Each" || validPlayerRaw === "Player") return true;
        return false;
      },

      apply(intent: MutationIntent, gameUnknown: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;

        // Wave 67 — ReplaceWith$ <SVar> dispatch into the ReplaceEffect family.
        // When the SVar resolves to a ReplaceEffect / ReplaceMana handler, we
        // thread the produceMana intent through the side-channel runner. The
        // SVar body owns the full symbol rewrite (we DON'T also inline-multiply,
        // which would over-produce).
        const game = gameUnknown as Game;
        if (replaceWithKey !== undefined) {
          const ability = lookupReplaceWithAbility(game, sourceCardId, replaceWithKey);
          if (ability !== null) {
            const handlerKey = ability.handlerKey;
            if (handlerKey === "ReplaceEffect" || handlerKey === "ReplaceMana") {
              const next = runReplaceWithIntentMutation(game, sourceCardId, controllerSeat, ability, intent);
              return next;
            }
          }
        }

        // Inline Multiplier path — duplicate produced symbols. Default Mana
        // Reflection semantics ("Whenever a land you control produces mana,
        // it produces an additional mana of any of those types"). Preserved
        // from Wave 20 for the bare Multiplier$ shape.
        const m = multiplier ?? 2;
        if (m === 1) return intent;
        const symbols = (intent as { symbols?: readonly string[] }).symbols ?? [];
        if (symbols.length === 0) return intent;
        const expanded: string[] = [];
        for (let i = 0; i < m; i++) expanded.push(...symbols);
        return { ...intent, symbols: expanded };
      },
    };
  }
}
replacementHandlerRegistry.register(ProduceManaReplacement);

// ---------------------------------------------------------------------------
// 2. BeginTurnReplacement (5 cards)
// ---------------------------------------------------------------------------
// Time Stop, Stasis-style "skip your next turn" / "extra turn" effects.
// Forge: R:Event$ BeginTurn | ValidPlayer$ You | Layer$ CantHappen
export class BeginTurnReplacement extends ReplacementHandler {
  static override readonly eventKind = "BeginTurn";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const validPlayerRaw = getParamRaw(ast, "ValidPlayer") ?? "Player";
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    void getParamRaw(ast, "ReplaceWith");
    const { sourceCardId, controllerSeat, replacementId } = ctx;

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: layerParam === "CantHappen" ? "cantHappen" : "other",

      matches(intent: MutationIntent): boolean {
        if (intent.kind !== "beginTurn") return false;
        const seat = (intent as { seat?: PlayerSeat }).seat;
        if (seat === undefined) return false;
        if (validPlayerRaw === "You") return seat === controllerSeat;
        if (validPlayerRaw === "Opponent") return seat !== controllerSeat;
        return true;
      },

      apply(_intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        return _intent;
      },
    };
  }
}
replacementHandlerRegistry.register(BeginTurnReplacement);

// ---------------------------------------------------------------------------
// 3. TransformReplacement (4 cards)
// ---------------------------------------------------------------------------
// Cards that prevent transformation, or replace it with a different
// face-flip effect. Forge: R:Event$ Transform | ValidCard$ ... | Prevent$ True
export class TransformReplacement extends ReplacementHandler {
  static override readonly eventKind = "Transform";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    void getParamRaw(ast, "ReplaceWith");
    const { sourceCardId, controllerSeat, replacementId } = ctx;

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: layerParam === "CantHappen" ? "cantHappen" : "other",

      matches(intent: MutationIntent): boolean {
        return intent.kind === "transform";
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        return intent;
      },
    };
  }
}
replacementHandlerRegistry.register(TransformReplacement);

// ---------------------------------------------------------------------------
// 4. LoseManaReplacement (4 cards)
// ---------------------------------------------------------------------------
// Cards that prevent the typical "mana pool empties at end of phase"
// behaviour (Omnath, Locus of Mana etc.).
export class LoseManaReplacement extends ReplacementHandler {
  static override readonly eventKind = "LoseMana";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const validPlayerRaw = getParamRaw(ast, "ValidPlayer") ?? "Player";
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    void getParamRaw(ast, "ReplaceWith");
    const { sourceCardId, controllerSeat, replacementId } = ctx;

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: layerParam === "CantHappen" ? "cantHappen" : "other",

      matches(intent: MutationIntent): boolean {
        if (intent.kind !== "loseMana") return false;
        const seat = (intent as { seat?: PlayerSeat }).seat;
        if (seat === undefined) return false;
        if (validPlayerRaw === "You") return seat === controllerSeat;
        if (validPlayerRaw === "Opponent") return seat !== controllerSeat;
        return true;
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        return intent;
      },
    };
  }
}
replacementHandlerRegistry.register(LoseManaReplacement);

// ---------------------------------------------------------------------------
// 5. AttachedReplacement (3 cards)
// ---------------------------------------------------------------------------
// Cards that replace attachment events (e.g. "would attach -> attach
// somewhere else", "can't be enchanted").
export class AttachedReplacement extends ReplacementHandler {
  static override readonly eventKind = "Attached";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    void getParamRaw(ast, "ReplaceWith");
    const { sourceCardId, controllerSeat, replacementId } = ctx;

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: layerParam === "CantHappen" ? "cantHappen" : "other",

      matches(intent: MutationIntent): boolean {
        return intent.kind === "attached" || intent.kind === "attach";
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        return intent;
      },
    };
  }
}
replacementHandlerRegistry.register(AttachedReplacement);

// ---------------------------------------------------------------------------
// 6. ScryReplacement (2 cards)
// ---------------------------------------------------------------------------
export class ScryReplacement extends ReplacementHandler {
  static override readonly eventKind = "Scry";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const validPlayerRaw = getParamRaw(ast, "ValidPlayer") ?? "Player";
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    const multiplier = parseLiteralInt(getParamRaw(ast, "Multiplier"));
    void getParamRaw(ast, "ReplaceWith");
    const { sourceCardId, controllerSeat, replacementId } = ctx;

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: layerParam === "CantHappen" ? "cantHappen" : "other",

      matches(intent: MutationIntent): boolean {
        if (intent.kind !== "scry") return false;
        const seat = (intent as { seat?: PlayerSeat }).seat;
        if (seat === undefined) return false;
        if (validPlayerRaw === "You") return seat === controllerSeat;
        if (validPlayerRaw === "Opponent") return seat !== controllerSeat;
        return true;
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        if (multiplier !== null && multiplier > 1) {
          const amount = (intent as { amount?: number }).amount ?? 0;
          return { ...intent, amount: amount * multiplier };
        }
        return intent;
      },
    };
  }
}
replacementHandlerRegistry.register(ScryReplacement);

// ---------------------------------------------------------------------------
// 7. ExploreReplacement (2 cards)
// ---------------------------------------------------------------------------
// Replaces explore behaviour (e.g. "instead of revealing, ...").
export class ExploreReplacement extends ReplacementHandler {
  static override readonly eventKind = "Explore";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    void getParamRaw(ast, "ReplaceWith");
    const { sourceCardId, controllerSeat, replacementId } = ctx;

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: layerParam === "CantHappen" ? "cantHappen" : "other",

      matches(intent: MutationIntent): boolean {
        return intent.kind === "explore";
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        return intent;
      },
    };
  }
}
replacementHandlerRegistry.register(ExploreReplacement);

// ---------------------------------------------------------------------------
// 8. RollPlanarDiceReplacement (1 card)
// ---------------------------------------------------------------------------
export class RollPlanarDiceReplacement extends ReplacementHandler {
  static override readonly eventKind = "RollPlanarDice";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    void getParamRaw(ast, "ReplaceWith");
    const { sourceCardId, controllerSeat, replacementId } = ctx;

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never, "Command" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: layerParam === "CantHappen" ? "cantHappen" : "other",

      matches(intent: MutationIntent): boolean {
        return intent.kind === "rollPlanarDice";
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        return intent;
      },
    };
  }
}
replacementHandlerRegistry.register(RollPlanarDiceReplacement);

// ---------------------------------------------------------------------------
// 9. LearnReplacement (1 card)
// ---------------------------------------------------------------------------
export class LearnReplacement extends ReplacementHandler {
  static override readonly eventKind = "Learn";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    void getParamRaw(ast, "ReplaceWith");
    const { sourceCardId, controllerSeat, replacementId } = ctx;

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: layerParam === "CantHappen" ? "cantHappen" : "other",

      matches(intent: MutationIntent): boolean {
        return intent.kind === "learn";
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        return intent;
      },
    };
  }
}
replacementHandlerRegistry.register(LearnReplacement);

// ---------------------------------------------------------------------------
// 10. AssembleContraptionReplacement (1 card)
// ---------------------------------------------------------------------------
export class AssembleContraptionReplacement extends ReplacementHandler {
  static override readonly eventKind = "AssembleContraption";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    void getParamRaw(ast, "ReplaceWith");
    const { sourceCardId, controllerSeat, replacementId } = ctx;

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: layerParam === "CantHappen" ? "cantHappen" : "other",

      matches(intent: MutationIntent): boolean {
        return intent.kind === "assembleContraption";
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        return intent;
      },
    };
  }
}
replacementHandlerRegistry.register(AssembleContraptionReplacement);

// ---------------------------------------------------------------------------
// 11. PlaneswalkReplacement (1 card)
// ---------------------------------------------------------------------------
export class PlaneswalkReplacement extends ReplacementHandler {
  static override readonly eventKind = "Planeswalk";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    void getParamRaw(ast, "ReplaceWith");
    const { sourceCardId, controllerSeat, replacementId } = ctx;

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never, "Command" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: layerParam === "CantHappen" ? "cantHappen" : "other",

      matches(intent: MutationIntent): boolean {
        return intent.kind === "planeswalk";
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        return intent;
      },
    };
  }
}
replacementHandlerRegistry.register(PlaneswalkReplacement);

// ---------------------------------------------------------------------------
// 12. ProliferateReplacement (1 card)
// ---------------------------------------------------------------------------
export class ProliferateReplacement extends ReplacementHandler {
  static override readonly eventKind = "Proliferate";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    void getParamRaw(ast, "ReplaceWith");
    const { sourceCardId, controllerSeat, replacementId } = ctx;

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: layerParam === "CantHappen" ? "cantHappen" : "other",

      matches(intent: MutationIntent): boolean {
        return intent.kind === "proliferate";
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        return intent;
      },
    };
  }
}
replacementHandlerRegistry.register(ProliferateReplacement);

// ---------------------------------------------------------------------------
// 13. CopySpellReplacement (1 card)
// ---------------------------------------------------------------------------
export class CopySpellReplacement extends ReplacementHandler {
  static override readonly eventKind = "CopySpell";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    void getParamRaw(ast, "ReplaceWith");
    const { sourceCardId, controllerSeat, replacementId } = ctx;

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      layer: layerParam === "CantHappen" ? "cantHappen" : "other",

      matches(intent: MutationIntent): boolean {
        return intent.kind === "copySpell";
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        return intent;
      },
    };
  }
}
replacementHandlerRegistry.register(CopySpellReplacement);
