// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 51 — source-card probe selectors. Each reads a single piece of
// state from the SVar context's source card (or first target where Forge
// uses target-aware probes). Backs ~50 cards in the corpus that compute
// effect amounts off the source's own characteristics.
//
// Forms registered:
//   Count$CardPower               : layered power
//   Count$CardToughness           : layered toughness
//   Count$CardSumPT               : power + toughness
//   Count$CardBasePower           : base printed power BEFORE layers
//   Count$CardNumColors           : number of distinct colors (layered)
//   Count$CardCounters.<Type>     : counters of type <Type> on source
//   Count$CrewSize                : number of creatures crewing the
//                                   source vehicle (length of `crewedBy`
//                                   if present; 0 otherwise. Wave 98 —
//                                   CrewEffect maintains the slot.
//
// Each selector reads `ctx.sourceCardId` (or `ctx.targets[0]` for the
// PT/colors variants when targets are present, mirroring NumColors). Cards
// missing the slot read 0.
import type { EntityId, SVarExpressionAst } from "@mtg-forge-ts/core";
import { parseCounterTypeToken } from "../../cost/parts/cost-put-counter.js";
import type { SvarContext } from "../context.js";
import { countArgRegistry } from "./count.js";

const resolveCardId = (ctx: SvarContext): EntityId | undefined => {
  if (ctx.targets && ctx.targets.length > 0) return ctx.targets[0];
  return ctx.sourceCardId;
};

const computeCardPower = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  const id = resolveCardId(ctx);
  if (id === undefined) return 0;
  if (!ctx.game.cards.has(id)) return 0;
  const chars = ctx.game.layerEngine.computeCharacteristics(id);
  return chars.power ?? 0;
};

const computeCardToughness = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  const id = resolveCardId(ctx);
  if (id === undefined) return 0;
  if (!ctx.game.cards.has(id)) return 0;
  const chars = ctx.game.layerEngine.computeCharacteristics(id);
  return chars.toughness ?? 0;
};

const computeCardSumPT = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  const id = resolveCardId(ctx);
  if (id === undefined) return 0;
  if (!ctx.game.cards.has(id)) return 0;
  const chars = ctx.game.layerEngine.computeCharacteristics(id);
  return (chars.power ?? 0) + (chars.toughness ?? 0);
};

const computeCardNumColors = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  const id = resolveCardId(ctx);
  if (id === undefined) return 0;
  if (!ctx.game.cards.has(id)) return 0;
  const chars = ctx.game.layerEngine.computeCharacteristics(id);
  return chars.colors.size;
};

const computeCardBasePower = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  const id = resolveCardId(ctx);
  if (id === undefined) return 0;
  const card = ctx.game.cards.get(id);
  if (!card) return 0;
  // Base printed power lives on the CardDefinition's `pt` slot (string-
  // valued — Forge writes "0", "X", "*"). Cards without a definition or
  // without `pt` (non-creature, planeswalker etc.) → 0. Non-numeric ('X',
  // '*', null) collapse to 0 conservatively; downstream cards that care
  // about CDA power should use the layered `CardPower` form.
  const def = card.paperCard.definition;
  if (!def) return 0;
  const pt = (def as unknown as { pt?: { power?: string | null; toughness?: string | null } }).pt;
  if (!pt || pt.power === undefined || pt.power === null) return 0;
  const n = Number.parseInt(pt.power, 10);
  return Number.isFinite(n) ? n : 0;
};

// Count$CardCounters.<Type> — read the source card's counter map for the
// requested CounterType. Forge spells the type in PascalCase (P1P1, M1M1,
// Charge, Loyalty, Defense, etc.); the slot's keys are CounterType enum
// members which use the same string identity.
const computeCardCounters = (ast: SVarExpressionAst, ctx: SvarContext): number => {
  const raw = ast.args?.[0]?.raw ?? "";
  const dot = raw.indexOf(".");
  if (dot < 0) return 0;
  const typeName = raw.slice(dot + 1);
  if (typeName.length === 0) return 0;
  const id = ctx.sourceCardId;
  if (id === undefined) return 0;
  const card = ctx.game.cards.get(id);
  if (!card) return 0;
  // Forge writes counter type tokens in uppercase shorthand (P1P1, M1M1,
  // LOYALTY, CHARGE) — route through the canonical token parser so the
  // CounterType enum identity is consistent with the cost system.
  const ct = parseCounterTypeToken(typeName);
  if (ct === undefined) return 0;
  return card.counters.get(ct) ?? 0;
};

// Count$CrewSize — number of creatures currently crewing the source
// vehicle. Wave 98 — CrewEffect now maintains the canonical `crewedBy`
// readonly array slot on Card; this selector reads it directly. The
// legacy `crewSize` numeric probe remains as a fallback so any
// pre-existing test fixture or AI pump that stamps the count without
// going through CrewEffect (no Forge card prints this shape, but the
// engine APIs allow it for headless replays) still resolves cleanly.
// Returns 0 when no crew is currently active (vehicle uncrewed or off
// battlefield). Cleared at end of turn alongside crewedUntilEot.
const computeCrewSize = (_ast: SVarExpressionAst, ctx: SvarContext): number => {
  const id = ctx.sourceCardId;
  if (id === undefined) return 0;
  const card = ctx.game.cards.get(id);
  if (!card) return 0;
  if (Array.isArray(card.crewedBy)) return card.crewedBy.length;
  const probe = card as unknown as { crewSize?: number };
  if (typeof probe.crewSize === "number") return probe.crewSize;
  return 0;
};

countArgRegistry.register("CardPower", computeCardPower);
countArgRegistry.register("CardToughness", computeCardToughness);
countArgRegistry.register("CardSumPT", computeCardSumPT);
countArgRegistry.register("CardNumColors", computeCardNumColors);
countArgRegistry.register("CardBasePower", computeCardBasePower);
countArgRegistry.register("CardCounters", computeCardCounters);
countArgRegistry.register("CrewSize", computeCrewSize);
