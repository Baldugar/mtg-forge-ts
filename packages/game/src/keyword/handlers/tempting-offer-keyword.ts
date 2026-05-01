// SPDX-License-Identifier: GPL-3.0-or-later
// TemptingOfferKeywordHandler — processes K:TemptingOffer keyword lines
// (Commander 2014, the "Offerings" cycle pattern).
//
// Tempting Offer is, in Forge data, encoded as a trigger Mode (e.g.
// `Mode$ TemptingOffer` on the trigger line) rather than a K:- line —
// the trigger fires once and yields a per-opponent confirm loop where
// each opponent may copy the resolution. Wave 39's keyword handler
// claimed a stable id (`tempting_offer`) so the canonical form has a
// hook even before the trigger Mode lands; in Forge data the K:- form
// is rare but where present it is honoured here.
//
// Wave 94 — closes the per-opponent confirm-loop TODO. The handler
// now synthesizes a self-resolving ability that, on activation:
//   1. Iterates non-controller seats in turn order.
//   2. Yields a confirmAction to each opponent ("copy this offering?").
//   3. Counts confirmations into `card.temptingOfferAcceptedCount` so
//      downstream `Count$TemptingOfferAccepted` SVar reads pick it up.
//   4. Optionally re-resolves a sub-SVar `TemptingOfferCopy` (kind
//      "ability") once per accepting opponent — mirrors the C14 cycle
//      where "for each opponent who accepts, copy the resolution".
//
// The activation is exposed via `runOffer(game, sourceCardId,
// controllerSeat)` so the cast pipeline / trigger Mode handler can
// invoke it once the parent ability resolves. Wave 94 keeps the keyword
// stamp + the static `runOffer` helper as the durable contract.
import type { AbilityAst, EntityId, KeywordAst, PlayerSeat, SVarAst } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import type { Game } from "../../game.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class TemptingOfferKeywordHandler extends KeywordHandler {
  static override readonly keyword = "tempting_offer" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("tempting_offer");
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("tempting_offer");
  }

  /**
   * Wave 94 — drive the per-opponent confirm loop. Iterates non-
   * controller seats in turn order, yields a confirmAction to each,
   * and stamps `temptingOfferAcceptedCount`. If the source carries a
   * `TemptingOfferCopy` SVar (kind="ability"), yields* its resolver
   * once per accepting opponent — mirrors the printed copy-on-accept
   * pattern from the C14 Offerings cycle.
   */
  static *runOffer(
    game: Game,
    sourceCardId: EntityId,
    controllerSeat: PlayerSeat,
  ): Generator<unknown, number, unknown> {
    const card = game.cards.get(sourceCardId);
    if (!card) return 0;

    // Enumerate opponent seats in turn order (game.players is seat-
    // indexed; we filter out the controller). Order matches the
    // priority-passing order used by the cast pipeline elsewhere.
    const oppSeats: PlayerSeat[] = [];
    for (const p of game.players) {
      if (p.seat !== controllerSeat) oppSeats.push(p.seat);
    }

    let accepted = 0;
    for (const oppSeat of oppSeats) {
      const response = (yield {
        kind: "decision",
        request: {
          kind: "confirmAction",
          sourceId: sourceCardId,
          playerSeat: oppSeat,
          prompt: "Copy this offering?",
        },
      }) as { readonly kind?: string; readonly confirmed?: boolean } | undefined;
      if (response?.kind === "confirmAction" && response.confirmed === true) {
        accepted++;
      }
    }
    card.temptingOfferAcceptedCount = accepted;

    // If the source has a TemptingOfferCopy SVar of kind="ability", run
    // it once per accepting opponent. Mirrors RepeatEachEffect's pattern.
    if (accepted > 0) {
      const svars =
        (card.paperCard.definition?.svars as ReadonlyMap<string, SVarAst> | undefined) ?? new Map();
      const sv = svars.get("TemptingOfferCopy");
      if (sv && sv.kind === "ability" && sv.ability) {
        const fakeAst: AbilityAst = {
          kind: "spell",
          effect: sv.ability,
          cost: { raw: "" },
        };
        for (let i = 0; i < accepted; i++) {
          // Default targets = [source] so sub-abilities written as
          // `Defined$ Self` (via sa.targets) resolve cleanly.
          const subSa = new SpellAbility(fakeAst, sourceCardId, controllerSeat, svars, [
            sourceCardId,
          ] as readonly EntityId[]);
          yield* subSa.makeResolver().resolve(game);
        }
      }
    }

    return accepted;
  }
}

keywordHandlerRegistry.register(TemptingOfferKeywordHandler);
