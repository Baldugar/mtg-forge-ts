// SPDX-License-Identifier: GPL-3.0-or-later
// PlaneswalkedToTrigger — Wave 16. Forge `T:Mode$ PlaneswalkedTo`.
// Fires when a player walks to a plane (Planechase format, CR 901).
//
// Forge pattern (typical Planechase plane card):
//   T:Mode$ PlaneswalkedTo | ValidCard$ Card.Self | Execute$ TrigEffect
//     | TriggerZones$ Command
//     | TriggerDescription$ When you planeswalk to this plane, ...
//
// Engine event: "PlaneswalkedTo" (Wave 16). Tests stub-emit; full Planechase
// flow lands in SP4 alongside ChaosEnsues / SetInMotion machinery.
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

export class PlaneswalkedToTrigger extends TriggerHandler {
  static override readonly mode = "PlaneswalkedTo";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validCardRaw = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    const validPlayerRaw = getParamRaw(ast, "ValidPlayer") ?? "Each";
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = ast.effect.handlerKey;

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Command]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        if (event.kind !== "PlaneswalkedTo") return false;
        const { planeCardId, playerSeat } = event.payload as {
          planeCardId: EntityId;
          playerSeat: PlayerSeat;
        };
        if (validCardRaw === "Card.Self" && planeCardId !== sourceCardId) return false;
        if (validCardRaw !== "Card.Self" && validCardRaw !== "Card") return false;
        if (validPlayerRaw === "You" && playerSeat !== controllerSeat) return false;
        if (validPlayerRaw === "Opponent" && playerSeat === controllerSeat) return false;
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
              `PlaneswalkedToTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `PlaneswalkedToTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(PlaneswalkedToTrigger);
