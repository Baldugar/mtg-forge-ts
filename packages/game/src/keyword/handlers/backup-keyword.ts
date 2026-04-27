// SPDX-License-Identifier: GPL-3.0-or-later
// BackupKeywordHandler — processes K:Backup:N keyword lines (Lord of the
// Rings: Tales of Middle-earth, CR 702.165) and synthesizes an ETB
// trigger that places N +1/+1 counters on a chosen creature and grants
// it the source's listed abilities until end of turn.
//
// CR 702.165a — "Backup N" — "When this creature enters, put N +1/+1
// counters on target creature. If that's another creature, it gains
// the listed abilities until end of turn."
//
// MVP scope:
//   1. Adds "backup" to card.keywords.
//   2. Stamps `card.backupAmount = N`.
//   3. ETB trigger: yield chooseCard for a battlefield creature
//      (auto-pick first eligible — full chooseCard decision is
//      TODO(advanced)). On resolve: addCounter(P1P1, N). Granting the
//      listed abilities until end of turn is documented under
//      TODO(advanced); the listed abilities are encoded as inline
//      AbilityAst lines on the source.
import type { EntityId, GameEvent, KeywordAst, ParamValue, TriggeredAbility } from "@mtg-forge-ts/core";
import { CardType, CounterType, ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class BackupKeywordHandler extends KeywordHandler {
  static override readonly keyword = "backup" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("backup");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const rawN =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 1;
    const n = Number.isFinite(rawN) && rawN > 0 ? rawN : 1;
    card.backupAmount = n;

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;
    const triggerId = game.newEntityId();

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        if (event.kind !== "CardChangedZone") return false;
        const p = event.payload as { cardId: EntityId; toZone: ZoneType };
        return p.cardId === sourceCardId && p.toZone === ZoneType.Battlefield;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          // Auto-pick first eligible creature on the battlefield.
          let target: EntityId | undefined;
          for (const [id, c] of g.cards) {
            if (c.zone !== ZoneType.Battlefield) continue;
            const chars = g.layerEngine.computeCharacteristics(id);
            if (!chars.types.has(CardType.Creature)) continue;
            target = id;
            break;
          }
          if (target === undefined) return;
          yield* g.action.addCounter(target, CounterType.PlusOnePlusOne, n, sourceCardId);
          // TODO(advanced) — grant the listed abilities until end of
          // turn when target is a different creature.
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(ta as unknown as TriggeredAbility);
    game.triggerRegistry.register(ta as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("backup");
    card.backupAmount = undefined;
  }
}

keywordHandlerRegistry.register(BackupKeywordHandler);
