// SPDX-License-Identifier: GPL-3.0-or-later
// replace-with-svar — shared SVar-resolution helper for `ReplaceWith$ <SVar>`
// dispatch on replacement-effect handlers.
//
// Wave 14b extracted the SVar-walk pattern inline in GameLossReplacement
// (Exquisite Archangel: ChangeZone Battlefield→Exile + SetLife
// You=startingLife). Wave 17b promotes that lookup into a reusable helper
// so the six new replacement event handlers (DrawCards / PayLife / Cascade
// / RollDice / Mill / Destroy) can share the same SVar plumbing without
// duplicating the boilerplate.
//
// Wave 29 adds the synchronous EXECUTION half: `runReplaceWithAbilitySync`
// builds a SpellAbility around the resolved EffectInvocation chain and
// drains its resolver generator in-place so the apply() boundary (which
// is synchronous, not a generator) actually performs the substituted
// effect. Decisions cannot be answered from inside a replacement-apply,
// so the runner skips decision yields and only forwards EngineYield
// events back via game.emitEvent's pre-applied side effects.
//
// Scope: the helper covers SVAR LOOKUP and SYNCHRONOUS EXECUTION. Each
// handler retains its own pattern-matching for the recognised
// ReplaceWith$ shapes (e.g. Destroy recognises DBExile to redirect to
// the exile intent). Handlers that don't yet have a recognised pattern
// record the SVar AND execute it synchronously, then fall through to
// "canonical event replaced".
import type { AbilityAst, EffectInvocation, EntityId, PlayerSeat, SVarAst } from "@mtg-forge-ts/core";
import { effectRegistry } from "../../ability/effect-registry.js";
import { SpellAbility } from "../../ability/spell-ability.js";
import type { Game } from "../../game.js";

/**
 * Walk the source card's SVar map for `key`, returning the parsed ability
 * `EffectInvocation` if the SVar is an ability SVar with a populated
 * ability tree; `null` otherwise.
 *
 * Returns `null` (rather than throwing) on:
 *   - missing source card / definition,
 *   - no `svars` map on the definition,
 *   - SVar key not present,
 *   - SVar present but `kind !== "ability"` or `ability` undefined.
 *
 * Callers fall back to the canonical event on `null` so a typo'd SVar
 * name doesn't strand the replacement chain in an inconsistent state.
 */
export const lookupReplaceWithAbility = (
  game: Game,
  sourceCardId: EntityId,
  key: string,
): EffectInvocation | null => {
  const card = game.cards.get(sourceCardId);
  const def = card?.paperCard?.definition;
  if (!def) return null;
  const svars = def.svars as ReadonlyMap<string, SVarAst> | undefined;
  if (!svars) return null;
  const sv = svars.get(key);
  if (!sv || sv.kind !== "ability" || !sv.ability) return null;
  return sv.ability;
};

/**
 * Synchronously execute a `ReplaceWith$ <SVar>` substituted ability.
 *
 * Builds a SpellAbility around `ability` (and its `subAbility` chain)
 * and drains the resolver generator step-by-step. Engine yields with
 * `kind: "event"` are accepted (game-state mutations performed by effect
 * resolvers via `game.emitEvent` already happened — the yield is only an
 * observation channel for subscribers). Yields with `kind: "decision"`
 * are skipped: the apply() boundary is synchronous (CR 614 mutation
 * intent context) and cannot wait for player input. Cards that need
 * player choice for their substituted ability fall through this runner
 * cleanly — the canonical event is still treated as replaced (the apply
 * caller returns null after this).
 *
 * Returns `true` if every effect in the chain resolved (handler found).
 * Returns `false` on the first unregistered handlerKey so callers can
 * decide whether to fall back to the canonical event.
 */
export const runReplaceWithAbilitySync = (
  game: Game,
  sourceCardId: EntityId,
  controllerSeat: PlayerSeat,
  ability: EffectInvocation,
): boolean => {
  // Walk the SubAbility chain inline. Forge expresses chained effects as
  // `subAbility` on EffectInvocation; we resolve each link in turn so
  // multi-step substituted effects (e.g. ChangeZone → SetLife) execute
  // in declaration order.
  let cur: EffectInvocation | undefined = ability;
  while (cur) {
    const cls = effectRegistry.lookup(cur.handlerKey);
    if (!cls) return false;
    const fakeAst: AbilityAst = {
      kind: "spell",
      effect: cur,
      cost: { raw: "" },
    };
    const card = game.cards.get(sourceCardId);
    const svars =
      (card?.paperCard?.definition?.svars as ReadonlyMap<string, SVarAst> | undefined) ??
      new Map<string, SVarAst>();
    const sa = new SpellAbility(fakeAst, sourceCardId, controllerSeat, svars);
    const gen = cls.prototype.resolve.call(new cls(), sa, game) as Generator<unknown, void, unknown>;
    // Drain synchronously. Skip decision yields (cannot be answered from
    // inside an apply() boundary). Event yields are inert here — the
    // resolver already invoked game.emitEvent which performed the side
    // effects on its caller's behalf, and the yielded EngineYield is
    // only an outward observation channel.
    let step = gen.next();
    while (!step.done) {
      step = gen.next();
    }
    cur = cur.subAbility;
  }
  return true;
};
