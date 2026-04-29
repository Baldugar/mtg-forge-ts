// SPDX-License-Identifier: GPL-3.0-or-later
// CasualtyKeywordHandler — processes K:Casualty:N keyword lines (Streets
// of New Capenna, CR 702.152) and stamps the casualty cost slot on the
// source card so the cast pipeline can offer the additional sacrifice as
// an optional cost producing a copy of the spell.
//
// CR 702.152a — "Casualty N" — "As you cast this spell, you may
// sacrifice a creature with power N or greater. When you do, copy this
// spell."
//
// Wave 64 scope:
//   1. Adds "casualty" to card.keywords.
//   2. Stamps `card.casualtyAmount = N`.
//   3. Synthesizes a SpellCast self-trigger that loops a confirmAction +
//      chooseCard prompt: each confirm asks the controller to sacrifice
//      a creature with power ≥ N; on success, queue a copy via
//      game.action.castCopyOf with newTargets: true (per CR 706.10b the
//      controller of the copy may choose new targets).
import {
  CardType,
  type EntityId,
  type GameEvent,
  type KeywordAst,
  type ParamValue,
  type TriggeredAbility,
  ZoneType,
} from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class CasualtyKeywordHandler extends KeywordHandler {
  static override readonly keyword = "casualty" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("casualty");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const rawN =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 1;
    const n = Number.isFinite(rawN) && rawN > 0 ? rawN : 1;
    card.casualtyAmount = n;

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;
    const threshold = n;

    const triggerId = game.newEntityId();
    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Stack]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "SpellCast") return false;
        const p = event.payload as { readonly cardId: EntityId };
        return p.cardId === sourceCardId;
      },
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;

          // Hard cap to avoid runaway prompts. The controller may keep
          // sacrificing as long as eligible creatures remain.
          const HARD_CAP = 32;
          for (let i = 0; i < HARD_CAP; i++) {
            // Enumerate eligible creatures: controlled by the caster,
            // on the battlefield, with power ≥ threshold.
            const eligible: EntityId[] = [];
            for (const [id, c] of g.cards) {
              if (c.controllerSeat !== controllerSeat) continue;
              if (c.zone !== ZoneType.Battlefield) continue;
              const chars = g.layerEngine.computeCharacteristics(id);
              if (!chars.types.has(CardType.Creature)) continue;
              const pow = chars.power;
              if (pow === null || pow < threshold) continue;
              eligible.push(id);
            }
            if (eligible.length === 0) break;

            const confirmResp = yield {
              kind: "decision",
              request: {
                kind: "confirmAction",
                sourceId: sourceCardId,
                prompt: `Sacrifice a creature with power ${threshold}+ to copy?`,
              },
            };
            const cf = confirmResp as { kind: string; confirmed?: boolean } | undefined;
            if (!cf || cf.kind !== "confirmAction" || cf.confirmed !== true) break;

            const sacDecision = yield {
              kind: "decision",
              request: {
                kind: "chooseCard",
                playerSeat: controllerSeat,
                pool: eligible,
                restriction: { keyword: "casualty" },
                min: 1,
                max: 1,
              },
            };
            const sr = sacDecision as { kind: string; chosen?: readonly EntityId[] } | undefined;
            let sacId: EntityId | undefined;
            if (sr && sr.kind === "chooseCard" && sr.chosen && sr.chosen.length === 1) {
              const picked = sr.chosen[0];
              if (picked !== undefined && eligible.includes(picked)) sacId = picked;
            }
            if (sacId === undefined) break;
            yield* g.action.sacrifice(sacId, { sourceId: sourceCardId });

            // CR 706.10b — the controller may pick new targets per CR
            // 702.152 (Casualty allows new targets per Forge data).
            yield* g.action.castCopyOf(sourceCardId, {
              controllerSeat,
              newTargets: true,
              freecast: true,
            });
          }
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
    card.keywords?.delete("casualty");
    card.casualtyAmount = undefined;
  }
}

keywordHandlerRegistry.register(CasualtyKeywordHandler);
