// SPDX-License-Identifier: GPL-3.0-or-later
// CR 603.10c — A triggered ability that requires a target chosen from
// among a set of possible targets won't trigger at all if there are no
// possible targets when it would trigger. Forge implements this in
// `SpellAbility.setupTargets()`: when `chooseTargetsFor` returns false
// (no legal target exists), `playSpellAbility()` returns false and the
// trigger never makes it onto the stack.
//
// In TS we model this at the trigger-registry boundary: after a trigger
// passes `matches() / interveningIf / suppression / DisableTriggers`, we
// walk its Execute$ SVar's effect chain (parent + sub-abilities), gather
// any `ValidTgts$` clauses, and call `cardMatchesFilter` against the
// battlefield (plus players for "Any"-flavour filters). If any clause
// would require a target and the eligibility set is empty, we skip the
// trigger fire — exactly what Forge does.
//
// Scope: the probe runs only when the source card has a parsed
// `definition.svars` Map containing the trigger's `Execute$` SVar (i.e.
// data-driven triggers built via `ChangesZoneTrigger` etc.). Hand-built
// triggered abilities from keyword handlers, replacement-spawned
// triggers, etc., have no AST handle and pass through unchanged — they
// already encode their own legality at construction time.
//
// We use the trigger-registry's own `cardMatchesFilter` rather than
// `parseValidTgts` because the trigger filter grammar is richer
// (subtype-as-base, plus-AND, comma-OR, Other, Self, etc.) and matches
// Forge's filter machinery more faithfully. parseValidTgts is the cast
// pipeline's restriction parser, which intentionally drops to a
// permissive fallback for unknown bases — wrong for our skip path.
//
// Forge references:
//   - forge.game.spellability.SpellAbility#setupTargets (line 2129)
//   - forge.game.player.PlaySpellAbility#playSpellAbility (line ~681)
//   - CR 603.10c
import type { EffectInvocation, EntityId, ParamValue, SVarAst, TriggeredAbility } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import { cardMatchesFilter } from "../trigger/card-filter.js";

/**
 * Read a literal-kind ParamValue from an effect invocation, or undefined.
 * (svarRef / expression params are out of scope for legality probing —
 * Forge resolves them at resolve-time, but the trigger-fire gate only
 * needs to recognise literal `ValidTgts$ Permanent.nonLand+Other`-style
 * values.)
 */
