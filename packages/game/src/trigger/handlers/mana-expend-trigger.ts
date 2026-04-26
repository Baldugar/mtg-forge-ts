// SPDX-License-Identifier: GPL-3.0-or-later
// ManaExpendTrigger — Wave 16. Forge `T:Mode$ ManaExpend`.
// Fires when mana of a specific kind is spent.
//
// Forge pattern:
//   T:Mode$ ManaExpend | ValidPlayer$ You | Color$ Red | Execute$ TrigEffect
//     | TriggerDescription$ Whenever you spend red mana, ...
//
// Engine event: "ManaSpent" (Wave 16). Engine-side: emit lands when the mana
// payment subsystem grows the spend-tracking hook (currently TODO).
import type {
  AbilityAst,
  GameEvent,
  PlayerSeat,
  SVarAst,
  TriggerAst,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { Color, ZoneType } from "@mtg-forge-ts/core";
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

const COLOR_BY_NAME: Readonly<Record<string, Color | null>> = {
  White: Color.White,
  Blue: Color.Blue,
  Black: Color.Black,
  Red: Color.Red,
  Green: Color.Green,
  // Colorlessness is encoded as `null` on the ManaSpent payload.
  Colorless: null,
};

export class ManaExpendTrigger extends TriggerHandler {
  static override readonly mode = "ManaExpend";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validPlayerRaw = getParamRaw(ast, "ValidPlayer") ?? "You";
    const colorRaw = getParamRaw(ast, "Color");
    // wantedColor: undefined = no color filter; null = explicit colorless;
    // Color value = a specific color must match.
    const wantedColor: Color | null | undefined =
      colorRaw === undefined ? undefined : (COLOR_BY_NAME[colorRaw] as Color | null | undefined);
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
        if (event.kind !== "ManaSpent") return false;
        const { playerSeat, color } = event.payload as {
          playerSeat: PlayerSeat;
          color: Color | null;
          amount: number;
        };
        if (validPlayerRaw === "You" && playerSeat !== controllerSeat) return false;
        if (validPlayerRaw === "Opponent" && playerSeat === controllerSeat) return false;
        if (wantedColor !== undefined && wantedColor !== color) return false;
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
              `ManaExpendTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `ManaExpendTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(ManaExpendTrigger);
