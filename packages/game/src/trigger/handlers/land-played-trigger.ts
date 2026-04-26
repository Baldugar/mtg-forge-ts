// SPDX-License-Identifier: GPL-3.0-or-later
// LandPlayedTrigger — Wave 16. Forge `T:Mode$ LandPlayed`.
// Fires when a player plays a land for turn (Lotus Cobra, Tatyova, etc.).
//
// Forge pattern:
//   T:Mode$ LandPlayed | ValidPlayer$ You | Execute$ TrigEffect
//     | TriggerDescription$ Whenever a land enters the battlefield under your
//       control (via the land drop), ...
//
// Engine event: "LandPlayed" (Wave 16). Engine-side EMIT lands once the
// land-play action grows a "land for turn" emit hook (currently TODO).
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

export class LandPlayedTrigger extends TriggerHandler {
  static override readonly mode = "LandPlayed";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validCardRaw = getParamRaw(ast, "ValidCard") ?? "Card";
    const validPlayerRaw = getParamRaw(ast, "ValidPlayer") ?? "You";
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
        if (event.kind !== "LandPlayed") return false;
        const { cardId, playerSeat } = event.payload as {
          cardId: EntityId;
          playerSeat: PlayerSeat;
        };
        if (validCardRaw === "Card.Self") {
          if (cardId !== sourceCardId) return false;
        } else if (validCardRaw !== "Card") {
          // Any other filter (e.g. Land.YouCtrl) — accept seat-filter only.
          if (validCardRaw.toLowerCase().includes(".youctrl") && playerSeat !== controllerSeat) {
            return false;
          }
        }
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
              `LandPlayedTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `LandPlayedTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(LandPlayedTrigger);
