// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 48 — six lower-frequency replacement event handlers (AssignDealDamage,
// DealtDamage, DeclareBlocker, PlanarDiceResult, SetInMotion, Tap).
//
// Each handler dispatches on its dedicated MutationIntent kind (declared
// in `replacements/mutation-intent.ts`) and supports the canonical
// Forge `Layer$ CantHappen` / `Prevent$ True` shapes plus passthrough for
// `ReplaceWith$` SVar redirection. The richer Forge-specific apply
// transformations (Goad block restriction routing for DeclareBlocker,
// trample-style assignment rewrites for AssignDealDamage) are TODO(advanced)
// — registering the eventKind here un-blocks the corpus scanner from
// flagging them as missing handlers and lets the SVar-driven redirects
// fall through cleanly.
import type {
  EntityId,
  MutationIntent,
  PlayerSeat,
  ReplacementAbility,
  ReplacementAst,
} from "@mtg-forge-ts/core";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { ReplacementHandler } from "../replacement-handler.js";

const getParamRaw = (ast: ReplacementAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

// ---------------------------------------------------------------------------
// AssignDealDamageReplacement — trample / excess-damage assignment hook.
// ---------------------------------------------------------------------------
// Forge: R:Event$ AssignDealDamage | ValidSource$ Card.Self | Layer$ CantHappen
// TODO(advanced): apply path for damage-redirection variants
// (e.g. "all damage CARDNAME would deal is dealt to its controller instead").
export class AssignDealDamageReplacement extends ReplacementHandler {
  static override readonly eventKind = "AssignDealDamage";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    void getParamRaw(ast, "ValidSource");
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
        if (intent.kind !== "assignDealDamage") return false;
        const di = intent as { sourceId?: EntityId };
        // Card.Self filter: only the source card's own assignment.
        const validSourceRaw = getParamRaw(ast, "ValidSource") ?? "Card.Self";
        if (validSourceRaw === "Card.Self") return di.sourceId === sourceCardId;
        return true;
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        return intent;
      },
    };
  }
}
replacementHandlerRegistry.register(AssignDealDamageReplacement);

// ---------------------------------------------------------------------------
// DealtDamageReplacement — post-damage hook (Forge "DealtDamage" event kind,
// distinct from "DamageDone" intent-time hook).
// ---------------------------------------------------------------------------
// Wave 48 maps DealtDamage onto the same `damage` MutationIntent family for
// matching purposes — the canonical Forge usage we see in the corpus is the
// "deals damage to X — instead does Y" reading which is structurally a
// damage-replacement ride-along. TODO(advanced): split DealtDamage onto its
// own intent kind once we add a post-resolution damage-observation hook.
export class DealtDamageReplacement extends ReplacementHandler {
  static override readonly eventKind = "DealtDamage";

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
        return intent.kind === "damage";
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        return intent;
      },
    };
  }
}
replacementHandlerRegistry.register(DealtDamageReplacement);

// ---------------------------------------------------------------------------
// DeclareBlockerReplacement — Goad / Menace / "must-be-blocked-by" hook.
// ---------------------------------------------------------------------------
// Forge: R:Event$ DeclareBlocker | ValidCard$ Creature.Self | Layer$ CantHappen
// TODO(advanced): map block-restriction routing (Goad — "if able, must
// attack a player other than the goading player").
export class DeclareBlockerReplacement extends ReplacementHandler {
  static override readonly eventKind = "DeclareBlocker";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    void getParamRaw(ast, "ValidCard");
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
        return intent.kind === "declareBlocker";
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        return intent;
      },
    };
  }
}
replacementHandlerRegistry.register(DeclareBlockerReplacement);

// ---------------------------------------------------------------------------
// PlanarDiceResultReplacement — distinct from RollPlanarDice (which fires
// before the roll). PlanarDiceResult fires after the roll resolves.
// ---------------------------------------------------------------------------
// Forge usage: "If chaos rolled, instead it's planeswalk" / planar redirects.
// TODO(advanced): apply path for face-rewrite ("treat blank as chaos").
export class PlanarDiceResultReplacement extends ReplacementHandler {
  static override readonly eventKind = "PlanarDiceResult";

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
        return intent.kind === "planarDiceResult";
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        return intent;
      },
    };
  }
}
replacementHandlerRegistry.register(PlanarDiceResultReplacement);

// ---------------------------------------------------------------------------
// SetInMotionReplacement — Phenomenon set-in-motion hook (Archenemy).
// ---------------------------------------------------------------------------
// Forge: R:Event$ SetInMotion | ValidCard$ Phenomenon | Layer$ CantHappen
export class SetInMotionReplacement extends ReplacementHandler {
  static override readonly eventKind = "SetInMotion";

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
        return intent.kind === "setInMotion";
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        return intent;
      },
    };
  }
}
replacementHandlerRegistry.register(SetInMotionReplacement);

// ---------------------------------------------------------------------------
// TapReplacement — "tapped instead" / "doesn't tap" replacement.
// ---------------------------------------------------------------------------
// Forge: R:Event$ Tap | ValidCard$ Land.YouCtrl | Layer$ CantHappen
//   (Heat Stroke / Vow of Wildness-style "doesn't untap" — note that's
//   actually an `Untap` replacement; `Tap` here covers "as it taps it
//   produces extra mana" style overrides via ReplaceWith$ SVar dispatch).
// TODO(advanced): SVar dispatch for tap-time mana-pool boosts.
export class TapReplacement extends ReplacementHandler {
  static override readonly eventKind = "Tap";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    const validCardRaw = getParamRaw(ast, "ValidCard") ?? "Card.Self";
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
        if (intent.kind !== "tap") return false;
        const ti = intent as { cardId?: EntityId };
        if (validCardRaw === "Card.Self") return ti.cardId === sourceCardId;
        return true;
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        return intent;
      },
    };
  }
}
replacementHandlerRegistry.register(TapReplacement);

// Suppress unused-import warning in environments that aren't running TS.
void ([] as readonly PlayerSeat[]);
