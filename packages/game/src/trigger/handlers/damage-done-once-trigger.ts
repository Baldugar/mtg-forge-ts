// SPDX-License-Identifier: GPL-3.0-or-later
// DamageDoneOnceTrigger — handles Forge's `T:Mode$ DamageDoneOnce` trigger line.
// Forge fires this only on the FIRST damage event per turn/instance scope.
//
// MVP simplification: matches() behaves identically to DealtDamageTrigger
// (Mode$ DamageDone). The "fires only once" state-tracking is deferred —
// registered here so the semantic validator no longer flags DamageDoneOnce
// as an unknown mode. Wave N+1 adds a per-turn seen-set guard.
//
// Forge pattern:
//   T:Mode$ DamageDoneOnce | ValidSource$ Card.Self | ValidTarget$ Player
//     | Execute$ TrigOnce | TriggerDescription$ The first time this deals damage each turn, ...
//
// Supported ValidSource$: Card.Self, Card.
// Supported ValidTarget$: Player, Creature, Any.
// CombatDamage$: True / False / absent.
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

// ---------------------------------------------------------------------------
// DamageDoneOnceTrigger
// ---------------------------------------------------------------------------

export class DamageDoneOnceTrigger extends TriggerHandler {
  // Registry key matches the Forge DSL mode name.
  static override readonly mode = "DamageDoneOnce";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validSourceRaw = getParamRaw(ast, "ValidSource") ?? "Card.Self";
    const validTargetRaw = getParamRaw(ast, "ValidTarget") ?? "Any";
    const combatDamageRaw = getParamRaw(ast, "CombatDamage");
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

      // NOTE(stub): "once per turn" tracking omitted — deferred to Wave N+1.
      // Matches DamageDealt identically to DealtDamageTrigger for now.
      matches(event: GameEvent): boolean {
        if (event.kind !== "DamageDealt") return false;
        const { sourceId, targetKind, targetId, isCombat } = event.payload as {
          sourceId: EntityId;
          targetKind: "creature" | "player" | "planeswalker" | "battle";
          targetId: EntityId | PlayerSeat;
          amount: number;
          isCombat: boolean;
        };

        if (combatDamageRaw === "True" && !isCombat) return false;
        if (combatDamageRaw === "False" && isCombat) return false;

        if (validSourceRaw === "Card.Self") {
          if (sourceId !== sourceCardId) return false;
        } else if (validSourceRaw === "Card") {
          // Any source — no restriction.
        } else {
          return false;
        }

        if (validTargetRaw === "Any") return true;
        if (validTargetRaw === "Player") return targetKind === "player";
        if (validTargetRaw === "Creature") return targetKind === "creature";
        if (validTargetRaw === "You") return targetKind === "player" && targetId === controllerSeat;
        if (validTargetRaw === "Opponent") return targetKind === "player" && targetId !== controllerSeat;

        return false;
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
              `DamageDoneOnceTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `DamageDoneOnceTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(DamageDoneOnceTrigger);
