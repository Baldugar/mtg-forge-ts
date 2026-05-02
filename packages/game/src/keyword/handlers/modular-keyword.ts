// SPDX-License-Identifier: GPL-3.0-or-later
// ModularKeywordHandler — processes K:Modular:N keyword lines (Mirrodin,
// CR 702.43) and synthesizes ETB-with-counters + LTB transfer triggers.
//
// CR 702.43a — "Modular N (This creature enters the battlefield with N
//   +1/+1 counters on it. When it dies, you may put its +1/+1 counters
//   on target artifact creature.)"
//
// DSL form:
//   K:Modular:N  → modular amount N (AMOUNT_KEYWORDS).
//
// This handler:
//   1. Adds "modular" to card.keywords.
//   2. ETB trigger: on entering, put N +1/+1 counters on self.
//   3. LTB-to-graveyard trigger: when this dies (Battlefield → Graveyard,
//      cardId === self), yield a chooseCard decision over artifact
//      creatures the controller controls; if chosen, transfer the source's
//      P1P1 counter count onto the chosen target.
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

export class ModularKeywordHandler extends KeywordHandler {
  static override readonly keyword = "modular" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("modular");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const modN =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 1;
    const safeN = Number.isFinite(modN) && modN > 0 ? modN : 1;

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;

    // M6.19 — Modular's "enters with N +1/+1 counters" is a CR 614
    // replacement effect in Forge (not a triggered ability that goes onto
    // the stack). Mirror that by stamping an etbCounterSpecs entry on the
    // card; applyEtbStamping consumes the slot synchronously inside the
    // ETB pipeline (silent — no AbilityActivated, no SpellCast). This
    // matches Forge's Modular replacement-effect emission of CounterAdded
    // without a queued trigger.
    const slot = card as unknown as {
      etbCounterSpecs?: Array<{
        readonly counterType: CounterType;
        readonly amount: number;
        readonly variable: boolean;
      }>;
    };
    if (!slot.etbCounterSpecs) slot.etbCounterSpecs = [];
    slot.etbCounterSpecs.push({
      counterType: CounterType.PlusOnePlusOne,
      amount: safeN,
      variable: false,
    });

    if (!card.triggeredAbilities) card.triggeredAbilities = [];

    // LTB trigger — when this dies (BF → graveyard), optionally transfer
    // counters to a target artifact creature.
    const ltbId = game.newEntityId();
    const ltb: TriggeredAbilityWithResolver = {
      id: ltbId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "CardChangedZone") return false;
        const p = event.payload as {
          cardId: EntityId;
          fromZone: ZoneType;
          toZone: ZoneType;
        };
        if (p.cardId !== sourceCardId) return false;
        if (p.fromZone !== ZoneType.Battlefield) return false;
        if (p.toZone !== ZoneType.Graveyard) return false;
        // M6.19 — CR 603.10c: Modular LTB targets `Creature.YouCtrl+Other+
        // Artifact` (Forge's keyword grammar). With no eligible artifact
        // creature on the battlefield, the trigger doesn't fire. Mirror
        // Forge's keyword-level legality probe so we don't queue a no-op
        // AbilityActivated/StackItemResolved.
        for (const [id, c] of game.cards) {
          if (id === sourceCardId) continue;
          if (c.controllerSeat !== controllerSeat) continue;
          if (c.zone !== ZoneType.Battlefield) continue;
          const chars = game.layerEngine.computeCharacteristics(id);
          if (chars.types.has(CardType.Artifact) && chars.types.has(CardType.Creature)) return true;
        }
        return false;
      },
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          // Read counter count BEFORE death — at this point the card is
          // already in the graveyard, but counter slots are not zeroed by
          // the move (Card.counters persists). The MVP reads what's left
          // on the card object after the move — equivalent to LKI for the
          // counter slot.
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          const have = self.counters?.get(CounterType.PlusOnePlusOne) ?? 0;
          if (have <= 0) return;

          // Eligible: artifact creatures the controller controls.
          const eligible: EntityId[] = [];
          for (const [id, c] of g.cards) {
            if (id === sourceCardId) continue;
            if (c.controllerSeat !== controllerSeat) continue;
            if (c.zone !== ZoneType.Battlefield) continue;
            const chars = g.layerEngine.computeCharacteristics(id);
            if (!chars.types.has(CardType.Artifact)) continue;
            if (!chars.types.has(CardType.Creature)) continue;
            eligible.push(id);
          }
          if (eligible.length === 0) return;

          const decision = (yield {
            kind: "decision",
            request: {
              kind: "chooseCard",
              playerSeat: controllerSeat,
              pool: eligible,
              restriction: { keyword: "modular" },
              min: 0,
              max: 1,
            },
          }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;
          if (!decision || decision.kind !== "chooseCard") return;
          const targetId = decision.chosen[0];
          if (targetId === undefined) return;
          if (!eligible.includes(targetId)) return;

          yield* g.action.addCounter(targetId, CounterType.PlusOnePlusOne, have, sourceCardId);
        },
      },
    };
    card.triggeredAbilities.push(ltb as unknown as TriggeredAbility);
    game.triggerRegistry.register(ltb as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("modular");
  }
}

keywordHandlerRegistry.register(ModularKeywordHandler);
