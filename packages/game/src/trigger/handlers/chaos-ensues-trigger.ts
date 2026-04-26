// SPDX-License-Identifier: GPL-3.0-or-later
// ChaosEnsuesTrigger — handles Forge's `T:Mode$ ChaosEnsues` trigger line.
// Fires when the Planechase chaos die rolls "chaos" (CR 901).
//
// Forge pattern (Academy at Tolaria West, the flagship test target):
//   T:Mode$ ChaosEnsues | TriggerZones$ Command | Execute$ TrigDiscard
//   | TriggerDescription$ Whenever chaos ensues, discard your hand.
//
// Match shape: PlanarDieRolled event with payload.result === "chaos".
// `rollingSeat` is informational — chaos ensues for ALL plane cards on the
// active player's plane chain regardless of who rolled (CR 901.13b). The
// trigger simply fires when the chaos face comes up.
//
// Active zone is Command — Planechase planes live in the command zone of
// the player whose plane is "out". When the active plane changes, planes
// register/unregister; this trigger's activeInZones gates the registry.
//
// Resolver: stamped from the Execute$ SVar so the priority orchestrator
// can drive the trigger body via the SpellAbility pipeline (same pattern
// as SpellCastTrigger). For SVar lookups that aren't ability-shaped, the
// resolver throws — the parent registry surfaces the error.
import type {
  AbilityAst,
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

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class ChaosEnsuesTrigger extends TriggerHandler {
  static override readonly mode = "ChaosEnsues";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = ast.effect.handlerKey;

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      // Plane cards live in the Command zone in the Planechase variant.
      activeInZones: new Set([ZoneType.Command]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        if (event.kind !== "PlanarDieRolled") return false;
        const { result } = event.payload as {
          rollingSeat: PlayerSeat;
          result: "chaos" | "planeswalk" | "blank";
        };
        return result === "chaos";
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
              `ChaosEnsuesTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `ChaosEnsuesTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(ChaosEnsuesTrigger);
