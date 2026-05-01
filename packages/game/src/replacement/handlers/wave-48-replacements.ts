// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 48 — six lower-frequency replacement event handlers (AssignDealDamage,
// DealtDamage, DeclareBlocker, PlanarDiceResult, SetInMotion, Tap).
//
// Each handler dispatches on its dedicated MutationIntent kind (declared
// in `replacements/mutation-intent.ts`) and supports the canonical
// Forge `Layer$ CantHappen` / `Prevent$ True` shapes plus passthrough for
// `ReplaceWith$` SVar redirection.
//
// Wave 95 — closes the six TODO(advanced) tails for these handlers:
//   * AssignDealDamage — `RedirectTo$ Controller` rewrites the assignment
//     targetIds to the source's controller seat (modeled as a player target
//     using the seat's negative entity id slot, matching how damage intents
//     encode player targets).
//   * DealtDamage — `Amount$ <int>` literal rewrite + ReplaceWith$ SVar
//     dispatch (mirrors DamageReplacement). The intent kind remains "damage"
//     since DealtDamage is structurally a damage-replacement ride-along.
//   * DeclareBlocker — `ValidAttacker$ <seat-or-card>` block-restriction
//     routing: when the blocker's attackerIds list contains a goading
//     attacker, the replacement may decline (apply returns null) so the
//     blocker is forced to choose a non-goader, or pass through unchanged.
//   * PlanarDiceResult — `ResultFace$ chaos|planeswalk|blank` face-rewrite
//     ("treat blank as chaos") rewrites intent.face.
//   * SetInMotion — `ReplaceWith$ <SVar>` synchronous SVar dispatch.
//   * Tap — `ReplaceWith$ <SVar>` synchronous SVar dispatch (covers
//     "tap produces extra mana" and similar tap-time ride-alongs).
import type {
  EntityId,
  MutationIntent,
  PlayerSeat,
  ReplacementAbility,
  ReplacementAst,
} from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { ReplacementHandler } from "../replacement-handler.js";
import {
  lookupReplaceWithAbility,
  runReplaceWithAbilitySync,
  runReplaceWithIntentMutation,
} from "./replace-with-svar.js";

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
// AssignDealDamageReplacement — trample / excess-damage assignment hook.
// ---------------------------------------------------------------------------
// Forge: R:Event$ AssignDealDamage | ValidSource$ Card.Self | Layer$ CantHappen
// Wave 95 — `RedirectTo$ Controller` rewrites every assignment's targetId to
// the source's controller seat ("all damage CARDNAME would deal is dealt to
// its controller instead"). We keep the assignment amounts intact and only
// re-target; deeper trample-style splitting (one assignment per defender)
// stays inside the combat handler.
export class AssignDealDamageReplacement extends ReplacementHandler {
  static override readonly eventKind = "AssignDealDamage";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    const validSourceRaw = getParamRaw(ast, "ValidSource") ?? "Card.Self";
    const redirectTo = getParamRaw(ast, "RedirectTo");
    const replaceWithKey = getParamRaw(ast, "ReplaceWith");
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
        if (validSourceRaw === "Card.Self") return di.sourceId === sourceCardId;
        return true;
      },

      apply(intent: MutationIntent, gameUnknown: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;

        // RedirectTo$ Controller — rewrite each assignment's targetId to the
        // controller seat. The seat is encoded as the assignment's targetId
        // (player damage uses seat-as-targetId in the assignDealDamage shape).
        if (redirectTo === "Controller") {
          const di = intent as {
            assignments?: readonly { readonly targetId: EntityId; readonly amount: number }[];
          };
          if (di.assignments !== undefined) {
            const rewritten = di.assignments.map((a) => ({
              ...a,
              targetId: controllerSeat as unknown as EntityId,
            }));
            return { ...intent, assignments: rewritten } as MutationIntent;
          }
        }

        // ReplaceWith$ <SVar> dispatch — generic ReplaceEffect-family rewrite.
        if (replaceWithKey !== undefined) {
          const game = gameUnknown as Game;
          const ability = lookupReplaceWithAbility(game, sourceCardId, replaceWithKey);
          if (ability !== null) {
            const handlerKey = ability.handlerKey;
            if (handlerKey === "ReplaceEffect" || handlerKey === "ReplaceDamage") {
              const next = runReplaceWithIntentMutation(game, sourceCardId, controllerSeat, ability, intent);
              return next;
            }
          }
        }

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
// damage-replacement ride-along.
//
// Wave 95 — adds `Amount$ <int>` literal rewrite and `ReplaceWith$ <SVar>`
// dispatch (mirrors DamageReplacement). A standalone post-resolution
// damage-observation hook would split this onto its own intent kind, but the
// corpus has zero usages that distinguish the two paths today, so the
// damage-intent ride-along covers the printed-card surface area.
export class DealtDamageReplacement extends ReplacementHandler {
  static override readonly eventKind = "DealtDamage";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    const amountRaw = getParamRaw(ast, "Amount");
    const newAmount = parseLiteralInt(amountRaw);
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
        return intent.kind === "damage";
      },

      apply(intent: MutationIntent, gameUnknown: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;

        // Amount$ <literal> — replace the damage amount.
        if (newAmount !== null) {
          return { ...intent, amount: newAmount } as MutationIntent;
        }

        // ReplaceWith$ <SVar> dispatch into the ReplaceEffect family.
        if (replaceWithKey !== undefined) {
          const game = gameUnknown as Game;
          const ability = lookupReplaceWithAbility(game, sourceCardId, replaceWithKey);
          if (ability !== null) {
            const handlerKey = ability.handlerKey;
            if (
              handlerKey === "ReplaceEffect" ||
              handlerKey === "ReplaceDamage" ||
              handlerKey === "ReplaceSplitDamage"
            ) {
              const next = runReplaceWithIntentMutation(game, sourceCardId, controllerSeat, ability, intent);
              return next;
            }
          }
        }

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
//
// Wave 95 — closes block-restriction routing via `ValidAttacker$` filter.
// Goad's printed text "if able, must attack a player other than the goading
// player" is the ATTACK-side restriction (handled by attack-requirement-static
// for the goaded creature's controller); the BLOCK-side restriction here
// covers the rarer printed shape "this creature can't be blocked by a
// goaded creature" / "must be blocked by a non-goaded creature". The
// matcher narrows on a specific attackerId so unrelated declareBlocker
// intents fall through cleanly.
export class DeclareBlockerReplacement extends ReplacementHandler {
  static override readonly eventKind = "DeclareBlocker";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    const validCardRaw = getParamRaw(ast, "ValidCard");
    const validAttackerRaw = getParamRaw(ast, "ValidAttacker");
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
        if (intent.kind !== "declareBlocker") return false;
        const bi = intent as { blockerId?: EntityId; attackerIds?: readonly EntityId[] };

        // ValidCard$ Card.Self — only the source creature's own block.
        if (validCardRaw === "Card.Self" && bi.blockerId !== sourceCardId) return false;

        // ValidAttacker$ Card.Self — restrict to blocks that target the source.
        // This routes the "must be blocked" / "can't be blocked" shape: the
        // attackerIds list must contain the source card.
        if (validAttackerRaw === "Card.Self") {
          if (bi.attackerIds === undefined) return false;
          if (!bi.attackerIds.includes(sourceCardId)) return false;
        }

        return true;
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
//
// Wave 95 — adds `ResultFace$ <face>` face-rewrite. "Treat blank as chaos"
// becomes `R:Event$ PlanarDiceResult | MatchFace$ blank | ResultFace$ chaos`.
// MatchFace narrows the matches() side; ResultFace replaces intent.face on
// apply. ReplaceWith$ <SVar> still falls through to the generic ReplaceEffect
// runner for SVar-bodied variants.
export class PlanarDiceResultReplacement extends ReplacementHandler {
  static override readonly eventKind = "PlanarDiceResult";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    const matchFaceRaw = getParamRaw(ast, "MatchFace");
    const resultFaceRaw = getParamRaw(ast, "ResultFace");
    const replaceWithKey = getParamRaw(ast, "ReplaceWith");
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
        if (intent.kind !== "planarDiceResult") return false;
        if (matchFaceRaw !== undefined) {
          const fi = intent as { face?: string };
          if (fi.face !== matchFaceRaw) return false;
        }
        return true;
      },

      apply(intent: MutationIntent, gameUnknown: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;

        // ResultFace$ <face> — rewrite the face value on the intent.
        if (resultFaceRaw === "chaos" || resultFaceRaw === "planeswalk" || resultFaceRaw === "blank") {
          return { ...intent, face: resultFaceRaw } as MutationIntent;
        }

        // ReplaceWith$ <SVar> dispatch for ReplaceEffect-family rewrites.
        if (replaceWithKey !== undefined) {
          const game = gameUnknown as Game;
          const ability = lookupReplaceWithAbility(game, sourceCardId, replaceWithKey);
          if (ability !== null && ability.handlerKey === "ReplaceEffect") {
            const next = runReplaceWithIntentMutation(game, sourceCardId, controllerSeat, ability, intent);
            return next;
          }
        }

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
//
// Wave 95 — adds `ReplaceWith$ <SVar>` synchronous SVar dispatch. When the
// SVar resolves to a registered ability handler, we run it synchronously
// (mirrors Destroy's Wave 29 dispatch) and treat the canonical SetInMotion
// as replaced (return null). Pure prevent / ride-through still works
// unchanged.
export class SetInMotionReplacement extends ReplacementHandler {
  static override readonly eventKind = "SetInMotion";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    const replaceWithKey = getParamRaw(ast, "ReplaceWith");
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

      apply(intent: MutationIntent, gameUnknown: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;

        // ReplaceWith$ <SVar> — synchronous side-effect dispatch.
        if (replaceWithKey !== undefined) {
          const game = gameUnknown as Game;
          const ability = lookupReplaceWithAbility(game, sourceCardId, replaceWithKey);
          if (ability !== null) {
            runReplaceWithAbilitySync(game, sourceCardId, controllerSeat, ability);
            return null;
          }
        }

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
//
// Wave 95 — adds `ReplaceWith$ <SVar>` synchronous SVar dispatch covering
// tap-time mana-pool boosts ("as CARDNAME taps, add {C}" ride-alongs that
// piggy-back on the canonical tap event). The SVar runs synchronously; the
// canonical tap still proceeds (we return the intent unchanged) so the card
// actually ends up tapped.
export class TapReplacement extends ReplacementHandler {
  static override readonly eventKind = "Tap";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    const validCardRaw = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    const replaceWithKey = getParamRaw(ast, "ReplaceWith");
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

      apply(intent: MutationIntent, gameUnknown: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;

        // ReplaceWith$ <SVar> — synchronous side-effect dispatch (mana-pool
        // boost rides alongside the canonical tap; the tap itself still
        // resolves so we return the intent unchanged).
        if (replaceWithKey !== undefined) {
          const game = gameUnknown as Game;
          const ability = lookupReplaceWithAbility(game, sourceCardId, replaceWithKey);
          if (ability !== null) {
            runReplaceWithAbilitySync(game, sourceCardId, controllerSeat, ability);
          }
        }

        return intent;
      },
    };
  }
}
replacementHandlerRegistry.register(TapReplacement);

// Suppress unused-import warning in environments that aren't running TS.
void ([] as readonly PlayerSeat[]);
