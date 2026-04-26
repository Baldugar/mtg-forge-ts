// SPDX-License-Identifier: GPL-3.0-or-later
// ChampionKeywordHandler — processes K:Champion:<type> keyword lines (Lorwyn,
// CR 702.71) and synthesizes ETB + LTB TriggeredAbilities.
//
// CR 702.71a — "Champion a [type]" — When this permanent enters, exile a
// [type] you control or sacrifice this. When this leaves the battlefield,
// return the exiled card to the battlefield under its owner's control.
//
// DSL form:
//   K:Champion:Goblin     → champion a Goblin
//   K:Champion:Elf        → champion an Elf
//
// This handler:
//   1. Adds "champion" to card.keywords.
//   2. Registers an ETB trigger (CardChangedZone Any → Battlefield, ValidCard
//      Card.Self):
//        - On resolve: enumerate live battlefield permanents the controller
//          controls of the matching subtype (excluding self).
//        - If none, sacrifice self.
//        - If at least one, yield chooseCard for one. Exile it; stamp
//          card.championedTarget = chosen.id and chosen.championedBy = self.
//   3. Registers an LTB trigger (CardChangedZone Battlefield → Any,
//      ValidCard Card.Self):
//        - On resolve: if championedTarget is set and that card is in Exile
//          with championedBy === self, return it to its owner's battlefield.
import type { EntityId, GameEvent, KeywordAst, ParamValue, TriggeredAbility } from "@mtg-forge-ts/core";
import { CardType, ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

/**
 * True iff `card`'s computed characteristics declare the subtype string
 * `wantedType`. Subtypes are stored on chars.subtypes (a Set of strings) per
 * the layer engine; we tolerate both raw and lowercase variants since the
 * Forge corpus mixes "Goblin" and "goblin" forms.
 */
const matchesType = (chars: { types: Set<CardType>; subtypes: Set<string> }, wantedType: string): boolean => {
  if (chars.subtypes.has(wantedType)) return true;
  const lower = wantedType.toLowerCase();
  for (const t of chars.subtypes) {
    if (t.toLowerCase() === lower) return true;
  }
  return false;
};

export class ChampionKeywordHandler extends KeywordHandler {
  static override readonly keyword = "champion" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("champion");

    const typeParam = ast.params?.type as ParamValue | undefined;
    const wantedType = typeParam && typeParam.kind === "literal" ? (typeParam.raw as string) : "Creature";

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;

    // --- ETB trigger ---
    const etbId = game.newEntityId();
    const etb: TriggeredAbilityWithResolver = {
      id: etbId,
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

          // Enumerate eligible permanents the controller controls of the
          // requested subtype (creatures by default; CR text actually says
          // "a [type] you control" — for an unknown type fall back to any
          // creature).
          const eligible: EntityId[] = [];
          for (const [id, c] of g.cards) {
            if (id === sourceCardId) continue;
            if (c.controllerSeat !== controllerSeat) continue;
            if (c.zone !== ZoneType.Battlefield) continue;
            const chars = g.layerEngine.computeCharacteristics(id);
            if (!chars.types.has(CardType.Creature)) continue;
            if (!matchesType(chars, wantedType)) continue;
            eligible.push(id);
          }

          if (eligible.length === 0) {
            // No eligible target — sacrifice self.
            yield* g.action.sacrifice(sourceCardId, { sourceId: sourceCardId });
            return;
          }

          // Yield chooseCard (min=1, max=1).
          const decision = yield {
            kind: "decision",
            request: {
              kind: "chooseCard",
              playerSeat: controllerSeat,
              pool: eligible,
              restriction: { keyword: "champion", type: wantedType },
              min: 1,
              max: 1,
            },
          };
          const r = decision as { kind: string; chosen?: readonly EntityId[] };
          const chosen =
            r.kind === "chooseCard" && r.chosen && r.chosen.length === 1 ? r.chosen[0] : undefined;
          if (chosen === undefined || !eligible.includes(chosen)) {
            // Invalid pick — fizzle by sacrificing self (CR 702.71b).
            yield* g.action.sacrifice(sourceCardId, { sourceId: sourceCardId });
            return;
          }

          // Exile the chosen target; stamp the linkage.
          yield* g.action.exile(chosen, { sourceId: sourceCardId });
          self.championedTarget = chosen;
          const target = g.cards.get(chosen);
          if (target) target.championedBy = sourceCardId;
          // Wave 41 — emit CardChampioned so ChampionedTrigger (Wave 22)
          // fires. The exile mutation above already publishes
          // CardExiled / CardChangedZone; this event names the mechanic
          // explicitly so triggers can match the championer/championed
          // pair without re-deriving from zone-change history.
          yield g.emitEvent(
            mkEvent("CardChampioned", g.turn, g.phase, {
              championerId: sourceCardId,
              championedId: chosen,
            }),
          );
        },
      },
    };
    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(etb as unknown as TriggeredAbility);
    game.triggerRegistry.register(etb as unknown as TriggeredAbility);

    // --- LTB trigger ---
    const ltbId = game.newEntityId();
    const ltb: TriggeredAbilityWithResolver = {
      id: ltbId,
      kind: "triggered",
      sourceCardId,
      // CR 603.10 — leaves-the-battlefield triggers must observe state from
      // the moment before the move; the engine emits CardChangedZone with
      // fromZone=Battlefield once already moved, so this trigger watches
      // that signal directly. (LKI lookup is SP4 polish.)
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "CardChangedZone") return false;
        const p = event.payload as { cardId: EntityId; fromZone: ZoneType; toZone: ZoneType };
        return (
          p.cardId === sourceCardId &&
          p.fromZone === ZoneType.Battlefield &&
          p.toZone !== ZoneType.Battlefield
        );
      },
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          const targetId = self.championedTarget;
          if (targetId === undefined) return;
          const target = g.cards.get(targetId);
          if (!target) return;
          if (target.championedBy !== sourceCardId) return;
          if (target.zone !== ZoneType.Exile) return;
          // Return target to its owner's battlefield.
          yield* g.action.moveTo(targetId, ZoneType.Battlefield, { toSeat: target.ownerSeat });
          // Clear linkage (idempotent on subsequent moves).
          self.championedTarget = undefined;
          target.championedBy = undefined;
        },
      },
    };
    card.triggeredAbilities.push(ltb as unknown as TriggeredAbility);
    game.triggerRegistry.register(ltb as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("champion");
  }
}

keywordHandlerRegistry.register(ChampionKeywordHandler);
