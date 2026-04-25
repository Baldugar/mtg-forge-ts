// SPDX-License-Identifier: GPL-3.0-or-later
// AttacksTrigger — handles Forge's `T:Mode$ Attacks` trigger line.
// Matches the engine's "AttackersDeclared" event and checks the ValidCard$
// param against each attacker in the event payload.
//
// Forge pattern:
//   T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ TrigPump | TriggerDescription$ Whenever this creature attacks, it gets +1/+1 until end of turn.
//
// ValidCard$ MVP support:
//   Card.Self    — only fires when the source card itself attacks.
//   Card         — fires when any creature attacks (global watcher).
//   Card.YouCtrl — fires when any creature the controller controls attacks
//                  (identified by attackingSeat === controllerSeat).
//
// Note: AttackersDeclared is a batch event containing ALL attackers declared
// in one step. We match if ANY attacker in the batch satisfies ValidCard$.
// For Card.Self and Card.YouCtrl, the seat-level check (attackingSeat) is
// sufficient for the common case; Card.Self also verifies the specific card id.
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
// AttacksTrigger
// ---------------------------------------------------------------------------

export class AttacksTrigger extends TriggerHandler {
  static override readonly mode = "Attacks";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validRaw = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    const { sourceCardId, controllerSeat, triggerId } = ctx;

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

        // ValidCard$ Card.Self — the source card itself must be in the attackers list.
        if (validRaw === "Card.Self") {
          return attackers.some((a) => a.attackerId === sourceCardId);
        }

        // ValidCard$ Card — any attacker fires this trigger.
        if (validRaw === "Card") {
          return attackers.length > 0;
        }

        // ValidCard$ Card.YouCtrl — any creature controlled by this trigger's
        // controller attacks. In MTG, all attackers belong to the active player,
        // so we check attackingSeat === controllerSeat.
        if (validRaw === "Card.YouCtrl") {
          return attackingSeat === controllerSeat;
        }

        // Other ValidCard$ filters deferred to future parts.
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
