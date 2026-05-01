// SPDX-License-Identifier: GPL-3.0-or-later
// OffspringKeywordHandler — processes K:Offspring:<cost> keyword lines
// (Bloomburrow, CR 702.171) and stamps the offspring cost so the cast
// pipeline can offer the optional "create a 1/1 token copy when this
// enters" additional cost.
//
// CR 702.171a — "Offspring [cost]" — "You may pay an additional [cost]
// as you cast this spell. When this creature enters, if the offspring
// cost was paid, create a token that's a copy of it, except it's 1/1."
//
// Wave 93 — closes the ETB token-copy synthesis TODO. The handler now:
//   1. Adds "offspring" to card.keywords + stamps card.offspringCost.
//   2. ETB trigger (CardChangedZone → Battlefield): when
//      card.offspringPaid === true, calls game.action.createToken with
//      isCopy=true / count=1 and stamps tokenOverrides.setPower /
//      .setToughness = 1 so deriveBaseCharacteristics applies the 1/1
//      override on top of the copied characteristics. Mirrors the
//      Eternalize pattern (which sets 4/4).
import type { EntityId, GameEvent, KeywordAst, ParamValue, TriggeredAbility } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class OffspringKeywordHandler extends KeywordHandler {
  static override readonly keyword = "offspring" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("offspring");

    // Wave 59 — keyword-line parser cleanup moved offspring into
    // COST_KEYWORDS, so the canonical slot is `cost`. The legacy `detail`
    // fallback is retained for snapshot-restore tolerance only.
    const costParam =
      (ast.params?.cost as ParamValue | undefined) ?? (ast.params?.detail as ParamValue | undefined);
    const offspringCost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.offspringCost = offspringCost;

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
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          // CR 702.171a — "if the offspring cost was paid, create a
          // token that's a copy of it, except it's 1/1." Reads
          // offspringPaid stamped at cast time; otherwise no-op.
          if (self.offspringPaid !== true) return;
          const ids = yield* g.action.createToken({
            paperCard: self.paperCard,
            controller: controllerSeat,
            count: 1,
            isCopy: true,
            copyOf: sourceCardId,
          });
          for (const id of ids) {
            const tok = g.cards.get(id);
            if (!tok) continue;
            // Stamp 1/1 P/T override (CR 702.171a). Mirrors Eternalize's
            // setPower/setToughness pattern (which stamps 4/4) — the
            // deriveBaseCharacteristics path applies these AFTER the copy
            // payload so the override wins.
            tok.tokenOverrides = {
              ...(tok.tokenOverrides ?? {}),
              setPower: 1,
              setToughness: 1,
            };
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
    card.keywords?.delete("offspring");
    card.offspringCost = undefined;
    card.offspringPaid = undefined;
  }
}

keywordHandlerRegistry.register(OffspringKeywordHandler);
