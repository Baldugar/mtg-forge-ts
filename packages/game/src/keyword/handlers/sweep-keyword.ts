// SPDX-License-Identifier: GPL-3.0-or-later
// SweepKeywordHandler — processes K:Sweep:<Type> keyword lines (Saviors
// of Kamigawa, "Sweep" cycle) and synthesizes a SpellCast(Card.Self)
// trigger that fires the additional-cost return-lands loop.
//
// Effective rules text — "Sweep — Return any number of <Type> lands you
// control to their owner's hand. <effect> references the number of
// lands returned this way."
//
// In Forge data, the Sweep cycle is encoded inline on the spell's main
// SP$ ChangeZone ability rather than as a stand-alone K: line, but the
// engine still benefits from a stable id (`sweep`) so the corpus parser
// can land same-shape K:Sweep:<Type> entries. Wave 39 stamps the keyword
// + the type slot so the additional-cost wiring has a hook.
//
// DSL form:
//   K:Sweep:Plains      → type = "Plains"
//   K:Sweep:Mountain    → type = "Mountain"
//
// MVP scope:
//   1. Adds "sweep" to card.keywords.
//   2. Stamps `card.sweepReturnedType = <Type>` so the cast pipeline /
//      SVar layer can read it.
//   3. Synthesizes a SpellCast(Card.Self) trigger that, on resolve,
//      stamps `card.sweepReturnedCount = 0` (default; the additional-
//      cost loop populates the slot when the player returns lands).
//
// TODO(advanced) — the full additional-cost loop yields a chooseCards
// over `Land.<Type>+YouCtrl`, returns each chosen land to its owner's
// hand, and stamps `card.sweepReturnedCount = chosen.length` so the
// spell's effect can read `Count$Sweep` via the SVar resolver. Wave 39
// stamps the keyword + slots so the corpus parses; the chooseCards loop
// + Count$Sweep SVar binding land when the additional-cost-at-cast hook
// is widened beyond the existing Strive / Kicker shapes.
import type { EntityId, GameEvent, KeywordAst, ParamValue, TriggeredAbility } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class SweepKeywordHandler extends KeywordHandler {
  static override readonly keyword = "sweep" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("sweep");

    const typeParam = ast.params?.type as ParamValue | undefined;
    const sweepType = typeParam && typeParam.kind === "literal" ? (typeParam.raw as string) : "";
    (card as unknown as { sweepReturnedType?: string; sweepReturnedCount?: number }).sweepReturnedType =
      sweepType;
    (card as unknown as { sweepReturnedType?: string; sweepReturnedCount?: number }).sweepReturnedCount = 0;

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
        *resolve(_gameUnknown: unknown): Generator<unknown, void, unknown> {
          // TODO(advanced) — yield chooseCards over `Land.<sweepType>+
          // YouCtrl`, return each to its owner's hand, then stamp
          // `card.sweepReturnedCount = chosen.length`. The additional-
          // cost loop is a sibling of Strive / Kicker; it lands once the
          // additional-cost-at-cast hook is widened. Until then the
          // count is left at the entry-time default of 0.
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
    card.keywords?.delete("sweep");
    Reflect.deleteProperty(card as object, "sweepReturnedType");
    Reflect.deleteProperty(card as object, "sweepReturnedCount");
  }
}

keywordHandlerRegistry.register(SweepKeywordHandler);
