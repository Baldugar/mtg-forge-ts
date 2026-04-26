// SPDX-License-Identifier: GPL-3.0-or-later
// LivingWeaponKeywordHandler — processes K:Living Weapon keyword lines
// (Mirrodin Besieged, CR 702.91) and synthesizes an ETB trigger that
// creates a Germ token and attaches the equipment to it.
//
// CR 702.91a — "Living weapon (When this Equipment enters, create a 0/0
//   black Germ creature token, then attach this to it.)"
//
// DSL form:
//   K:Living Weapon  (resolves to keyword id "living_weapon")
//
// This handler:
//   1. Adds "living_weapon" to card.keywords.
//   2. Synthesizes an ETB trigger (CardChangedZone → Battlefield, =self)
//      that creates a Germ token via game.action.createToken with the
//      hand-rolled paper card, then attaches the source equipment to the
//      newly created token via game.action.attach.
import {
  type CardDefinition,
  CardType,
  Color,
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  type EntityId,
  type GameEvent,
  type KeywordAst,
  type PaperCard,
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

/** Build the Germ token's PaperCard. 0/0 black creature — Germ subtype. */
const buildGermPaperCard = (): PaperCard => {
  const NO_SUPERTYPES: readonly Supertype[] = [];
  const types = new TypeLine(NO_SUPERTYPES, [CardType.Creature], ["Germ"]);
  const definition: CardDefinition = {
    name: "Germ Token",
    oracle: "",
    types,
    manaCost: null,
    pt: { power: "0", toughness: "0" },
    colors: ColorSet.of(Color.Black),
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  };
  return {
    name: "Germ Token",
    edition: "TOK",
    collectorNumber: "0",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition,
  };
};

export class LivingWeaponKeywordHandler extends KeywordHandler {
  static override readonly keyword = "living_weapon" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("living_weapon");

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
          const paper = buildGermPaperCard();
          const ids = (yield* g.action.createToken({
            paperCard: paper,
            controller: controllerSeat,
            count: 1,
          })) as readonly EntityId[];
          const germId = ids[0];
          if (germId === undefined) return;
          yield* g.action.attach(sourceCardId, germId, "static");
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(ta as unknown as TriggeredAbility);
    game.triggerRegistry.register(ta as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("living_weapon");
  }
}

keywordHandlerRegistry.register(LivingWeaponKeywordHandler);
