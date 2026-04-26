// SPDX-License-Identifier: GPL-3.0-or-later
// PlotKeywordHandler — processes K:Plot:<cost> keyword lines and synthesizes
// a hand-zone activated SpellAbility on the card.
//
// CR 718.1 (Bloomburrow): "Plot [cost] — During your main phase any time you
// could cast a sorcery, you may pay [cost] and exile this card from your
// hand face up. You may cast it as a sorcery on a later turn without paying
// its mana cost."
//
// When K:Plot:1 R is parsed, the card definition carries:
//   { keyword: "plot", params: { cost: { kind: "literal", raw: "1 R" } } }
//
// This handler:
//   1. Adds "plot" to card.keywords (flag awareness for other systems).
//   2. Synthesizes an AbilityAst with:
//        - effect: { handlerKey: "Plot", params: {} }
//        - cost:   { raw: "<plot-cost>" }   (mana-only — the exile-self
//          step happens in the resolver, NOT as a discrete cost part)
//   3. Wraps it in a SpellAbility with activeInZones = {Hand} and
//      tags = {"plot", "sorcery-speed"}. The "sorcery-speed" tag is the
//      gate the priority orchestrator (or activate path) consults to
//      restrict activation to the controller's main phase with empty
//      stack. As of this wave the gate is a TODO in the activate-ability
//      path; tests bypass it by activating directly.
//   4. Pushes the SA onto card.spellAbilities so activateAbility can pick
//      it up at index `card.spellAbilities.length - 1` (or by inspecting
//      tags).
//
// Pairing:
//   - Cast-from-exile arm: see altcost/plot.ts (Plot AltCost). It checks
//     card.plotted === true AND game.turn !== card.plottedOnTurn (CR 718:
//     "on a later turn") and replaces the cast cost with "" (free cast).
//   - BecomesPlotted trigger (wave-18-triggers.ts) listens on the
//     CardPlotted event emitted by PlotEffect.
import type { KeywordAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class PlotKeywordHandler extends KeywordHandler {
  static override readonly keyword = "plot" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    // 1. Add to flag Set so hasKeyword("plot") works.
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("plot");

    // 2. Derive the plot mana cost (e.g. "1 R", "U", "0").
    const costParam = ast.params?.cost;
    const plotCostRaw = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";

    // 3. Build a synthetic AbilityAst for the plot activated ability.
    //    Cost: "<plotCost>" — mana only. The exile-self step is performed
    //    by PlotEffect.resolve (NOT by a discrete Exile cost part), to
    //    mirror Forge's plot special-action shape: pay → exile → stamp.
    //    Effect: handlerKey "Plot" — see effects/plot.ts.
    const fakeAst = {
      kind: "activated" as const,
      effect: {
        handlerKey: "Plot",
        params: {},
      },
      cost: { raw: plotCostRaw },
      rulesText: `Plot {${plotCostRaw}} — exile this card from your hand face up; cast it on a later turn without paying its mana cost.`,
    };

    // 4. Synthesize a SpellAbility active in Hand only, tagged as "plot"
    //    and "sorcery-speed". Tags are read by the priority orchestrator
    //    to gate activation timing (sorcery-speed: only during the
    //    controller's main phase with the stack empty — TODO: wire the
    //    gate into legal-action-enumerator + activateAbility once Plot
    //    needs to integrate with priority).
    const def = card.paperCard.definition;
    const svars =
      (def?.svars as ReadonlyMap<string, import("@mtg-forge-ts/core").SVarAst>) ??
      new Map<string, import("@mtg-forge-ts/core").SVarAst>();
    const sa = new SpellAbility(
      fakeAst,
      ctx.sourceCardId,
      ctx.controllerSeat,
      svars,
      [],
      undefined,
      new Set([ZoneType.Hand]),
      new Set(["plot", "sorcery-speed"]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("plot");
    // Note: synthesized SpellAbility stays on spellAbilities; cleanup in SP4.
    void ast; // unused but satisfies the override signature
  }
}

keywordHandlerRegistry.register(PlotKeywordHandler);
