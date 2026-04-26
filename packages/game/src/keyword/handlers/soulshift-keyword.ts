// SPDX-License-Identifier: GPL-3.0-or-later
// SoulshiftKeywordHandler — processes K:Soulshift:N keyword lines (Saviors
// of Kamigawa, CR 702.46) and synthesizes a death-trigger that may return
// a Spirit card with mana value ≤ N from the controller's graveyard to
// their hand.
//
// CR 702.46a — "Soulshift N (When this creature is put into a graveyard
// from the battlefield, you may return target Spirit card with mana value
// N or less from your graveyard to your hand.)"
//
// DSL form:
//   K:Soulshift:N    → soulshift amount = N
//
// MVP scope:
//   1. Adds "soulshift" to card.keywords.
//   2. Watches CardChangedZone (Battlefield → Graveyard) for self.
//   3. On resolve: enumerate Spirit cards in the controller's graveyard
//      with cmc ≤ N (excluding self). If at least one is eligible, yield
//      chooseCard (min=0, max=1) — the controller may decline. If chosen,
//      moveTo Graveyard → Hand.
import type {
  EntityId,
  GameEvent,
  KeywordAst,
  ManaCostAst,
  PaperCard,
  ParamValue,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { ManaCost, ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

/** Read printed mana value from a PaperCard.definition. Mirrors the
 * helper in cascade-keyword.ts. */
const cardManaValue = (paper: PaperCard | undefined): number => {
  const def = paper?.definition;
  if (!def) return 0;
  const mcAst = def.manaCost as ManaCostAst | null | undefined;
  if (!mcAst) return 0;
  const mc = ManaCost.parse(mcAst.raw);
  return mc.cmc(0);
};

/** True when the card's PaperCard definition carries the "Spirit" subtype.
 * Tolerant of case variation since the Forge corpus is mostly canonical-
 * cased but tests sometimes lowercase. Subtypes live on the parsed
 * TypeLine (def.types.subtypes), not directly on CardDefinition. */
const isSpirit = (paper: PaperCard | undefined): boolean => {
  const def = paper?.definition;
  if (!def) return false;
  const subtypes = def.types.subtypes as readonly string[] | undefined;
  if (!subtypes) return false;
  for (const s of subtypes) {
    if (s === "Spirit") return true;
    if (s.toLowerCase() === "spirit") return true;
  }
  return false;
};

export class SoulshiftKeywordHandler extends KeywordHandler {
  static override readonly keyword = "soulshift" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("soulshift");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const shiftN =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 0;
    const safeN = Number.isFinite(shiftN) && shiftN >= 0 ? shiftN : 0;

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
        const p = event.payload as {
          cardId: EntityId;
          fromZone: ZoneType;
          toZone: ZoneType;
        };
        return (
          p.cardId === sourceCardId && p.fromZone === ZoneType.Battlefield && p.toZone === ZoneType.Graveyard
        );
      },
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          // Enumerate eligible Spirit cards in controller's graveyard
          // (excluding self) with cmc ≤ N.
          const eligible: EntityId[] = [];
          for (const [id, c] of g.cards) {
            if (id === sourceCardId) continue;
            if (c.zone !== ZoneType.Graveyard) continue;
            if (c.ownerSeat !== controllerSeat) continue;
            if (!isSpirit(c.paperCard)) continue;
            if (cardManaValue(c.paperCard) > safeN) continue;
            eligible.push(id);
          }
          if (eligible.length === 0) return;

          const decision = (yield {
            kind: "decision",
            request: {
              kind: "chooseCard",
              playerSeat: controllerSeat,
              pool: eligible,
              restriction: { keyword: "soulshift", n: safeN },
              min: 0,
              max: 1,
            },
          }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;
          if (!decision || decision.kind !== "chooseCard") return;
          const chosenId = decision.chosen[0];
          if (chosenId === undefined) return;
          if (!eligible.includes(chosenId)) return;

          yield* g.action.moveTo(chosenId, ZoneType.Hand, {
            toSeat: controllerSeat,
            cause: "soulshift",
          });
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(ta as unknown as TriggeredAbility);
    game.triggerRegistry.register(ta as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("soulshift");
  }
}

keywordHandlerRegistry.register(SoulshiftKeywordHandler);
