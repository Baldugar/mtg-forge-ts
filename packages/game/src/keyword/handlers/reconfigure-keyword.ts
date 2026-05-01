// SPDX-License-Identifier: GPL-3.0-or-later
// ReconfigureKeywordHandler — processes K:Reconfigure:<cost> keyword
// lines (Kamigawa: Neon Dynasty, CR 702.150) and synthesizes a
// battlefield-zone, sorcery-speed activated SpellAbility that toggles
// the source between attached-equipment and unattached-creature states.
//
// CR 702.150a — "Reconfigure [cost]" — "[cost]: Attach to target creature
// you control; or unattach from a creature. Reconfigure only as a
// sorcery. While attached, this isn't a creature."
//
// MVP scope:
//   1. Adds "reconfigure" to card.keywords.
//   2. Synthesizes a Battlefield-zone, sorcery-speed SpellAbility with
//      cost `<cost>` and handlerKey "Reconfigure". The Layer 4
//      "while attached, this isn't a creature" override is closed by
//      Wave 113 in base-characteristics.ts: when the card carries the
//      reconfigure keyword AND attachedTo !== null, base derivation
//      strips CardType.Creature from the type set.
import type { KeywordAst, ParamValue, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class ReconfigureKeywordHandler extends KeywordHandler {
  static override readonly keyword = "reconfigure" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("reconfigure");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const reconfigureCost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.reconfigureCost = reconfigureCost;

    const fakeAst = {
      kind: "activated" as const,
      effect: { handlerKey: "Reconfigure", params: {} },
      cost: { raw: reconfigureCost },
      rulesText: `Reconfigure ${reconfigureCost} — Attach to target creature you control; or unattach. Sorcery only.`,
    };

    const def = card.paperCard.definition;
    const svars = (def?.svars as ReadonlyMap<string, SVarAst>) ?? new Map<string, SVarAst>();
    const sa = new SpellAbility(
      fakeAst,
      ctx.sourceCardId,
      ctx.controllerSeat,
      svars,
      [],
      undefined,
      new Set([ZoneType.Battlefield]),
      new Set(["reconfigure", "sorcery_speed"]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("reconfigure");
    card.reconfigureCost = undefined;
  }
}

keywordHandlerRegistry.register(ReconfigureKeywordHandler);
