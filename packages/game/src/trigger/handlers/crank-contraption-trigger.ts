// SPDX-License-Identifier: GPL-3.0-or-later
// CrankContraptionTrigger — Wave 16. Handles Forge's `T:Mode$ CrankContraption`.
// Fires when a contraption is assembled / cranked (Unstable mechanic).
//
// Forge pattern:
//   T:Mode$ CrankContraption | ValidCard$ Card.Self | Execute$ TrigCrank
//     | TriggerDescription$ When you crank this contraption, ...
//   T:Mode$ CrankContraption | ValidPlayer$ You | Execute$ TrigBoom
//     | TriggerDescription$ When you crank a contraption, ...
//
// Engine event: "CardCranked" (added in Wave 16) — payload { cardId, controllerSeat }.
// Engine-side EMIT: Wave 117 — AdvanceCrankEffect fires CardCranked per
// on-sprocket contraption AFTER rotating the per-controller sprocket
// pointer (mirrors Forge.Player.advanceCrankCounter), then closes with a
// ContraptionCranked deck-event pulse.
//
// ValidCard$ MVP support:
//   Card.Self — fires when this exact contraption is cranked.
//   Card      — fires when any contraption is cranked.
//
// ValidPlayer$ MVP support (Wave 117):
//   You       — fires when the controller cranks a contraption.
//   Opponent  — fires when an opponent cranks a contraption.
//   Player    — fires regardless of who cranked.
//   (omitted) — defaults to "Player" (backwards-compatible no-op for
//               trigger lines that only declare ValidCard$).
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

export class CrankContraptionTrigger extends TriggerHandler {
  static override readonly mode = "CrankContraption";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validCardRaw = getParamRaw(ast, "ValidCard") ?? "Card.Self";
    const validPlayerRaw = getParamRaw(ast, "ValidPlayer") ?? "Player";
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
        if (event.kind !== "CardCranked") return false;
        const { cardId, controllerSeat: cranker } = event.payload as {
          cardId: EntityId;
          controllerSeat: PlayerSeat;
        };
        // ValidCard$ — gate on which contraption was cranked.
        if (validCardRaw === "Card.Self" && cardId !== sourceCardId) return false;
        if (validCardRaw !== "Card.Self" && validCardRaw !== "Card") return false;
        // ValidPlayer$ — gate on who cranked. Default "Player" matches all.
        if (validPlayerRaw === "You" && cranker !== controllerSeat) return false;
        if (validPlayerRaw === "Opponent" && cranker === controllerSeat) return false;
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
              `CrankContraptionTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `CrankContraptionTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
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

triggerHandlerRegistry.register(CrankContraptionTrigger);
