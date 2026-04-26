// SPDX-License-Identifier: GPL-3.0-or-later
// ReplicateKeywordHandler — processes K:Replicate:<cost> keyword lines
// (Guildpact, CR 702.71) and stamps a SpellCast self-trigger that loops
// to copy the spell N times.
//
// CR 702.71a — "Replicate [cost] (When you cast this spell, copy it for
// each time you paid its replicate cost. You may choose new targets for
// the copies.)"
//
// MVP scope:
//   1. Adds "replicate" to card.keywords.
//   2. Stamps a SpellCast(Card.Self) trigger that yields a confirmAction
//      loop asking "pay replicate again?". Each confirmed iteration
//      enqueues a copy of the spell on the stack via
//      game.action.copySpell. The actual mana payment for each replicate
//      iteration is deferred — full additive cost-at-cast wiring requires
//      extending the cast pipeline's optional-cost loop.
//
// TODO(advanced) — Replicate's cost is paid additively at cast-time
// alongside the spell's main mana cost (CR 601.2f). The MVP path leaves
// the cost as a no-op (the trigger asks how many copies and queues them
// without charging mana) so the keyword stamps and the copy loop is
// observable for tests. Closing the cost gap requires a cast-pipeline
// extension to support per-spell repeated optional additional costs.
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

export class ReplicateKeywordHandler extends KeywordHandler {
  static override readonly keyword = "replicate" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("replicate");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const replicateCost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    void replicateCost; // currently unused — see TODO(advanced) above.

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;

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

          // Loop: keep asking "pay replicate again?". Each confirmed
          // iteration queues a copy of the spell. The additional cost is
          // not actually charged in the MVP — see TODO(advanced) above.
          let copies = 0;
          // Hard cap to avoid runaway prompts in adversarial tests.
          const HARD_CAP = 32;
          for (let i = 0; i < HARD_CAP; i++) {
            const response = (yield {
              kind: "decision",
              request: {
                kind: "confirmAction",
                sourceId: sourceCardId,
                prompt: "Pay replicate cost again to copy this spell?",
              },
            }) as { readonly kind: "confirmAction"; readonly confirmed: boolean } | undefined;
            if (response?.confirmed !== true) break;
            copies++;
          }

          if (copies <= 0) return;

          // Locate the in-flight stack item for this spell and queue
          // copies. game.action.copySpell handles stack placement; if the
          // spell already resolved (race), the loop becomes a no-op.
          const stack = g.sharedZones.stack;
          let spellStackId: EntityId | undefined;
          for (const it of stack.toArray()) {
            if (it.kind === "spell" && it.sourceCardId === sourceCardId) {
              spellStackId = it.id;
              break;
            }
          }
          if (spellStackId === undefined) return;

          const action = g.action as unknown as {
            copySpell?: (
              stackItemId: EntityId,
              opts: { count: number; chooseNewTargets: boolean; controller: number },
            ) => Generator<unknown, void, unknown>;
          };
          if (typeof action.copySpell === "function") {
            yield* action.copySpell(spellStackId, {
              count: copies,
              chooseNewTargets: true,
              controller: controllerSeat,
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
    card?.keywords?.delete("replicate");
  }
}

keywordHandlerRegistry.register(ReplicateKeywordHandler);
