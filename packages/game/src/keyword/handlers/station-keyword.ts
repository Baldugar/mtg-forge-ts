// SPDX-License-Identifier: GPL-3.0-or-later
// StationKeywordHandler — processes K:Station:N keyword lines (Aetherdrift /
// Spaceship: The Final Frontier; CR 718) and synthesizes a battlefield-zone
// activated SpellAbility on the Spacecraft.
//
// Station N: "Tap any number of untapped creatures you control with combined
// power N or greater: This Spacecraft becomes a creature with various
// counters/effects until end of turn." MVP mirrors Crew exactly — the
// stationed flag turns the Spacecraft into a creature via Layer 4 type-flip
// (deriveBaseCharacteristics), and we emit a CardStationed event so the
// Stationed trigger handler (Wave 22) fires.
//
// The keyword line takes the form `K:Station:N` where N is the power
// threshold; the parser stores it on KeywordAst.params.amount (see
// keyword-line.ts — "station" is in AMOUNT_KEYWORDS).
import type { KeywordAst, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class StationKeywordHandler extends KeywordHandler {
  static override readonly keyword = "station" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("station");

    // Power threshold from K:Station:N. Falls back to "1" if the param slot
    // is missing (defensive; the parser should always provide it).
    const amountParam = ast.params?.amount;
    const stationPowerRaw = amountParam && amountParam.kind === "literal" ? (amountParam.raw as string) : "1";

    const fakeAst = {
      kind: "activated" as const,
      effect: {
        handlerKey: "Station",
        params: {
          StationPower: { kind: "literal" as const, raw: stationPowerRaw },
        },
      },
      cost: { raw: "" },
      rulesText: `Station ${stationPowerRaw} — tap any number of untapped creatures you control with combined power ${stationPowerRaw} or greater. This Spacecraft becomes a creature until end of turn.`,
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
      new Set(["station"]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("station");
  }
}

keywordHandlerRegistry.register(StationKeywordHandler);
