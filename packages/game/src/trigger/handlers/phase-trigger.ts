// SPDX-License-Identifier: GPL-3.0-or-later
// PhaseTrigger — handles Forge's `T:Mode$ Phase` trigger line.
// Matches the engine's "StepStarted" event and checks the Phase$ and
// ValidPlayer$ params against the event payload.
//
// Forge pattern:
//   T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ You | Execute$ TrigScry
//
// ValidPlayer$ MVP support:
//   You        — trigger only fires on the controller's step.
//   Opponent   — trigger fires on any non-controller's step.
//   Each       — trigger fires on any player's step.
//
// Phase$ values correspond to PhaseStep enum strings (Upkeep, Draw,
// BeginCombat, EndStep, Cleanup, etc.). Matching is case-sensitive against
// the PhaseStep enum value.
//
// Part E2: Execute$ SVar is resolved at resolve-time to a SpellAbility whose
// makeResolver() drives the trigger body.
import type {
  AbilityAst,
  GameEvent,
  PhaseStep,
  PlayerSeat,
  SVarAst,
  TriggerAst,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { TriggerHandler } from "../trigger-handler.js";

// TriggeredAbility extended with the resolver the priority orchestrator
// duck-types. Core does not carry StackItemResolver so we extend locally
// and cast to TriggeredAbility on return.
type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extract a literal string param from TriggerAst.params, or return undefined. */
const getParamRaw = (ast: TriggerAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

/**
 * Map a Forge Phase$ param value to the canonical PhaseStep string.
 * Forge uses "EndOfTurn" for the end step; the engine uses "EndStep".
 * All other common names already match the PhaseStep enum.
 */
const normalizePhase = (raw: string): string => {
  // Forge alias "EndOfTurn" → PhaseStep.EndStep
  if (raw === "EndOfTurn") return "EndStep";
  return raw;
};

// ---------------------------------------------------------------------------
// PhaseTrigger
// ---------------------------------------------------------------------------

export class PhaseTrigger extends TriggerHandler {
  static override readonly mode = "Phase";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const phaseRaw = getParamRaw(ast, "Phase") ?? "Any";
    const validPlayerRaw = getParamRaw(ast, "ValidPlayer") ?? "Each";
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const targetPhase = normalizePhase(phaseRaw);

    // Execute$ value is the SVar name this trigger resolves to.
    const executeKey = ast.effect.handlerKey;

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        if (event.kind !== "StepStarted") return false;
        const { step, activeSeat } = event.payload as {
          step: PhaseStep;
          activeSeat: PlayerSeat;
        };

        // Check Phase$ param — "Any" matches every step
        if (targetPhase !== "Any" && step !== (targetPhase as PhaseStep)) return false;

        // Check ValidPlayer$ param
        if (validPlayerRaw === "You") return activeSeat === controllerSeat;
        if (validPlayerRaw === "Opponent") return activeSeat !== controllerSeat;
        // "Each" — any player
        return true;
      },

      // Part E2 — resolver: look up the Execute$ SVar at resolve-time,
      // wrap its EffectInvocation in a SpellAbility, and drive it.
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const game = gameUnknown as Game;
          const sourceCard = game.cards.get(sourceCardId);
          if (!sourceCard) return;
          const def = sourceCard.paperCard.definition;
          if (!def) return;
          const svars = def.svars as ReadonlyMap<string, SVarAst>;
          const sv = svars.get(executeKey);
          if (!sv) {
            throw new Error(
              `PhaseTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `PhaseTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          // Wrap the ability EffectInvocation in a minimal AbilityAst and
          // drive it via SpellAbility.makeResolver() → effectRegistry.
          const fakeAst: AbilityAst = {
            kind: "spell",
            effect: sv.ability,
            cost: { raw: "" },
          };
          const sa = new SpellAbility(fakeAst, sourceCardId, controllerSeat, svars, []);
          const innerResolver = sa.makeResolver();
          yield* innerResolver.resolve(game);
        },
      },
    };

    return ta as unknown as TriggeredAbility;
  }
}

triggerHandlerRegistry.register(PhaseTrigger);
