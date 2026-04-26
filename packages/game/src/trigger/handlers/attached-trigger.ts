// SPDX-License-Identifier: GPL-3.0-or-later
// AttachedTrigger — Wave 16. Forge `T:Mode$ Attached`.
// Fires when an Aura/Equipment/Fortification becomes attached.
//
// Forge pattern:
//   T:Mode$ Attached | ValidCard$ Card.Self | Execute$ TrigEffect
//     | TriggerDescription$ When this Aura becomes attached, ...
//
// Engine event: "CardAttached" (already in core taxonomy). The engine emits
// it from GameAction.attach with `cause` ∈ { cast, static, sba, activated }.
import type {
  AbilityAst,
  EntityId,
  GameEvent,
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

export class AttachedTrigger extends TriggerHandler {
  static override readonly mode = "Attached";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validSourceRaw = getParamRaw(ast, "ValidSource") ?? "Card.Self";
    const validTargetRaw = getParamRaw(ast, "ValidTarget");
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
        if (event.kind !== "CardAttached") return false;
        const { sourceId } = event.payload as {
          sourceId: EntityId;
          targetId: EntityId;
          cause: "cast" | "static" | "sba" | "activated";
        };
        if (validSourceRaw === "Card.Self") {
          if (sourceId !== sourceCardId) return false;
        } else if (validSourceRaw !== "Card") {
          return false;
        }
        // ValidTarget$ is reserved for type-qualified target filters; MVP
        // accepts any target when present (type checks deferred to a later
        // wave once card-type lookup is wired in matches()).
        if (validTargetRaw !== undefined && validTargetRaw === "Card.Self") {
          // Self-attach is impossible; reject to mirror Forge.
          return false;
        }
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
              `AttachedTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `AttachedTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(AttachedTrigger);
