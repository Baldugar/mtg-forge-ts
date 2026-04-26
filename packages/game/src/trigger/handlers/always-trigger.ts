// SPDX-License-Identifier: GPL-3.0-or-later
// AlwaysTrigger — handles Forge's `T:Mode$ Always` trigger line.
//
// Forge usage examples:
//   T:Mode$ Always | TriggerZones$ Battlefield | IsPresent$ Card.Self+counters_EQ0_P1P1
//     | Execute$ TrigSac
//     | TriggerDescription$ When CARDNAME has no +1/+1 counters on it, sacrifice it.
//   T:Mode$ Always | TriggerZones$ Battlefield | IsPresent$ Swamp.YouCtrl
//     | PresentCompare$ EQ0 | Execute$ TrigSac
//     | TriggerDescription$ When you control no Swamps, sacrifice CARDNAME.
//
// Forge's Always-mode triggers are STATE-condition triggers — they
// re-evaluate their `IsPresent$` / `CheckSVar$` predicate each time the
// game's "check state-based effects + check triggers" pulse fires, and
// queue a triggered ability when the predicate transitions from false →
// true. This implementation treats `Always` as a match-all event filter
// (every non-telemetry event causes a re-check); the resolver runs the
// Execute$ SVar exactly once per matching event. Recursion is avoided by
// filtering out engine-internal telemetry events (TriggerQueued,
// TriggerResolved, ReplacementApplied, EventPrevented, etc.) so the
// trigger's own resolution does not re-fire.
//
// SP3 follow-up: the IsPresent$ predicate is NOT yet evaluated here —
// the resolver fires unconditionally on every non-telemetry event,
// which over-triggers for cards like Bog Serpent. The flagship guard
// is engine correctness (no infinite recursion); SP4 wires the
// IsPresent$ predicate into matches() to gate firing precisely.
import type {
  AbilityAst,
  GameEvent,
  GameEventKind,
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

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

// Engine-internal/telemetry kinds that must NOT cause an Always-trigger
// match — re-firing on TriggerQueued / TriggerResolved would create an
// infinite recursion. Mirrors ENGINE_INTERNAL_EVENT_KINDS in game.ts.
const TELEMETRY_KINDS: ReadonlySet<GameEventKind> = new Set<GameEventKind>([
  "ReplacementApplied",
  "EventPrevented",
  "TriggerQueued",
  "TriggerResolved",
  "StateBasedActionApplied",
  "StaticAbilityRegistered",
  "StaticAbilityUnregistered",
  "ContinuousEffectRegistered",
  "ContinuousEffectExpired",
  "CostPaid",
  "PhaseStepEnded",
]);

export class AlwaysTrigger extends TriggerHandler {
  static override readonly mode = "Always";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = ast.effect.handlerKey;

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield, ZoneType.Command]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        // Telemetry events never re-trigger Always — guards against
        // infinite recursion when this trigger's own resolution emits
        // engine-internal markers.
        if (TELEMETRY_KINDS.has(event.kind)) return false;
        // AbilityActivated for THIS trigger's own activation must not
        // re-match. We cannot check abilityId here cheaply; the broad
        // telemetry filter above handles the registry-level chatter,
        // and the AbilityActivated event for the trigger's resolution
        // does not include the trigger's own id (it tracks stack item
        // activation only). MVP returns true for all non-telemetry
        // events — SP4 narrows via the IsPresent$ predicate.
        return true;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const resolveGame = gameUnknown as Game;
          const sourceCard = resolveGame.cards.get(sourceCardId);
          if (!sourceCard) return;
          const def = sourceCard.paperCard.definition;
          if (!def) return;
          const svars = def.svars as ReadonlyMap<string, SVarAst>;
          const sv = svars.get(executeKey);
          if (!sv) {
            throw new Error(
              `AlwaysTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `AlwaysTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          const fakeAst: AbilityAst = {
            kind: "spell",
            effect: sv.ability,
            cost: { raw: "" },
          };
          const sa = new SpellAbility(fakeAst, sourceCardId, controllerSeat, svars, []);
          const innerResolver = sa.makeResolver();
          yield* innerResolver.resolve(resolveGame);
        },
      },
    };

    return ta as unknown as TriggeredAbility;
  }
}

triggerHandlerRegistry.register(AlwaysTrigger);
