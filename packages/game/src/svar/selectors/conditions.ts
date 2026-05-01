// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 51 — Conditional-ternary dispatcher for the Forge SVar form
// `Count$<Flag>.<elseValue>.<thenValue>`. When `<Flag>` evaluates true the
// selector returns `<thenValue>`, otherwise `<elseValue>`. Used by ~100+
// cards (Urza's Rage, Hellbent gainers, Metalcraft pumps, Delirium-/
// FatefulHour-tied modal payouts, etc.).
//
// The dispatcher is invoked by count.ts BEFORE its compound-arg fallback so
// flag names that would otherwise dispatch into the family registry (e.g.
// "Threshold" — which has no plain `Count$Threshold` selector) are caught
// here. Empty `<elseValue>` / `<thenValue>` are treated as 0.
//
// Form recognised:
//   <Flag> ::= [A-Za-z][A-Za-z0-9]*
//   <Else> <Then> ::= integer (signed digits)
//   "Count$<Flag>.<Else>.<Then>"
//
// Flags supported (each evaluator returns boolean):
//   - Hellbent       : controller has 0 cards in hand
//   - Metalcraft     : controller controls ≥3 artifacts
//   - Delirium       : controller's graveyard has ≥4 distinct card types
//   - FatefulHour    : controller has ≤5 life
//   - Landfall       : controller played a land this turn
//   - Revolt         : a permanent the controller controlled left BF this turn
//   - Threshold      : controller has ≥7 cards in graveyard
//   - Spellmastery   : ≥2 instants/sorceries in controller's graveyard
//   - Heroic         : trigger-only flag — treat as true (TODO: refine)
//   - Kicked         : source card.wasKicked === true
//   - Foretold       : source card.foretold === true
//   - Madness        : source card.madnessCast === true
//   - Morbid         : a creature died this turn (game.flags counter)
//   - Bargain        : source card.bargainPaid === true
//   - Surged         : source card.surgePaid === true
//   - Adamant        : source card.adamantColor !== undefined
//   - Spectacle      : source card.spectacleCast === true
//   - Freerunning    : source card.freerunningCast === true
//
// Flags whose state-tracking is not yet wired (Bargain, Spectacle,
// Freerunning) read defensively from card slots that handlers stamp on
// payment; until those handlers exist the slot is undefined and the
// evaluator returns false (= elseValue branch). Documented per-evaluator.
// Adamant (Wave 105) and Surge (Wave 104) are now fully wired.
import type { SVarExpressionAst } from "@mtg-forge-ts/core";
import { CardType, ZoneType } from "@mtg-forge-ts/core";
import type { Card } from "../../card.js";
import type { Game } from "../../game.js";
import type { SvarContext } from "../context.js";
import { selectorRegistry } from "../selector-registry.js";
import { registerTernaryHandler } from "./count.js";

type FlagEvaluator = (ctx: SvarContext) => boolean;

const cardHasType = (card: Card, t: CardType): boolean => card.paperCard.definition?.types?.has(t) === true;

const collectGraveyardCards = (game: Game, seat: number): Card[] => {
  const player = game.players.find((p) => (p.seat as unknown as number) === seat);
  if (!player) return [];
  const gy = player.zones.get(ZoneType.Graveyard);
  if (!gy) return [];
  const out: Card[] = [];
  for (const id of gy.toArray()) {
    const c = game.cards.get(id);
    if (c) out.push(c);
  }
  return out;
};

const evalHellbent: FlagEvaluator = (ctx) => {
  if (ctx.controller === undefined) return false;
  const player = ctx.game.players.find((p) => p.seat === ctx.controller);
  if (!player) return false;
  const hand = player.zones.get(ZoneType.Hand);
  return hand !== undefined && hand.size === 0;
};

const evalMetalcraft: FlagEvaluator = (ctx) => {
  if (ctx.controller === undefined) return false;
  let count = 0;
  for (const c of ctx.game.cards.values()) {
    if (c.zone !== ZoneType.Battlefield) continue;
    if (c.controllerSeat !== ctx.controller) continue;
    if (cardHasType(c, CardType.Artifact)) count++;
    if (count >= 3) return true;
  }
  return false;
};

const evalDelirium: FlagEvaluator = (ctx) => {
  if (ctx.controller === undefined) return false;
  const seen = new Set<CardType>();
  for (const c of collectGraveyardCards(ctx.game, ctx.controller as unknown as number)) {
    const types = c.paperCard.definition?.types;
    if (!types) continue;
    for (const t of [
      CardType.Artifact,
      CardType.Battle,
      CardType.Creature,
      CardType.Enchantment,
      CardType.Instant,
      CardType.Kindred,
      CardType.Land,
      CardType.Planeswalker,
      CardType.Sorcery,
    ]) {
      if (types.has(t)) seen.add(t);
    }
    if (seen.size >= 4) return true;
  }
  return seen.size >= 4;
};

