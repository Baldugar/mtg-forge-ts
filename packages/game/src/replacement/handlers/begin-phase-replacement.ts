// SPDX-License-Identifier: GPL-3.0-or-later
// BeginPhaseReplacement — handles Forge's `R:Event$ BeginPhase` replacement
// line. Niche: a small set of Forge cards skip phases or alter how a phase
// begins (Stasis-style "skip your draw step", "skip your combat phase",
// Astral Slide / Eon Hub etc.).
//
// Forge patterns:
//   R:Event$ BeginPhase | ValidPlayer$ You | Phase$ Draw | Layer$ CantHappen
//     | Description$ You skip your draw step.
//   R:Event$ BeginPhase | ValidPlayer$ Each | Phase$ Upkeep | Prevent$ True
//     | Description$ Skip everyone's upkeep step.
//
// Wave 19 MVP support:
//   ValidPlayer$ You / Opponent / Each / Player — seat filter.
//   Phase$ <name>                                — phase-name filter (case-insensitive).
//   Layer$ CantHappen / Prevent$ True           — skip the phase entirely.
//
// Like the other Wave 17 niche replacements, ReplaceWith$ SVar dispatch is
// recorded but deferred to a follow-up wave.
import type { MutationIntent, PlayerSeat, ReplacementAbility, ReplacementAst } from "@mtg-forge-ts/core";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { ReplacementHandler } from "../replacement-handler.js";

const getParamRaw = (ast: ReplacementAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

export class BeginPhaseReplacement extends ReplacementHandler {
  static override readonly eventKind = "BeginPhase";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const validPlayerRaw = getParamRaw(ast, "ValidPlayer") ?? "Player";
    const phaseFilter = getParamRaw(ast, "Phase");
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
        if (intent.kind !== "beginPhase") return false;
        const bp = intent as { seat?: PlayerSeat; phase?: string };
        const seat = bp.seat;
        if (seat === undefined) return false;
        if (validPlayerRaw === "You" && seat !== controllerSeat) return false;
        if (validPlayerRaw === "Opponent" && seat === controllerSeat) return false;
        // "Each" / "Player" — accept any seat.
        if (phaseFilter !== undefined) {
          const phase = bp.phase;
          if (phase === undefined) return false;
          if (phase.toLowerCase() !== phaseFilter.toLowerCase()) return false;
        }
        return true;
      },

      apply(intent: MutationIntent, _game: unknown): MutationIntent | null {
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        // ReplaceWith$ <SVar> — recorded for a follow-up wave; until then,
        // pass through unchanged so the phase still begins normally (no
        // half-resolution).
        void sourceCardId;
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(BeginPhaseReplacement);
