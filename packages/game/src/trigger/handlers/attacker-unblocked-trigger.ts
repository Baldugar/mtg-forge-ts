// SPDX-License-Identifier: GPL-3.0-or-later
// AttackerUnblockedTrigger — Wave 16. Forge `T:Mode$ AttackerUnblocked`.
// Fires when an attacker remains unblocked after blockers have been declared.
//
// Forge pattern:
//   T:Mode$ AttackerUnblocked | ValidCard$ Card.Self | Execute$ TrigEffect
//     | TriggerDescription$ Whenever this creature attacks and isn't blocked, ...
//
// Engine event: "AttackerUnblocked" (Wave 16). The combat system emits this
// at end of DeclareBlockers for any declared attacker that received zero
// blocker assignments. Engine-side wiring is TODO; tests synth-emit.
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

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

const getParamRaw = (ast: TriggerAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

export class AttackerUnblockedTrigger extends TriggerHandler {
  static override readonly mode = "AttackerUnblocked";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validCardRaw = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    const validPlayerRaw = getParamRaw(ast, "ValidAttackingPlayer") ?? "Each";
    const { sourceCardId, controllerSeat, triggerId } = ctx;
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
        if (event.kind !== "AttackerUnblocked") return false;
        const { attackerId, attackingSeat } = event.payload as {
          attackerId: EntityId;
          attackingSeat: PlayerSeat;
        };
        if (validCardRaw === "Card.Self") {
          if (attackerId !== sourceCardId) return false;
        } else if (validCardRaw !== "Card") {
          return false;
        }
        if (validPlayerRaw === "You" && attackingSeat !== controllerSeat) return false;
        if (validPlayerRaw === "Opponent" && attackingSeat === controllerSeat) return false;
        return true;
      },

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
              `AttackerUnblockedTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `AttackerUnblockedTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
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

triggerHandlerRegistry.register(AttackerUnblockedTrigger);
