// SPDX-License-Identifier: GPL-3.0-or-later
// EquipKeywordHandler — processes K:Equip:<cost> keyword lines (CR 702.6)
// and synthesizes a Battlefield-zone, sorcery-speed activated SpellAbility
// that attaches the source Equipment to a creature its controller controls.
//
// CR 702.6a — "Equip [cost]" — "[cost]: Attach this Equipment to target
// creature you control. Activate this ability only any time you could cast
// a sorcery."
//
// DSL form:
//   K:Equip:2          → cost = "2"
//   K:Equip:G          → cost = "G"
//
// MVP scope:
//   1. Adds "equip" to card.keywords.
//   2. Synthesizes a Battlefield-zone, sorcery-speed SpellAbility with
//      cost `<cost>` and handlerKey "Attach". ValidTgts$ Creature.YouCtrl
//      is published on the effect params so activateAbility's target
//      selection emits a chooseCastTargets decision before paying the
//      cost. The AttachEffect resolver consumes sa.targets[0] and calls
//      game.action.attach.
import type { KeywordAst, ParamValue, SVarAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

export class EquipKeywordHandler extends KeywordHandler {
  static override readonly keyword = "equip" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("equip");

    const costParam = ast.params?.cost as ParamValue | undefined;
    const equipCost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";

    const fakeAst = {
      kind: "activated" as const,
      effect: {
        handlerKey: "Attach",
        params: {
          ValidTgts: { kind: "literal" as const, raw: "Creature.YouCtrl" },
          TgtPrompt: { kind: "literal" as const, raw: "Select target creature you control" },
        },
      },
      cost: { raw: equipCost },
      rulesText: `Equip ${equipCost} — ${equipCost}: Attach this Equipment to target creature you control. Activate only as a sorcery.`,
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
      new Set(["equip", "sorcery_speed"]),
    );

    card.spellAbilities.push(sa);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("equip");
  }
}

keywordHandlerRegistry.register(EquipKeywordHandler);
