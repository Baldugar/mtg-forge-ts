// SPDX-License-Identifier: GPL-3.0-or-later
// Freerunning — alternative casting cost from the hand if a player was
// dealt combat damage by one of your creatures this turn (Outlaws of
// Thunder Junction, CR 702.179). Registered as both a KeywordHandler and
// as an AltCost.
//
// CR 702.179a — "Freerunning [cost]" — "You may cast this spell for its
// freerunning cost if an opponent was dealt combat damage by a Rogue,
// Assassin, Pirate, Mercenary, or Ninja you control this turn."
// Wave 113 closes the printed-creature-type narrowing: instead of
// allowing freerunning whenever ANY of your creatures dealt combat
// damage to a player, we walk `combatDamageSourcesThisTurn[seat]` and
// require at least one source whose printed subtypes intersect the
// allowed type set.
import type { EntityId, KeywordAst, ParamValue } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { SpellAbility } from "../../ability/spell-ability.js";
import type { Card } from "../../card.js";
import type { CastContext } from "../../cast/cast-context.js";
import type { Game } from "../../game.js";
import { altCostRegistry } from "../../registries/alt-cost-registry.js";
import type { AltCost } from "../../registries/alt-cost-registry.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

const extractFreerunningCost = (card: Card): string | null => {
  const def = card.paperCard.definition;
  if (!def) return null;
  const keywords = def.keywords as readonly KeywordAst[] | undefined;
  if (!keywords) return null;
  const kw = keywords.find((k) => k.keyword === "freerunning");
  if (!kw) return null;
  const costParam = kw.params?.cost as ParamValue | undefined;
  if (!costParam || costParam.kind !== "literal") return null;
  return (costParam.raw as string) || "0";
};

// Wave 113 — CR 702.179a's allowed-creature-type list. Stored as a Set
// for O(1) membership; matched case-sensitively against the printed
// subtype string set on PaperCard.definition (Forge stores subtypes in
// Title-Case canonical form). Adding a printed type here is the only
// extension point if the corpus ever broadens.
const FREERUNNING_TYPES: ReadonlySet<string> = new Set(["Rogue", "Assassin", "Pirate", "Mercenary", "Ninja"]);

const sourceMatchesFreerunningType = (sourceId: EntityId, game: Game): boolean => {
  const c = game.cards.get(sourceId);
  if (!c) return false;
  // Read the printed subtype set off the PaperCard definition. The
  // source may have left the battlefield by the time freerunning is
  // checked (a Rogue that dealt combat damage and was destroyed still
  // counts per CR 702.179a — the qualifier is "this turn", not
  // "currently controlled"). The printed types are the durable read.
  const def = c.paperCard.definition;
  const subtypes = def?.types?.subtypes;
  if (!subtypes) return false;
  for (const t of subtypes) {
    if (FREERUNNING_TYPES.has(t)) return true;
  }
  return false;
};

const controllerDealtCombatDamage = (card: Card, game: Game): boolean => {
  // Wave 113 — narrow the gate: at least one source in
  // combatDamageSourcesThisTurn[controllerSeat] must have a printed
  // creature subtype in FREERUNNING_TYPES. An empty set / no matches
  // returns false. The pre-Wave-113 fast-path "any damage" check is
  // dropped because the new requirement is strictly narrower.
  const sources = game.flags.combatDamageSourcesThisTurn.get(card.controllerSeat);
  if (!sources || sources.size === 0) return false;
  for (const id of sources) {
    if (sourceMatchesFreerunningType(id, game)) return true;
  }
  return false;
};

export class FreerunningKeywordHandler extends KeywordHandler {
  static override readonly keyword = "freerunning" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("freerunning");
    const costParam = ast.params?.cost as ParamValue | undefined;
    const cost = costParam && costParam.kind === "literal" ? (costParam.raw as string) : "0";
    card.freerunningCost = cost;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("freerunning");
    card.freerunningCost = undefined;
  }
}

export const Freerunning: AltCost = {
  handlerKey: "Freerunning",
  isAvailable(card: Card, game: Game): boolean {
    if (card.zone !== ZoneType.Hand) return false;
    if (extractFreerunningCost(card) === null) return false;
    return controllerDealtCombatDamage(card, game);
  },
  modifyCastContext(ctx: CastContext, _sa: SpellAbility, game: Game): void {
    const card = game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const cost = extractFreerunningCost(card);
    if (cost === null) return;
    (ctx as { altCostUsed: string | null }).altCostUsed = "Freerunning";
    (ctx as { totalCost: unknown }).totalCost = { base: { raw: cost } };
  },
};

altCostRegistry.register(Freerunning);
keywordHandlerRegistry.register(FreerunningKeywordHandler);
