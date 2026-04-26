// SPDX-License-Identifier: GPL-3.0-or-later
// ReboundKeywordHandler — processes K:Rebound keyword lines (Rise of the
// Eldrazi, CR 702.88) and synthesizes:
//   1. A SpellCast(Card.Self) trigger that, when the spell was cast from
//      hand, mutates the live StackItem provenance to redirect post-
//      resolution movement to Exile (instead of the graveyard) and stamps
//      `card.reboundUntilUpkeep = game.turn + 1`.
//   2. An upkeep trigger that, when active turn === reboundUntilUpkeep
//      and the card is in Exile, yields a confirmAction; on yes, casts
//      the card from Exile for free via FreeCastPipeline.
//
// CR 702.88a — "Rebound (If you cast this spell from your hand, exile it
//   as it resolves. At the beginning of your next upkeep, you may cast
//   this card from exile without paying its mana cost.)"
//
// MVP scope:
//   - Provenance mutation uses a `readonly`-bypassing cast — provenance
//     objects are plain literals, not deep-frozen. Wave 31 may move the
//     redirect into stepChooseZoneOverride for a non-mutation path.
//   - The upkeep trigger fires on TurnStarted (any seat). It rechecks
//     active seat === controller before yielding.
import {
  type EntityId,
  type GameEvent,
  type KeywordAst,
  PhaseStep,
  type TriggeredAbility,
  ZoneType,
} from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { CastContext } from "../../cast/cast-context.js";
import { CastPipeline, type CastProposal } from "../../cast/cast-pipeline.js";
import type { Game } from "../../game.js";
import type { StackItemProvenance, StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

// Mirror of the Cascade FreeCastPipeline subclass: zero out totalCost.base
// so stepPayCosts auto-passes (the existing free-cast gate).
class FreeCastPipeline extends CastPipeline {
  protected override *stepDetermineTotalCost(ctx: CastContext): Generator<EngineYield, void, unknown> {
    const costMods = this.game.staticEffectRegistry.byCategory("costModification");
    ctx.totalCost = {
      base: null,
      modIds: costMods.map((s) => s.id),
      additionalCostIds: [...ctx.additionalCostsPaid],
      altCostUsed: ctx.altCostUsed,
      xValue: ctx.xValue,
    };
  }
}

export class ReboundKeywordHandler extends KeywordHandler {
  static override readonly keyword = "rebound" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("rebound");

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;

    // 1. SpellCast(Card.Self) trigger — when this spell is cast from hand,
    //    redirect its post-resolution destination to Exile and mark the
    //    card so the upkeep trigger can re-cast it next turn.
    const castId = game.newEntityId();
    const castTrigger: TriggeredAbilityWithResolver = {
      id: castId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Stack]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "SpellCast") return false;
        const p = event.payload as { readonly cardId: EntityId; readonly stackItemId: EntityId };
        return p.cardId === sourceCardId;
      },
      resolver: {
        // biome-ignore lint/correctness/useYield: provenance mutation is synchronous
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          // Find the StackItem; require its origin zone to be Hand.
          const stack = g.sharedZones.stack;
          let target: { provenance: StackItemProvenance } | null = null;
          for (const it of stack.toArray()) {
            if (it.kind === "spell" && it.sourceCardId === sourceCardId) {
              target = it as unknown as { provenance: StackItemProvenance };
            }
          }
          if (target === null) return;
          if (target.provenance.originZone !== ZoneType.Hand) return;
          // Mutate provenance to redirect to Exile.
          (target.provenance as { alternativeZoneDestination?: ZoneType }).alternativeZoneDestination =
            ZoneType.Exile;
          const c = g.cards.get(sourceCardId);
          if (c) {
            (c as unknown as { reboundUntilUpkeep?: number }).reboundUntilUpkeep = g.turn + 1;
          }
        },
      },
    };
    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(castTrigger as unknown as TriggeredAbility);
    game.triggerRegistry.register(castTrigger as unknown as TriggeredAbility);

    // 2. Upkeep trigger — at the beginning of the controller's next
    //    upkeep, yield a confirmAction. On confirm, cast from Exile for
    //    free via FreeCastPipeline.
    const upkeepId = game.newEntityId();
    const upkeepTrigger: TriggeredAbilityWithResolver = {
      id: upkeepId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Exile]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "StepStarted") return false;
        const p = event.payload as { readonly step?: PhaseStep; readonly activeSeat?: number };
        if (p.step !== PhaseStep.Upkeep) return false;
        const c = game.cards.get(sourceCardId);
        if (!c) return false;
        if (c.zone !== ZoneType.Exile) return false;
        const due = (c as unknown as { reboundUntilUpkeep?: number }).reboundUntilUpkeep;
        if (due === undefined) return false;
        if (game.turn < due) return false;
        // Active player must be controller.
        return game.activePlayer === controllerSeat;
      },
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const c = g.cards.get(sourceCardId);
          if (!c) return;
          if (c.zone !== ZoneType.Exile) return;

          const response = (yield {
            kind: "decision",
            request: {
              kind: "confirmAction",
              sourceId: sourceCardId,
              prompt: "Cast the rebounded spell from exile without paying its mana cost?",
            },
          }) as { readonly kind: "confirmAction"; readonly confirmed: boolean } | undefined;
          if (response?.confirmed !== true) return;

          // Clear the slot before casting so a re-rebound (if rules ever
          // allow) doesn't loop. Standard rebound exits play after this
          // resolution and goes back to graveyard normally.
          // exactOptionalPropertyTypes: avoid `= undefined` on an optional
          // slot via Reflect.deleteProperty (mirrors the no-delete-friendly
          // pattern used in resolve/effect-resolve.ts).
          Reflect.deleteProperty(c as object, "reboundUntilUpkeep");

          const pipeline = new FreeCastPipeline(g);
          const proposal: CastProposal = {
            castingPlayer: controllerSeat,
            sourceCardId,
            originZone: ZoneType.Exile,
            asSpecialAction: false,
          };
          yield* pipeline.run(proposal) as Generator<unknown, unknown, unknown>;
        },
      },
    };
    card.triggeredAbilities.push(upkeepTrigger as unknown as TriggeredAbility);
    game.triggerRegistry.register(upkeepTrigger as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("rebound");
  }
}

keywordHandlerRegistry.register(ReboundKeywordHandler);
