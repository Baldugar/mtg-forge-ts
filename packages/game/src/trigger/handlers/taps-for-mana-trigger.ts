// SPDX-License-Identifier: GPL-3.0-or-later
// TapsForManaTrigger — Wave 16. Forge `T:Mode$ TapsForMana`.
// Fires when a card taps to add mana (Mana Reflection, Heartbeat of Spring,
// Vorinclex, etc.).
//
// Forge pattern:
//   T:Mode$ TapsForMana | ValidCard$ Land.YouCtrl | Execute$ TrigEffect
//     | TriggerDescription$ Whenever a land you control is tapped for mana, ...
//
// Engine event: "ManaTapped" (Wave 16). Distinct from ManaEnteredPool — this
// requires the cause to be a tap-for-mana ability resolution. Engine-side
// emission lands when the mana ability subsystem grows the tap-cause hook.
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

export class TapsForManaTrigger extends TriggerHandler {
  static override readonly mode = "TapsForMana";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validCardRaw = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    const validPlayerRaw = getParamRaw(ast, "ValidPlayer") ?? "Each";
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
        if (event.kind !== "ManaTapped") return false;
        const { cardId, playerSeat } = event.payload as {
          cardId: EntityId;
          playerSeat: PlayerSeat;
        };
        if (validCardRaw === "Card.Self") {
          if (cardId !== sourceCardId) return false;
        } else if (validCardRaw === "Card") {
          // any
        } else {
          // qualifier-bearing filter (e.g. Land.YouCtrl) — MVP accepts the
          // YouCtrl seat-filter and ignores type qualifiers.
          if (validCardRaw.toLowerCase().includes(".youctrl") && playerSeat !== controllerSeat) {
            return false;
          }
          if (
            (validCardRaw.toLowerCase().includes(".oppctrl") ||
              validCardRaw.toLowerCase().includes(".opponentctrl")) &&
            playerSeat === controllerSeat
          ) {
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
              `TapsForManaTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `TapsForManaTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(TapsForManaTrigger);
