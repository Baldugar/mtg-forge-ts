// SPDX-License-Identifier: GPL-3.0-or-later
// WardKeywordHandler — processes K:Ward:<cost> keyword lines (CR 702.21d)
// and synthesizes a Battlefield-zone TriggeredAbility on the source card.
//
// CR 702.21d — "Ward [cost]" — "Whenever this permanent becomes the target
// of a spell or ability an opponent controls, counter that spell or
// ability unless its controller pays [cost]."
//
// MVP scope:
//   1. Adds "ward" to card.keywords.
//   2. Stamps `card.wardCost = <costStr>` (raw cost text — mana, "Pay N
//      life", or any cost-payment-compatible fragment).
//   3. Synthesizes a Battlefield-zone TriggeredAbility that:
//        - watches CardTargeted events,
//        - matches when targetId === self AND targetingSeat !== controller,
//        - on resolve: yields confirmAction "pay (ward cost)?" addressed
//          to the targeting player, attempts payCost; on payment failure
//          (declined or insufficient), counters the targeting spell by
//          finding the corresponding stack item and removing it via the
//          standard counter pathway.
//
// Forge reference: CardFactoryUtil.java Ward block — Forge stitches the
// trigger inline as the keyword expands. We mirror that structure here.
//
// TODO(advanced) — Forge's Ward also fires for activated/triggered
// abilities ("a spell or ability") that target the permanent. The current
// CardTargeted event only fires for spells / activated abilities going
// through the cast pipeline / activate path. Triggered abilities that
// target the permanent (e.g. an opponent's BecomesTarget-style chain)
// are not yet emitting CardTargeted. When they do, this handler will fire
// for them too without changes.
import type {
  EntityId,
  GameEvent,
  KeywordAst,
  ParamValue,
  PlayerSeat,
  TriggeredAbility,
  ZoneType as ZoneTypeT,
} from "@mtg-forge-ts/core";
import { ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { CostPaymentContext } from "../../cost/parts/cost-part.js";
import { parseCostString, payCost } from "../../cost/parts/cost-payment.js";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class WardKeywordHandler extends KeywordHandler {
  static override readonly keyword = "ward" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("ward");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const wardCostRaw = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.wardCost = wardCostRaw;

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
        if (event.kind !== "CardTargeted") return false;
        const p = event.payload as {
          targetId: EntityId;
          sourceCardId: EntityId;
          targetingSeat: PlayerSeat;
        };
        if (p.targetId !== sourceCardId) return false;
        // CR 702.21d — only fires for spells/abilities an opponent
        // controls. Same-controller targeting is exempt. Use the LIVE
        // controller off the card so a control swap (Threaten / Mind
        // Control) re-routes ward to the new controller.
        const c = game.cards.get(sourceCardId);
        const liveController = c?.controllerSeat ?? controllerSeat;
        if (p.targetingSeat === liveController) return false;
        return true;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const c = g.cards.get(sourceCardId);
          if (!c) return;
          const cost = c.wardCost;
          if (cost === undefined) return;

          // Locate the in-flight stack item for the targeting spell. The
          // CardTargeted payload's sourceCardId is the targeting card; we
          // find its top-most stack-item id so we can counter it if the
          // ward cost is not paid. Activated abilities also live on the
          // stack as "activatedAbility" items with sourceCardId set.
          const triggerEvent = (this as unknown as { event?: GameEvent }).event;
          let targetingSeat: PlayerSeat | undefined;
          let targetingCardId: EntityId | undefined;
          if (triggerEvent && triggerEvent.kind === "CardTargeted") {
            const p = triggerEvent.payload as {
              targetId: EntityId;
              sourceCardId: EntityId;
              targetingSeat: PlayerSeat;
            };
            targetingSeat = p.targetingSeat;
            targetingCardId = p.sourceCardId;
          }
          if (targetingSeat === undefined || targetingCardId === undefined) return;

          // Yield the pay-or-counter decision. The decision is addressed
          // to the targeting player (the spell's controller).
          const decision = yield {
            kind: "decision",
            request: {
              kind: "confirmAction",
              sourceId: sourceCardId,
              prompt: `Pay ward {${cost}}? (otherwise the targeting spell or ability is countered)`,
            },
          };
          const r = decision as { kind: string; confirmed?: boolean };
          const willPay = r.kind === "confirmAction" && r.confirmed === true;

          let paid = false;
          if (willPay) {
            try {
              const plan = parseCostString(cost);
              const payCtx: CostPaymentContext = {
                game: g,
                payerSeat: targetingSeat,
                sourceCardId: targetingCardId,
                raw: cost,
                kind: "ability",
                sourceZone: ZoneType.Battlefield,
              };
              yield* payCost(plan, payCtx);
              paid = true;
            } catch {
              paid = false;
            }
          }
          if (paid) return;

          // Cost not paid — counter the targeting spell or ability. Find
          // the matching stack item by sourceCardId. Use the most recent
          // (top-most) entry so a stacked re-cast doesn't counter a
          // stale earlier copy.
          const stack = g.sharedZones.stack.toArray();
          let stackItemId: EntityId | undefined;
          for (let i = stack.length - 1; i >= 0; i--) {
            const it = stack[i];
            if (!it) continue;
            if (it.sourceCardId === targetingCardId) {
              stackItemId = it.id;
              break;
            }
          }
          if (stackItemId === undefined) return;

          const targetItem = stack.find((it) => it.id === stackItemId);
          if (!targetItem) return;

          // Emit StackItemCountered + remove from stack + move source to
          // graveyard (only for spell items). Mirrors CounterSpellEffect's
          // post-replacement path; ward predates the replacement loop on
          // the targeting spell, so we counter directly.
          g.sharedZones.stack.removeById(stackItemId);
          yield g.emitEvent(
            mkEvent("StackItemCountered", g.turn, g.phase, {
              stackItemId,
              byEffectId: sourceCardId,
            }),
          );
          if (targetItem.kind === "spell" || targetItem.kind === "copy") {
            const sc = g.cards.get(targetItem.sourceCardId);
            if (sc) {
              const dest: ZoneTypeT = ZoneType.Graveyard;
              yield* g.action.moveTo(targetItem.sourceCardId, dest, {
                toSeat: sc.ownerSeat,
                cause: "countered",
              });
            }
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
    card.keywords?.delete("ward");
    card.wardCost = undefined;
  }
}

keywordHandlerRegistry.register(WardKeywordHandler);
