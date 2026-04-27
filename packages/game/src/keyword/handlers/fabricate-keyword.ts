// SPDX-License-Identifier: GPL-3.0-or-later
// FabricateKeywordHandler — processes K:Fabricate:N keyword lines (Kaladesh,
// CR 702.115) and synthesizes an ETB trigger that asks the controller to
// either put N +1/+1 counters on self OR create N 1/1 colorless Servo
// artifact creature tokens.
//
// CR 702.115a — "Fabricate N" — "When this creature enters, put N +1/+1
// counters on it or create N 1/1 colorless Servo artifact creature tokens."
//
// DSL form:
//   K:Fabricate:1     → N = 1
//   K:Fabricate:2     → N = 2
//
// MVP scope:
//   1. Adds "fabricate" to card.keywords.
//   2. ETB trigger yields a chooseOption between "counters" and "tokens".
//      Default branch (no decision returned): counters.
//   3. counters: addCounter(+1/+1, N) on self.
//      tokens: createToken(Servo, count=N).
import {
  type CardDefinition,
  CardType,
  ColorSet,
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  type EntityId,
  type GameEvent,
  type KeywordAst,
  type PaperCard,
  type ParamValue,
  type Supertype,
  type TriggeredAbility,
  TypeLine,
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

const buildServoPaperCard = (): PaperCard => {
  const NO_SUPERTYPES: readonly Supertype[] = [];
  const types = new TypeLine(NO_SUPERTYPES, [CardType.Artifact, CardType.Creature], ["Servo"]);
  const definition: CardDefinition = {
    name: "Servo Token",
    oracle: "",
    types,
    manaCost: null,
    pt: { power: "1", toughness: "1" },
    colors: ColorSet.empty(),
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  };
  return {
    name: "Servo Token",
    edition: "TOK",
    collectorNumber: "0",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition,
  };
};

export class FabricateKeywordHandler extends KeywordHandler {
  static override readonly keyword = "fabricate" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("fabricate");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const rawN =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 1;
    const n = Number.isFinite(rawN) && rawN > 0 ? rawN : 1;

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

          const decision = (yield {
            kind: "decision",
            request: {
              kind: "chooseOption",
              sourceId: sourceCardId,
              options: [
                { id: "counters", description: `+${n}/+${n} counters` },
                { id: "tokens", description: `${n} Servo tokens` },
              ],
            },
          }) as { readonly kind: "chooseOption"; readonly optionId: string } | undefined;

          const branch = decision?.kind === "chooseOption" ? decision.optionId : "counters";

          if (branch === "tokens") {
            yield* g.action.createToken({
              paperCard: buildServoPaperCard(),
              controller: controllerSeat,
              count: n,
            });
          } else {
            yield* g.action.addCounter(sourceCardId, CounterType.PlusOnePlusOne, n, sourceCardId);
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
    card?.keywords?.delete("fabricate");
  }
}

keywordHandlerRegistry.register(FabricateKeywordHandler);
