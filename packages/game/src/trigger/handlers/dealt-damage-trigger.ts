// SPDX-License-Identifier: GPL-3.0-or-later
// DealtDamageTrigger — handles Forge's `T:Mode$ DamageDone` trigger line.
// Matches the engine's "DamageDealt" event and checks the ValidSource$,
// ValidTarget$, and CombatDamage$ params against the event payload.
//
// Forge pattern:
//   T:Mode$ DamageDone | ValidSource$ Card.Self | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigDraw | TriggerDescription$ Whenever this deals combat damage to a player, draw a card.
//
// NOTE: Forge uses "DamageDone" as the trigger mode in card DSL. The engine
// event is "DamageDealt". The registry key here is the Forge DSL name
// "DamageDone" so the card parser can route vendored card text correctly.
//
// ValidSource$ MVP support:
//   Card.Self    — the source card must be the damage source.
//   Card         — any source fires this trigger (global watcher).
//   Card.YouCtrl — any source controlled by this trigger's controller.
//                  Not yet possible to verify at match time without a game
//                  reference; deferred — currently falls through to false.
//
// ValidTarget$ MVP support:
//   Player   — targetKind === "player" (any player seat).
//   Creature — targetKind === "creature".
//   Any      — any target kind.
//   You      — targetKind === "player" AND targetId === controllerSeat.
//   Opponent — targetKind === "player" AND targetId !== controllerSeat.
//
// CombatDamage$ param:
//   True    — event.isCombat must be true.
//   False   — event.isCombat must be false.
//   absent  — either (default, no constraint).
//
// Part E2: resolver is stamped on the returned TriggeredAbility so the
// priority orchestrator can drive the trigger body via the SVar pipeline.
import type {
  AbilityAst,
  EntityId,
  GameEvent,
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
  // svarRef / expression params are not supported for trigger conditions in MVP.
  return undefined;
};

// ---------------------------------------------------------------------------
// DealtDamageTrigger
// ---------------------------------------------------------------------------

export class DealtDamageTrigger extends TriggerHandler {
  // Registry key is the Forge DSL mode name "DamageDone", not the engine event
  // "DamageDealt", so that vendored card text (Mode$ DamageDone) routes here.
  static override readonly mode = "DamageDone";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validSourceRaw = getParamRaw(ast, "ValidSource") ?? "Card.Self";
    const validTargetRaw = getParamRaw(ast, "ValidTarget") ?? "Any";
    const combatDamageRaw = getParamRaw(ast, "CombatDamage"); // undefined = no constraint
    const { sourceCardId, controllerSeat, triggerId } = ctx;

    // Execute$ value — the SVar name this trigger resolves to (e.g. "TrigDraw").
    const executeKey = ast.effect.handlerKey;

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      // Damage triggers are active while on the battlefield.
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0, // populated by activateTriggersFromDefinition if needed
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        if (event.kind !== "DamageDealt") return false;
        const { sourceId, targetKind, targetId, isCombat } = event.payload as {
          sourceId: EntityId;
          targetKind: "creature" | "player" | "planeswalker" | "battle";
          targetId: EntityId | PlayerSeat;
          amount: number;
          isCombat: boolean;
        };

        // CombatDamage$ check — if specified, constrain to combat / noncombat.
        if (combatDamageRaw === "True" && !isCombat) return false;
        if (combatDamageRaw === "False" && isCombat) return false;

        // ValidSource$ check — who is dealing the damage.
        if (validSourceRaw === "Card.Self") {
          if (sourceId !== sourceCardId) return false;
        } else if (validSourceRaw === "Card") {
          // Any source — no restriction.
        } else {
          // Unrecognised filter (Card.YouCtrl etc.) — deferred.
          return false;
        }

        // ValidTarget$ check — what receives the damage.
        if (validTargetRaw === "Any") {
          return true;
        }
        if (validTargetRaw === "Player") {
          return targetKind === "player";
        }
        if (validTargetRaw === "Creature") {
          return targetKind === "creature";
        }
        // "You" — the controller of this trigger is the target player.
        if (validTargetRaw === "You") {
          return targetKind === "player" && targetId === controllerSeat;
        }
        // "Opponent" — a player other than the controller is the target.
        if (validTargetRaw === "Opponent") {
          return targetKind === "player" && targetId !== controllerSeat;
        }

        // Other ValidTarget$ values deferred to future parts.
        return false;
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
              `DealtDamageTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `DealtDamageTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          const fakeAst: AbilityAst = {
            kind: "spell",
            effect: sv.ability,
            cost: { raw: "" },
          };
          const sa = new SpellAbility(
            fakeAst,
            sourceCardId,
            controllerSeat,
            svars,
            [], // triggered abilities have no caster-selected targets at MVP
          );
          const innerResolver = sa.makeResolver();
          yield* innerResolver.resolve(game);
        },
      },
    };

    return ta as unknown as TriggeredAbility;
  }
}

triggerHandlerRegistry.register(DealtDamageTrigger);
