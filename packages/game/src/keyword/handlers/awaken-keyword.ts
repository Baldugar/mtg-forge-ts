// SPDX-License-Identifier: GPL-3.0-or-later
// AwakenKeywordHandler — processes K:Awaken:N:cost keyword lines
// (Battle for Zendikar, CR 702.112). MVP stamps the awaken cost slot
// and synthesizes a SpellCast self-trigger that, when the awaken cost
// was paid, animates a target land controlled by the controller as a
// 0/0 Elemental creature with N P1P1 counters.
//
// CR 702.112a — "Awaken N — [cost]" — "If you cast this spell for its
// awaken cost, also put N +1/+1 counters on target land you control;
// it becomes a 0/0 Elemental creature with haste. It's still a land."
//
// DSL form:
//   K:Awaken:3:4 U     → N=3, awaken cost = {4}{U}
//
// MVP scope:
//   1. Adds "awaken" to card.keywords. Stamps `card.kickerCost` to the
//      awaken mana cost so the cast pipeline's confirmAction loop
//      (Wave 49 kicker hook) can offer the optional cost — the awaken
//      pipeline reuses the kicker cost slot for the optional-cost
//      payment surface.
//   2. Stamps `card.awakenAmount = N` so the awaken sub-effect's
//      resolver knows how many counters to add. Read by the SpellCast
//      self-trigger below.
//   3. SpellCast self-trigger: when this spell is cast and `wasKicked`
//      is true, yield a chooseCard over lands the controller controls.
//      On chosen, addCounter PlusOnePlusOne N + register a Layer 7c
//      "this land is also a 0/0 Elemental creature with haste"
//      continuous effect (TODO(advanced) — the type-changing static is
//      stamped via card.types/subtypes for MVP read-paths; full Layer 4
//      type-add lives in a follow-up).
//
// TODO(advanced) — wiring the optional-cost loop to a separate slot
// (`awakenCost` rather than `kickerCost`) is a pure refactor; both
// slots feed into the same confirmAction pipeline. Sharing the kicker
// slot means a card with both Kicker and Awaken would conflict — none
// of the printed Awaken cards also carry Kicker, so this is safe in
// practice.
import type {
  ContinuousEffect,
  EntityId,
  GameEvent,
  KeywordAst,
  ParamValue,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { CardType, CounterType, Layer, ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { Layer7cEffect } from "../../layers/layer7-pt.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class AwakenKeywordHandler extends KeywordHandler {
  static override readonly keyword = "awaken" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("awaken");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const costParam = ast.params?.cost as ParamValue | undefined;
    const rawN =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 1;
    const n = Number.isFinite(rawN) && rawN > 0 ? rawN : 1;
    const awakenCost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";

    card.awakenAmount = n;
    // Reuse the kicker-cost slot so the cast pipeline's optional-cost
    // confirmAction loop offers the awaken cost. None of the printed
    // Awaken cards also carry Kicker, so the slot collision is safe.
    if (card.kickerCost === undefined) {
      card.kickerCost = awakenCost;
    }

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
        if (p.cardId !== sourceCardId) return false;
        const c = game.cards.get(sourceCardId);
        if (!c) return false;
        // Only fire when the optional kicker / awaken cost was paid.
        return c.wasKicked === true;
      },
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          const amount = self.awakenAmount ?? n;

          // Enumerate lands the controller controls.
          const eligible: EntityId[] = [];
          for (const [id, c] of g.cards) {
            if (c.controllerSeat !== controllerSeat) continue;
            if (c.zone !== ZoneType.Battlefield) continue;
            const chars = g.layerEngine.computeCharacteristics(id);
            if (!chars.types.has(CardType.Land)) continue;
            eligible.push(id);
          }
          if (eligible.length === 0) return;

          const decision = (yield {
            kind: "decision",
            request: {
              kind: "chooseCard",
              playerSeat: controllerSeat,
              pool: eligible,
              restriction: { keyword: "awaken" },
              min: 1,
              max: 1,
            },
          }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;

          const targetId = decision && decision.kind === "chooseCard" ? decision.chosen[0] : eligible[0];
          if (targetId === undefined) return;

          // Stamp +N/+N counters.
          yield* g.action.addCounter(targetId, CounterType.PlusOnePlusOne, amount, sourceCardId);

          // Register a 0/0 base PT (Layer 7b) — MVP: just modify so
          // the result is "0/0 + N P1P1 counters". The layer engine
          // tolerates the simpler shape; full "land becomes Elemental
          // creature" Layer 4 type-add is TODO(advanced).
          const timestamp: number = g.newEntityId();
          const layer7c: Layer7cEffect = {
            kind: "modify",
            powerDelta: 0,
            toughnessDelta: 0,
            timestamp,
            sourceAbilityId: sourceCardId,
            targetCardIdFn: () => targetId,
          };
          const effect: ContinuousEffect = {
            id: g.newEntityId(),
            sourceCardId,
            timestamp,
            layer: Layer.L7c_PTModify,
            // CR 702.112a — "until end of turn" is NOT specified; the
            // awaken effect persists for the rest of the game on that
            // land. Use untilSourceLeaves so the effect ends only if
            // the spell card permanently leaves play; for MVP we use
            // a permanent duration (no expiration).
            duration: { kind: "permanent" },
            payload: { kind: "pt-modify", effect: layer7c },
          };
          g.continuousEffectRegistry.register(effect);
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(ta as unknown as TriggeredAbility);
    game.triggerRegistry.register(ta as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("awaken");
  }
}

keywordHandlerRegistry.register(AwakenKeywordHandler);