const evalFatefulHour: FlagEvaluator = (ctx) => {
  if (ctx.controller === undefined) return false;
  const player = ctx.game.players.find((p) => p.seat === ctx.controller);
  if (!player) return false;
  return player.life <= 5;
};

const evalLandfall: FlagEvaluator = (ctx) => {
  if (ctx.controller === undefined) return false;
  if (!ctx.game.flags) return false;
  return (ctx.game.flags.landsPlayedThisTurn.get(ctx.controller) ?? 0) >= 1;
};

const evalRevolt: FlagEvaluator = (ctx) => {
  if (ctx.controller === undefined) return false;
  if (!ctx.game.flags) return false;
  return (ctx.game.flags.permanentsLeftBfThisTurn.get(ctx.controller) ?? 0) >= 1;
};

const evalThreshold: FlagEvaluator = (ctx) => {
  if (ctx.controller === undefined) return false;
  const player = ctx.game.players.find((p) => p.seat === ctx.controller);
  if (!player) return false;
  const gy = player.zones.get(ZoneType.Graveyard);
  return gy !== undefined && gy.size >= 7;
};

const evalSpellmastery: FlagEvaluator = (ctx) => {
  if (ctx.controller === undefined) return false;
  let count = 0;
  for (const c of collectGraveyardCards(ctx.game, ctx.controller as unknown as number)) {
    if (cardHasType(c, CardType.Instant) || cardHasType(c, CardType.Sorcery)) count++;
    if (count >= 2) return true;
  }
  return false;
};

// Heroic is normally a trigger condition (T:Mode$ SpellCast | TargetsValid$
// Card.Self), not a static gate. The Forge-printed shape "the spell that
// triggered this targeted me" is exactly what the trigger context already
// records — `triggerContext.objects` is the set of cast-spell targets
// captured at trigger fire-time. Wave 105 closure of the prior
// TODO(advanced): when the SVar evaluator runs inside a trigger
// resolution AND the trigger context carries a target list, we honor it
// — Heroic fires only when the source card id is among those targets.
// When no trigger context is supplied (the SVar is being read outside a
// trigger fire — e.g. an effect computing a thenValue branch
// independently), fall back to true to preserve the prior
// always-thenValue contract; that keeps Wave-51 ternaries that don't
// thread trigger context through working unchanged.
const evalHeroic: FlagEvaluator = (ctx) => {
  const tc = ctx.triggerContext;
  if (!tc || tc.objects === undefined) return true;
  if (ctx.sourceCardId === undefined) return true;
  return tc.objects.includes(ctx.sourceCardId);
};

const evalKicked: FlagEvaluator = (ctx) => {
  if (ctx.sourceCardId === undefined) return false;
  const card = ctx.game.cards.get(ctx.sourceCardId);
  return card?.wasKicked === true;
};

const evalForetold: FlagEvaluator = (ctx) => {
  if (ctx.sourceCardId === undefined) return false;
  const card = ctx.game.cards.get(ctx.sourceCardId);
  return card?.foretold === true;
};

const evalMadness: FlagEvaluator = (ctx) => {
  if (ctx.sourceCardId === undefined) return false;
  const card = ctx.game.cards.get(ctx.sourceCardId);
  return card?.madnessCast === true;
};

const evalMorbid: FlagEvaluator = (ctx) => {
  if (!ctx.game.flags) return false;
  return ctx.game.flags.creaturesDiedThisTurn >= 1;
};

const evalBargain: FlagEvaluator = (ctx) => {
  if (ctx.sourceCardId === undefined) return false;
  const card = ctx.game.cards.get(ctx.sourceCardId);
  return card?.bargainPaid === true;
};

// Wave 105 closure of the prior TODO(advanced): Adamant IS wired through
// CostMana.pay (cost/parts/cost-mana.ts), which buckets each consumed pool
// entry by color and stamps `card.adamantColor` whenever a chromatic bucket
// reaches ≥3 pips (Phyrexian pips and colorless pips are correctly excluded
// — Phyrexian pips pay life per CR 107.1f, colorless does not satisfy
// Adamant). At Count$Adamant evaluation the slot is already live; no
// trigger-time work needed.
const evalAdamant: FlagEvaluator = (ctx) => {
  if (ctx.sourceCardId === undefined) return false;
  const card = ctx.game.cards.get(ctx.sourceCardId);
  return card?.adamantColor !== undefined;
};

