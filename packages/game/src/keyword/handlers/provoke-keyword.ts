// SPDX-License-Identifier: GPL-3.0-or-later
// ProvokeKeywordHandler — processes K:Provoke keyword lines (Onslaught,
// CR 702.39) and synthesizes a battlefield-zone TriggeredAbility that
// fires when the source attacks.
//
// CR 702.39a — "Provoke" — "Whenever this creature attacks, you may
// have target creature defending player controls untap and block it if
// able."
//
// DSL form:
//   K:Provoke      (no parameters)
//
// MVP scope:
//   1. Adds "provoke" to card.keywords.
//   2. Synthesizes one TriggeredAbility watching `AttackersDeclared` for
//      self in attacker batch. Resolver enumerates creatures controlled
//      by the defending player, MVP-auto-picks the first eligible (or
//      bails if none), untaps it, and stamps `card.mustBlockTargetId =
//      sourceCardId` so combat's block-legality layer enforces the
//      "must block this attacker if able" leg.
//
// Notes:
//   - The chosen creature is auto-selected in MVP. The full chooseCard
//     decision lands once the decision schema for provoke is registered;
//     the resolver shape already mirrors mentor / renown.
//   - Defending-player resolution uses `attackerData.defendingSeat`
//     captured at attacker-declaration time. If the engine's combat
//     layer doesn't yet expose per-attacker defender, the MVP falls
//     back to "any creature controlled by an opponent of the attacker".
import type { EntityId, GameEvent, KeywordAst, TriggeredAbility } from "@mtg-forge-ts/core";
import { CardType, ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class ProvokeKeywordHandler extends KeywordHandler {
  static override readonly keyword = "provoke" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("provoke");

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
        if (event.kind !== "AttackersDeclared") return false;
        const p = event.payload as {
          readonly attackers?: readonly { readonly attackerId: EntityId }[];
        };
        return p.attackers?.some((a) => a.attackerId === sourceCardId) ?? false;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          if (self.zone !== ZoneType.Battlefield) return;

          // Enumerate creatures controlled by an opponent of the attacker
          // (the defending player's set). MVP fallback: any opponent-
          // controlled creature on the battlefield.
          const eligible: EntityId[] = [];
          for (const [id, c] of g.cards) {
            if (id === sourceCardId) continue;
            if (c.zone !== ZoneType.Battlefield) continue;
            if (c.controllerSeat === controllerSeat) continue;
            const chars = g.layerEngine.computeCharacteristics(id);
            if (!chars.types.has(CardType.Creature)) continue;
            eligible.push(id);
          }
          if (eligible.length === 0) return;

          // Wave 61.D — Provoke is a "you may" trigger (CR 702.39a). Ask
          // the source-controller first whether they want to provoke at
          // all. If yes, yield chooseCard so they pick which opponent's
          // creature to provoke. Falls back to the first eligible on
          // invalid pick.
          const optDec = yield {
            kind: "decision",
            request: {
              kind: "confirmAction",
              sourceId: sourceCardId,
              prompt: "Provoke — choose target creature to untap and force-block?",
            },
          };
          const optResp = optDec as { kind: string; confirmed?: boolean } | undefined;
          if (!optResp || optResp.kind !== "confirmAction" || optResp.confirmed !== true) return;

          const pickDec = yield {
            kind: "decision",
            request: {
              kind: "chooseCard",
              playerSeat: controllerSeat,
              pool: eligible,
              restriction: { keyword: "provoke" },
              min: 1,
              max: 1,
            },
          };
          const r = pickDec as { kind: string; chosen?: readonly EntityId[] } | undefined;
          let target: EntityId | undefined;
          if (r && r.kind === "chooseCard" && r.chosen && r.chosen.length === 1) {
            const picked = r.chosen[0];
            if (picked !== undefined && eligible.includes(picked)) target = picked;
          }
          if (target === undefined) target = eligible[0];
          if (target === undefined) return;

          // Untap the chosen creature.
          yield* g.action.untap(target);

          // Stamp must-block: the chosen creature must block the
          // attacker (sourceCardId) if able. The combat layer's
          // block-legality check consults `card.mustBlockTargetId`.
          const targetCard = g.cards.get(target);
          if (targetCard) {
            (targetCard as unknown as { mustBlockTargetId: EntityId | null }).mustBlockTargetId =
              sourceCardId;
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
    card?.keywords?.delete("provoke");
  }
}

keywordHandlerRegistry.register(ProvokeKeywordHandler);
