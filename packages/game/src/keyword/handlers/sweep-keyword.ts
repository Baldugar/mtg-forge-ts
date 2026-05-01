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
// Wave 93 — closes the additional-cost loop TODO. The handler now:
//   1. Adds "sweep" to card.keywords + stamps card.sweepReturnedType.
//   2. SpellCast(Card.Self) trigger: yields chooseCard over the
//      controller's battlefield lands matching sweepReturnedType
//      (min=0, max=eligible.length); routes each chosen land back to
//      its owner's hand via game.action.moveTo(Hand); stamps
//      card.sweepReturnedCount = chosen.length so SVar Count$Sweep
//      reads the live count when the spell resolves. When no lands
//      match, the trigger is a no-op (count stays at 0).
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

/**
 * Test whether a card is a Land with the requested subtype (case-insensitive).
 * Empty `sweepType` matches every Land (the catch-all variant).
 */
const matchesSweepLand = (game: Game, cardId: EntityId, sweepType: string): boolean => {
  const chars = game.layerEngine.computeCharacteristics(cardId);
  if (!chars.types.has(CardType.Land)) return false;
  if (sweepType.length === 0) return true;
  const target = sweepType.toLowerCase();
  for (const s of chars.subtypes) {
    if (s.toLowerCase() === target) return true;
  }
  return false;
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
    card.sweepReturnedType = sweepType;
    card.sweepReturnedCount = 0;

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
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          const type = self.sweepReturnedType ?? "";

          // Enumerate the controller's battlefield lands that match the
          // sweep type (case-insensitive subtype match; empty type =>
          // every land qualifies).
          const player = g.getPlayer(controllerSeat);
          const battlefield = player.zones.get(ZoneType.Battlefield);
          if (!battlefield) {
            self.sweepReturnedCount = 0;
            return;
          }
          const eligible: EntityId[] = [];
          for (const id of battlefield.toArray()) {
            if (matchesSweepLand(g, id, type)) eligible.push(id);
          }
          if (eligible.length === 0) {
            self.sweepReturnedCount = 0;
            return;
          }

          // Yield chooseCard for the controller — "any number" form
          // (min=0, max=eligible.length). Mirrors Amplify's reveal
          // pattern.
          const decision = (yield {
            kind: "decision",
            request: {
              kind: "chooseCard",
              playerSeat: controllerSeat,
              pool: eligible,
              restriction: { keyword: "sweep", type },
              min: 0,
              max: eligible.length,
            },
          }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;
          if (!decision || decision.kind !== "chooseCard") {
            self.sweepReturnedCount = 0;
            return;
          }
          const eligibleSet = new Set(eligible);
          const chosen: EntityId[] = [];
          for (const id of decision.chosen) {
            if (eligibleSet.has(id) && !chosen.includes(id)) chosen.push(id);
          }

          // Return each chosen land to its owner's hand.
          for (const landId of chosen) {
            yield* g.action.moveTo(landId, ZoneType.Hand, { cause: "sweep" });
          }
          // Stamp the count for SVar Count$Sweep.
          self.sweepReturnedCount = chosen.length;
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
    card.sweepReturnedType = undefined;
    card.sweepReturnedCount = undefined;
  }
}

keywordHandlerRegistry.register(SweepKeywordHandler);