// Wave 104 closure of the prior TODO(advanced): Surge IS wired through
// `altcost/surge.ts` (Wave 58). Surge.modifyCastContext stamps
// `card.surgePaid = true` when the alt-cost was paid; surge availability
// itself reads `controllerCastSpellsThisTurn(card, game) >= 1` against
// `game.flags.spellsCastThisTurn`. So at Count$Surged time the slot is
// authoritative — `card.surgePaid` reflects whether THIS spell was cast
// for its surge cost. The selector mirrors the Wave 58 wiring directly.
const evalSurged: FlagEvaluator = (ctx) => {
  if (ctx.sourceCardId === undefined) return false;
  const card = ctx.game.cards.get(ctx.sourceCardId);
  return card?.surgePaid === true;
};

const evalSpectacle: FlagEvaluator = (ctx) => {
  if (ctx.sourceCardId === undefined) return false;
  const card = ctx.game.cards.get(ctx.sourceCardId);
  return card?.spectacleCast === true;
};

const evalFreerunning: FlagEvaluator = (ctx) => {
  if (ctx.sourceCardId === undefined) return false;
  const card = ctx.game.cards.get(ctx.sourceCardId);
  return card?.freerunningCast === true;
};

const flagEvaluators: ReadonlyMap<string, FlagEvaluator> = new Map([
  ["Hellbent", evalHellbent],
  ["Metalcraft", evalMetalcraft],
  ["Delirium", evalDelirium],
  ["FatefulHour", evalFatefulHour],
  ["Landfall", evalLandfall],
  ["Revolt", evalRevolt],
  ["Threshold", evalThreshold],
  ["Spellmastery", evalSpellmastery],
  ["Heroic", evalHeroic],
  ["Kicked", evalKicked],
  ["Foretold", evalForetold],
  ["Madness", evalMadness],
  ["Morbid", evalMorbid],
  ["Bargain", evalBargain],
  ["Adamant", evalAdamant],
  ["Surged", evalSurged],
  ["Spectacle", evalSpectacle],
  ["Freerunning", evalFreerunning],
]);

// Match `<Flag>.<int>.<int>` with optional sign on the integer values.
// Anchored to begin/end so we never partial-match into a different family
// (e.g. "Devotion.Black" must NOT be misread as a ternary).
const TERNARY_RE = /^([A-Za-z][A-Za-z0-9]*)\.(-?\d+)\.(-?\d+)$/;

/**
 * Try to dispatch `arg` as a Forge conditional-ternary form. Returns the
 * evaluated number when the pattern matches AND the flag is registered,
 * `undefined` otherwise so the caller can fall through to other dispatch
 * strategies (compound-arg head split, etc.).
 */
export const tryEvalTernary = (arg: string, ctx: SvarContext): number | undefined => {
  const m = TERNARY_RE.exec(arg);
  if (!m) return undefined;
  const flagName = m[1];
  const elseRaw = m[2];
  const thenRaw = m[3];
  if (flagName === undefined || elseRaw === undefined || thenRaw === undefined) return undefined;
  const evaluator = flagEvaluators.get(flagName);
  if (!evaluator) return undefined;
  const elseVal = Number.parseInt(elseRaw, 10);
  const thenVal = Number.parseInt(thenRaw, 10);
  if (!Number.isFinite(elseVal) || !Number.isFinite(thenVal)) return undefined;
  return evaluator(ctx) ? thenVal : elseVal;
};

// Also expose the ternary as a parameterless boolean selector under each
// flag name (for `Has$Hellbent`-style integration paths). This is a thin
// wrapper that returns 1/0 — useful for arithmetic combinators that want
// to multiply a flag against a constant.
const mkBoolSelector =
  (evaluator: FlagEvaluator) =>
  (_ast: SVarExpressionAst, ctx: SvarContext): number =>
    evaluator(ctx) ? 1 : 0;

for (const [name, evaluator] of flagEvaluators) {
  // Register under selectorRegistry so `<Flag>$` direct invocations also
  // route through the same evaluator. Conservative: only registers if no
  // other selector has claimed the name.
  if (!selectorRegistry.has(name)) {
    selectorRegistry.register(name, mkBoolSelector(evaluator));
  }
}

// Wire the dispatcher into count.ts. Module-load side-effect; the `imports
// "./conditions.js"` from svar/index.ts is what actually triggers this.
registerTernaryHandler(tryEvalTernary);

// Re-export for tests + external integration.
export { flagEvaluators };
