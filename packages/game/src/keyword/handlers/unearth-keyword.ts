// SPDX-License-Identifier: GPL-3.0-or-later
// Unearth — alternative casting cost from the graveyard granting haste
// until end of turn, then exiling at the beginning of the next end step
// (Future Sight, CR 702.83). Registered as both a KeywordHandler (so the
// keyword stamp is observable) and as an AltCost (so the cast pipeline's
// stepChooseAltCosts surface picks it up).
//
// CR 702.83a — "Unearth [cost]" — "[cost]: Return this card from your
// graveyard to the battlefield. It gains haste. Exile it at the beginning
// of the next end step or if it would leave the battlefield. Activate
// only as a sorcery."
//
// Wave 93 — closes the haste-UEoT + EoT-exile delayed-trigger TODO. The
// handler now:
//   1. Adds "unearth" to card.keywords + stamps card.unearthCost.
//   2. Registers an ETB trigger that, when fired and the source has
//      unearthCast === true, registers a Layer 6 kw-grant for "Haste"
//      with duration untilEndOfTurn AND adds a one-shot delayed
//      trigger on StepStarted(End) that exiles the source at the next
//      end step. Mirrors EncoreEffect's EoT-cleanup pattern.
import {
  type ContinuousEffect,
  type EntityId,
  type GameEvent,
  type KeywordAst,
  Layer,
  type ParamValue,
  type TriggeredAbility,
  ZoneType,
} from "@mtg-forge-ts/core";
import type { SpellAbility } from "../../ability/spell-ability.js";
import type { Card } from "../../card.js";
import type { CastContext } from "../../cast/cast-context.js";
import type { Game } from "../../game.js";
import type { Layer6KeywordGrant } from "../../layers/keyword-layer.js";
import { altCostRegistry } from "../../registries/alt-cost-registry.js";
import type { AltCost } from "../../registries/alt-cost-registry.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

const extractUnearthCost = (card: Card): string | null => {
  const def = card.paperCard.definition;
  if (!def) return null;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return null;
  const kw = keywords.find((k) => k.keyword === "unearth");
  if (!kw) return null;
  const costParam = kw.params?.cost as ParamValue | undefined;
  if (!costParam || costParam.kind !== "literal") return null;
  return (costParam.raw as string) || "0";
};

export class UnearthKeywordHandler extends KeywordHandler {
  static override readonly keyword = "unearth" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("unearth");
    const costParam = ast.params?.cost as ParamValue | undefined;
    const cost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.unearthCost = cost;

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
          // CR 702.83a — haste UEoT + EoT-exile only fire when the
          // source was Unearth-cast. The cast-from-hand path should
          // ETB normally without any of these grants.
          if (self.unearthCast !== true) return;

          // Layer 6 keyword grant — Haste UEoT (CR 702.83a).
          const ts = g.newEntityId();
          const grant: Layer6KeywordGrant = {
            keyword: "Haste",
            sourceAbilityId: sourceCardId,
            timestamp: ts,
            targetCardIdFn: () => sourceCardId,
          };
          const ce: ContinuousEffect = {
            id: g.newEntityId(),
            sourceCardId,
            timestamp: ts,
            layer: Layer.L6_Ability,
            duration: { kind: "untilEndOfTurn" },
            payload: { kind: "kw-grant", effect: grant },
          };
          g.continuousEffectRegistry.register(ce);

          // Delayed trigger — at the beginning of the next end step,
          // exile self (CR 702.83a).
          const dtId = g.newEntityId();
          g.delayedTriggerQueue.add({
            id: dtId,
            kind: "triggered",
            sourceCardId,
            activeInZones: new Set([
              ZoneType.Battlefield,
              ZoneType.Stack,
              ZoneType.Graveyard,
              ZoneType.Exile,
            ]),
            timestamp: 0,
            controllerSeatAtReg: controllerSeat,
            isDelayed: true,
            createdAtTurn: g.turn,
            creationContext: {},
            oneShot: true,
            matches(event) {
              if (event.kind !== "StepStarted") return false;
              const p = (event as unknown as { payload?: { step?: string } }).payload;
              // CR 702.83a — "at the beginning of the next end step".
              // Match canonical PhaseStep enum string ("EndStep") plus
              // the legacy "End" alias used by delayed-trigger.ts so
              // both routes fire correctly.
              if (p?.step !== "EndStep" && p?.step !== "End") return false;
              const t = g.cards.get(sourceCardId);
              // Per CR 702.83a — "Exile it at the beginning of the next
              // end step or if it would leave the battlefield." The
              // leaves-the-battlefield branch is wired separately by a
              // replacement (Wave 22 / pending). Here we exile when the
              // source is still on the battlefield at the end step.
              if (!t || t.zone !== ZoneType.Battlefield) return true;
              const gen = g.action.exile(sourceCardId, { sourceId: sourceCardId });
              let r = gen.next();
              while (!r.done) r = gen.next();
              return true;
            },
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
    if (!card) return;
    card.keywords?.delete("unearth");
    card.unearthCost = undefined;
    card.unearthCast = undefined;
  }
}

export const Unearth: AltCost = {
  handlerKey: "Unearth",
  isAvailable(card: Card, _game: Game): boolean {
    if (card.zone !== ZoneType.Graveyard) return false;
    return extractUnearthCost(card) !== null;
  },
  modifyCastContext(ctx: CastContext, _sa: SpellAbility, game: Game): void {
    const card = game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const cost = extractUnearthCost(card);
    if (cost === null) return;
    (ctx as { altCostUsed: string | null }).altCostUsed = "Unearth";
    (ctx as { totalCost: unknown }).totalCost = { base: { raw: cost } };
    (ctx as { alternativeZoneDestination: ZoneType | undefined }).alternativeZoneDestination =
      ZoneType.Battlefield;
    card.unearthCast = true;
  },
};

altCostRegistry.register(Unearth);
keywordHandlerRegistry.register(UnearthKeywordHandler);
