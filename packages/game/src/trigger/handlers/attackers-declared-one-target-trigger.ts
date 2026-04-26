// SPDX-License-Identifier: GPL-3.0-or-later
// AttackersDeclaredOneTargetTrigger — Wave 16. Forge `T:Mode$ AttackersDeclaredOneTarget`.
// Like AttackersDeclared, but only fires when the attacking player declared
// attackers against EXACTLY one defending player/planeswalker/battle.
//
// Forge pattern:
//   T:Mode$ AttackersDeclaredOneTarget | ValidPlayer$ Opponent | Execute$ TrigPump
//     | TriggerDescription$ Whenever an opponent attacks a single player or
//       planeswalker, ...
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

type Defender =
  | { readonly kind: "player"; readonly seat: PlayerSeat }
  | { readonly kind: "planeswalker"; readonly id: EntityId }
  | { readonly kind: "battle"; readonly id: EntityId };

const defenderKey = (d: Defender): string =>
  d.kind === "player" ? `p:${String(d.seat)}` : `${d.kind}:${String(d.id)}`;

export class AttackersDeclaredOneTargetTrigger extends TriggerHandler {
  static override readonly mode = "AttackersDeclaredOneTarget";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
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
        if (event.kind !== "AttackersDeclared") return false;
        const { attackingSeat, attackers } = event.payload as {
          attackingSeat: PlayerSeat;
          attackers: readonly { readonly attackerId: EntityId; readonly defender: Defender }[];
        };
        if (!attackers || attackers.length === 0) return false;
        // OneTarget gate — all attackers must share the same defender.
        const firstDefender = attackers[0]?.defender;
        if (!firstDefender) return false;
        const k = defenderKey(firstDefender);
        for (const a of attackers) {
          if (defenderKey(a.defender) !== k) return false;
        }
        if (validPlayerRaw === "You") return attackingSeat === controllerSeat;
        if (validPlayerRaw === "Opponent") return attackingSeat !== controllerSeat;
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
              `AttackersDeclaredOneTargetTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `AttackersDeclaredOneTargetTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(AttackersDeclaredOneTargetTrigger);