const getLiteralParam = (params: Readonly<Record<string, ParamValue>>, key: string): string | undefined => {
  const pv = params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

/**
 * Walk the effect chain — parent + nested `subAbility` field, plus
 * `SubAbility$` params that reference another ability SVar by name —
 * and yield every EffectInvocation in the chain. Forge's SubAbility
 * chain is at most a few levels deep on every published card (typically
 * 1-3 steps).
 *
 * Two link forms are recognised:
 *   1. Pre-linked: `invocation.subAbility` field.
 *   2. SVar-ref: `params.SubAbility = { kind: 'svarRef', name }`
 *      pointing into the card's `svars` map. This is the canonical form
 *      for parsed Forge cards (SubAbility$ KorOutfitting points at the
 *      next SVar's ability).
 */
function* walkEffectChain(
  root: EffectInvocation,
  svars: ReadonlyMap<string, SVarAst>,
): Generator<EffectInvocation> {
  let cur: EffectInvocation | undefined = root;
  let safety = 0;
  const visited = new Set<string>();
  while (cur) {
    safety++;
    if (safety > 32) return;
    yield cur;
    if (cur.subAbility) {
      cur = cur.subAbility;
      continue;
    }
    const sub = cur.params.SubAbility;
    if (sub && sub.kind === "svarRef") {
      if (visited.has(sub.name)) return;
      visited.add(sub.name);
      const sv = svars.get(sub.name);
      if (sv && sv.kind === "ability" && sv.ability) {
        cur = sv.ability;
        continue;
      }
    }
    cur = undefined;
  }
}

/**
 * Count cards on the battlefield matching the given ValidTgts$ filter.
 * Mirrors Forge's `chooseTargetsFor` first-pass eligibility scan: walk
 * every battlefield permanent, apply `cardMatchesFilter` (the
 * trigger/static filter with comma-OR + dot/plus-AND + Self/Other/
 * YouCtrl/OppCtrl/subtype semantics), and return the count.
 *
 * The "Any" / "Player" base targets are treated as always >0 because at
 * least one player is always a legal target — those filters never
 * cause a CR 603.10c skip.
 */
function countLegalTargets(
  game: Game,
  validTgts: string,
  ctx: { readonly sourceCardId: EntityId; readonly controllerSeat: import("@mtg-forge-ts/core").PlayerSeat },
): number {
  // "Any" / "Player" — always at least one player exists.
  // Forge's `Any` is "any target", which includes players; never empty.
  const trimmed = validTgts.trim();
  if (trimmed === "Any" || trimmed === "Player") return Math.max(game.players.length, 1);

  let count = 0;
  for (const card of game.cards.values()) {
    if (card.zone !== ZoneType.Battlefield) continue;
    if (cardMatchesFilter(card, trimmed, ctx)) count++;
  }

  // Filters whose grammar admits players (e.g. "Creature,Player",
  // "Permanent.YouCtrl,Player") get an unconditional player bump
  // because at least one player is always present. We detect the
  // player admission lexically — any comma-OR alternative whose base
  // token is `Player` or `Any` adds a player floor.
  const alts = trimmed.split(",");
  for (const alt of alts) {
    const base = alt.split(/[.+]/)[0]?.trim();
    if (base === "Player" || base === "Any") {
      count = Math.max(count, 1);
      break;
    }
  }
  return count;
}

/**
 * Probe whether a triggered ability has at least one legal target for
 * every targeted step in its Execute$ chain. Returns `true` iff the
 * trigger has at least one targeted step AND any such step has an empty
 * eligibility set (CR 603.10c — "won't trigger").
 *
 * Returns `false` when:
 *   - The trigger has no AST handle (hand-built / keyword-spawned).
 *   - The trigger's Execute$ SVar isn't found on the source.
 *   - No step in the chain declares `ValidTgts$`.
 *   - All declared `ValidTgts$` steps have ≥1 eligible target.
 *
 * Caller (TriggerRegistry.onEvent) interprets `true` as "drop this
 * trigger fire" — it never gets queued onto the pending list, never
 * goes onto the stack, and never resolves.
 */
export function triggerHasNoLegalTarget(game: Game, trigger: TriggeredAbility): boolean {
  const sourceCard = game.cards.get(trigger.sourceCardId as EntityId);
  if (!sourceCard) return false;
  const def = sourceCard.paperCard.definition;
  if (!def) return false;
  const svars = def.svars as ReadonlyMap<string, SVarAst> | undefined;
  if (!svars) return false;

  const maybeKey = (trigger as unknown as { readonly executeKey?: string }).executeKey;
  let chain: EffectInvocation | undefined;
  if (maybeKey !== undefined) {
    const sv = svars.get(maybeKey);
    if (sv && sv.kind === "ability" && sv.ability) {
      chain = sv.ability;
    }
  }
  if (!chain) {
    const cardTriggers = (def as { readonly triggers?: readonly { readonly effect: EffectInvocation }[] })
      .triggers;
    if (!cardTriggers || cardTriggers.length === 0) return false;
    if (cardTriggers.length === 1) {
      const ekey = cardTriggers[0]?.effect?.handlerKey;
      if (ekey) {
        const sv = svars.get(ekey);
        if (sv && sv.kind === "ability" && sv.ability) {
          chain = sv.ability;
        }
      }
    }
    if (!chain) return false;
  }

  for (const step of walkEffectChain(chain, svars)) {
    const validTgts = getLiteralParam(step.params, "ValidTgts");
    if (!validTgts) continue;
    const count = countLegalTargets(game, validTgts, {
      sourceCardId: trigger.sourceCardId,
      controllerSeat: sourceCard.controllerSeat,
    });
    if (count === 0) {
      // CR 603.10c — at least one targeted step has no legal target.
      // The trigger doesn't trigger at all.
      return true;
    }
  }
  return false;
}
