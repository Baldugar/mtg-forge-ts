// SPDX-License-Identifier: GPL-3.0-or-later
// AttacksTrigger — handles Forge's `T:Mode$ Attacks` trigger line.
// Matches the engine's "AttackersDeclared" event and checks the ValidCard$
// param against each attacker in the event payload.
//
// Forge pattern:
//   T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigPump | TriggerDescription$ Whenever this creature attacks, it gets +1/+1 until end of turn.
//
// Wave 32 — Battalion (Gatecrash, ~10 cards):
//   T:Mode$ Attacks | ValidCard$ Card.Self | TriggerZones$ Battlefield
//     | IsPresent$ Creature.attacking+Other | PresentCompare$ GE2
//     | Execute$ TrigPump
//   The IsPresent$ filter walks the AttackersDeclared batch (with `Other`
//   excluding self) and PresentCompare$ gates firing on the count.
//
// ValidCard$ now supports comma-OR alternatives + plus-joined qualifiers,
// the `Other` qualifier, and the `Revolt$ True` flag (per-controller
// permanentsLeftBfThisTurn gate).
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
import { cardMatchesFilter, evalPresentCompare } from "../card-filter.js";
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
// AttacksTrigger
// ---------------------------------------------------------------------------

export class AttacksTrigger extends TriggerHandler {
  static override readonly mode = "Attacks";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validRaw = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    const isPresentRaw = getParamRaw(ast, "IsPresent");
    const presentCompareRaw = getParamRaw(ast, "PresentCompare") ?? "GE1";
    const revoltGate = getParamRaw(ast, "Revolt") === "True";
    const { sourceCardId, controllerSeat, triggerId, game } = ctx;

    // Execute$ value — the SVar name this trigger resolves to (e.g. "TrigPump").
    const executeKey = ast.effect.handlerKey;

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      // Attacks triggers are active while on the battlefield.
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0, // populated by activateTriggersFromDefinition if needed
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        if (event.kind !== "AttackersDeclared") return false;
        const { attackingSeat, attackers } = event.payload as {
          attackingSeat: PlayerSeat;
          attackers: readonly { readonly attackerId: EntityId }[];
        };

        if (attackers.length === 0) return false;

        // Resolve attackers to the live Card set for filter evaluation +
        // "attacking" qualifier scoping.
        const attackingIds = new Set<EntityId>(attackers.map((a) => a.attackerId));

        // ValidCard$ — comma-OR over alternatives. The MVP fast paths
        // (Card.Self / Card / Card.YouCtrl) remain inline so we don't
        // touch game.cards when not necessary.
        let validCardOk = false;
        if (validRaw === "Card.Self") {
          validCardOk = attackingIds.has(sourceCardId);
        } else if (validRaw === "Card") {
          validCardOk = attackingIds.size > 0;
        } else if (validRaw === "Card.YouCtrl") {
          validCardOk = attackingSeat === controllerSeat;
        } else {
          // Comma-OR / plus-AND filter: at least one attacker must satisfy.
          for (const id of attackingIds) {
            const card = game.cards.get(id);
            if (!card) continue;
            if (
              cardMatchesFilter(card, validRaw, {
                controllerSeat,
                sourceCardId,
                attackingIds,
              })
            ) {
              validCardOk = true;
              break;
            }
          }
        }
        if (!validCardOk) return false;

        // IsPresent$ + PresentCompare$ — Battalion-style attacker-count gate.
        // Counts attackers in the current declaration matching the filter
        // (commonly Creature.attacking+Other to demand "≥N OTHER attackers").
        if (isPresentRaw !== undefined) {
          let count = 0;
          for (const id of attackingIds) {
            const card = game.cards.get(id);
            if (!card) continue;
            if (
              cardMatchesFilter(card, isPresentRaw, {
                controllerSeat,
                sourceCardId,
                attackingIds,
              })
            ) {
              count++;
            }
          }
          if (!evalPresentCompare(count, presentCompareRaw)) return false;
        }

        // Revolt$ True — per CR, "a permanent you controlled left the
        // battlefield this turn". Read the per-seat counter populated by
        // game-action.ts moveTo and reset by phase-handler at turn end.
        if (revoltGate) {
          const n = game.flags.permanentsLeftBfThisTurn.get(controllerSeat) ?? 0;
          if (n <= 0) return false;
        }

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
              `AttacksTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `AttacksTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(AttacksTrigger);
