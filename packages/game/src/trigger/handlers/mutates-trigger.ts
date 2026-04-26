// SPDX-License-Identifier: GPL-3.0-or-later
// MutatesTrigger — Wave 16. Forge `T:Mode$ Mutates` (Ikoria mechanic).
// Fires when a card mutates onto another (CR 702.146).
//
// Forge pattern:
//   T:Mode$ Mutates | ValidCard$ Card.Self | Execute$ TrigEffect
//     | TriggerDescription$ Whenever this creature mutates, ...
//
// Engine event: "CardMutated" (Wave 16). The Mutate mechanic itself is wired
// in a later wave; tests stub-emit CardMutated for now.
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

export class MutatesTrigger extends TriggerHandler {
  static override readonly mode = "Mutates";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validCardRaw = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    const validPlayerRaw = getParamRaw(ast, "ValidActivatingPlayer") ?? "Each";
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
        if (event.kind !== "CardMutated") return false;
        const {
          hostId,
          mutatorId,
          controllerSeat: mutatingSeat,
        } = event.payload as {
          hostId: EntityId;
          mutatorId: EntityId;
          controllerSeat: PlayerSeat;
        };
        // ValidCard$ Card.Self matches when this card is either the host or
        // the mutator — Forge fires on either side of the merge.
        if (validCardRaw === "Card.Self") {
          if (hostId !== sourceCardId && mutatorId !== sourceCardId) return false;
        } else if (validCardRaw !== "Card") {
          return false;
        }
        if (validPlayerRaw === "You" && mutatingSeat !== controllerSeat) return false;
        if (validPlayerRaw === "Opponent" && mutatingSeat === controllerSeat) return false;
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
              `MutatesTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `MutatesTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(MutatesTrigger);
