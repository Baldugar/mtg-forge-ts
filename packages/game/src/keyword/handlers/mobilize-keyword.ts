// SPDX-License-Identifier: GPL-3.0-or-later
// MobilizeKeywordHandler — processes K:Mobilize:N keyword lines (Tarkir:
// Dragonstorm, CR 702.176) and synthesizes an attacks-trigger that
// creates N tapped-and-attacking 1/1 red Warrior creature tokens.
//
// CR 702.176a — "Mobilize N" — "Whenever this creature attacks, create
// N tapped and attacking 1/1 red Warrior creature tokens. Sacrifice
// them at the beginning of the next end step."
//
// MVP scope:
//   1. Adds "mobilize" to card.keywords.
//   2. Stamps `card.mobilizeAmount = N`.
//   3. Attacks trigger fires when self is in the AttackersDeclared
//      batch. The token-creation + EoT-sac wiring is documented under
//      TODO(advanced) — we don't have the Warrior token PaperCard
//      bound to a static id here. The trigger registration captures
//      the durable contract.
import type {
  EntityId,
  GameEvent,
  KeywordAst,
  ParamValue,
  PlayerSeat,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

type AttackersDeclaredPayload = {
  readonly attackingSeat: PlayerSeat;
  readonly attackers?: readonly { readonly attackerId: EntityId }[];
};

export class MobilizeKeywordHandler extends KeywordHandler {
  static override readonly keyword = "mobilize" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("mobilize");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const rawN =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 1;
    const n = Number.isFinite(rawN) && rawN > 0 ? rawN : 1;
    card.mobilizeAmount = n;

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
        const p = event.payload as AttackersDeclaredPayload;
        return p.attackers?.some((a) => a.attackerId === sourceCardId) ?? false;
      },

      resolver: {
        // biome-ignore lint/correctness/useYield: MVP no-op until token PaperCard registry lands
        *resolve(): Generator<unknown, void, unknown> {
          // TODO(advanced) — createToken(N, Warrior 1/1) tapped + attacking
          // and register an EoT sacrifice delayed trigger.
          return;
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
    card.keywords?.delete("mobilize");
    card.mobilizeAmount = undefined;
  }
}

keywordHandlerRegistry.register(MobilizeKeywordHandler);
