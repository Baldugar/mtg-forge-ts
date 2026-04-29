// SPDX-License-Identifier: GPL-3.0-or-later
// ForMirrodinKeywordHandler — processes K:For Mirrodin keyword lines
// (Mirrodin Besieged, CR 702.158 / Phyrexia: All Will Be One reprint
// 702.171.X) and synthesizes an ETB triggered ability that creates a
// 2/2 red Rebel creature token and attaches the source equipment
// to it.
//
// CR 702.158a — "For Mirrodin!" — "When this Equipment enters the
// battlefield, create a 2/2 red Rebel creature token, then attach this
// Equipment to it."
//
// Wave 62.A — closes the Wave 59 token-creation TODO. The handler now:
//   1. Adds "for_mirrodin" to card.keywords + stamps card.forMirrodin.
//   2. CardChangedZone(self → Battlefield) trigger: spawns a 2/2 red
//      Rebel token via game.action.createToken (using a hand-rolled
//      Rebel PaperCard mirroring LivingWeapon's Germ pattern), then
//      attaches the source Equipment to the new token via
//      game.action.attach. Multi-ETB (blink loop) spawns a fresh Rebel
//      each time and reattaches.
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

/**
 * Build the Rebel token's PaperCard. 2/2 red creature — Rebel subtype.
 * Mirrors the inline pattern in LivingWeaponKeywordHandler (Germ) and
 * MobilizeKeywordHandler (Warrior). The Rebel token is also registered
 * in the cards-package tokenDatabase as `r_2_2_rebel` for parity with
 * TokenScript$ paths.
 */
const buildRebelPaperCard = (): PaperCard => {
  const NO_SUPERTYPES: readonly Supertype[] = [];
  const types = new TypeLine(NO_SUPERTYPES, [CardType.Creature], ["Rebel"]);
  const definition: CardDefinition = {
    name: "Rebel Token",
    oracle: "",
    types,
    manaCost: null,
    pt: { power: "2", toughness: "2" },
    colors: ColorSet.of(Color.Red),
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  };
  return {
    name: "Rebel Token",
    edition: "TOK",
    collectorNumber: "0",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition,
  };
};

export class ForMirrodinKeywordHandler extends KeywordHandler {
  static override readonly keyword = "for_mirrodin" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("for_mirrodin");
    card.forMirrodin = true;

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
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          // Re-read the controller fresh — blink loops may have brought
          // the Equipment back under a different controller. The
          // controllerSeat captured at activation time is the registration
          // controller; the live `card.controllerSeat` is authoritative
          // for the new token's owner / controller.
          const liveController = self.controllerSeat;
          const paper = buildRebelPaperCard();
          const ids = (yield* g.action.createToken({
            paperCard: paper,
            controller: liveController,
            count: 1,
          })) as readonly EntityId[];
          const rebelId = ids[0];
          if (rebelId === undefined) return;
          yield* g.action.attach(sourceCardId, rebelId, "static");
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
    card.keywords?.delete("for_mirrodin");
    card.forMirrodin = undefined;
  }
}

keywordHandlerRegistry.register(ForMirrodinKeywordHandler);
