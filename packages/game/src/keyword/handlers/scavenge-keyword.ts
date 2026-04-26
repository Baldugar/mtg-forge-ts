// SPDX-License-Identifier: GPL-3.0-or-later
// ScavengeKeywordHandler — processes K:Scavenge:<cost> keyword lines
// (Return to Ravnica, CR 702.95) and synthesizes a sorcery-speed
// Graveyard-zone activated SpellAbility on the card.
//
// CR 702.95a — "Scavenge [cost] — [cost], Exile this card from your
// graveyard: Put a number of +1/+1 counters equal to this card's
// power on target creature. Activate only as a sorcery."
//
// DSL form:
//   K:Scavenge:1 G G       → cost = "1 G G"
//
// MVP scope:
//   1. Adds "scavenge" to card.keywords.
//   2. Synthesizes a Graveyard-zone activated, sorcery-speed
//      SpellAbility with cost `<cost>, ExileFromGrave<1/CARDNAME>` and
//      handlerKey "Scavenge". The ScavengeEffect resolver picks any
//      battlefield Creature via chooseCard and stamps P1P1 counters
//      equal to the source's printed power.
import type { KeywordAst, ParamValue, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class ScavengeKeywordHandler extends KeywordHandler {
  static override readonly keyword = "scavenge" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("scavenge");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const scavengeMana = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";

    const fakeAst = {
      kind: "activated" as const,
      effect: { handlerKey: "Scavenge", params: {} },
      cost: { raw: `${scavengeMana}, ExileFromGrave<1/CARDNAME>` },
      rulesText: `Scavenge ${scavengeMana} — exile this card from your graveyard: Put a number of +1/+1 counters equal to this card's power on target creature. Activate only as a sorcery.`,
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
      new Set([ZoneType.Graveyard]),
      new Set(["scavenge", "sorcery_speed"]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("scavenge");
  }
}

keywordHandlerRegistry.register(ScavengeKeywordHandler);
