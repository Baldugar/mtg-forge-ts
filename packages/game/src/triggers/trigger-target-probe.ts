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
// M6.9 also adds a requirement-gate (mirroring Forge's
// `CardTraitBase#meetsCommonRequirements`) that consults the trigger's
// raw param map (stamped by the trigger-handler):
//
//   - `CheckSVar$ <name>` + `SVarCompare$ <op><operand>`: evaluate the
//     SVar against the comparator (GTX = > X, GE3 = >= 3, etc.) and
//     skip the trigger fire if the comparison fails. Knight of the
//     White Orchid uses this to gate "an opponent controls more lands
//     than you".
//   - `Desert$ True`: require the controller to have a Desert in
//     {Battlefield, Graveyard} (CR's `hasDesert()` flavour). Sand
//     Strangler uses this to gate its ETB damage on a Desert presence.
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
//   - forge.game.CardTraitBase#meetsCommonRequirements (line ~290)
//   - CR 603.10c
import type { EffectInvocation, EntityId, ParamValue, SVarAst, TriggeredAbility } from "@mtg-forge-ts/core";
import { CardType, ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { SvarContext } from "../svar/context.js";
import { evaluateSVar } from "../svar/index.js";
import { cardMatchesFilter, evalPresentCompare } from "../trigger/card-filter.js";

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
 * Read a string-shaped param (literal or svarRef name) for the requirement
 * gate. Forge's TriggerAst params for `CheckSVar$`, `SVarCompare$`,
 * `Desert$`, etc. accept either a literal string OR a SVar name
 * reference; both forms collapse to "the identifier". Used by the M6.9
 * requirement gate where Forge's `meetsCommonRequirements` reads the
 * raw param value via `params.get(key)`.
 */
const getStringParam = (params: Readonly<Record<string, ParamValue>>, key: string): string | undefined => {
  const pv = params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  if (pv.kind === "svarRef") return pv.name;
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

const ZONE_BY_TGT_ZONE: Readonly<Record<string, ZoneType>> = {
  Battlefield: ZoneType.Battlefield,
  Graveyard: ZoneType.Graveyard,
  Hand: ZoneType.Hand,
  Library: ZoneType.Library,
  Exile: ZoneType.Exile,
  Stack: ZoneType.Stack,
};

/**
 * Count cards in the candidate zone (default Battlefield, or the zone
 * named by `TgtZone$`) matching the given ValidTgts$ filter. Mirrors
 * Forge's `chooseTargetsFor` first-pass eligibility scan: walk every
 * permanent in the target zone, apply `cardMatchesFilter` (the
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
  tgtZoneRaw?: string,
): number {
  // "Any" / "Player" — always at least one player exists.
  // Forge's `Any` is "any target", which includes players; never empty.
  const trimmed = validTgts.trim();
  if (trimmed === "Any" || trimmed === "Player") return Math.max(game.players.length, 1);

  const targetZone = tgtZoneRaw
    ? (ZONE_BY_TGT_ZONE[tgtZoneRaw] ?? ZoneType.Battlefield)
    : ZoneType.Battlefield;
  let count = 0;
  for (const card of game.cards.values()) {
    if (card.zone !== targetZone) continue;
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
    // M6.9 — `TargetMin$ 0` means the target is optional (CR 601.2c —
    // "up to N targets"). Forge's setupTargets() short-circuits the
    // "no legal target" skip path when minTargets == 0, so the trigger
    // fires and resolves as a no-op chooseTargetsFor. Mirror that here:
    // an explicit `TargetMin$ 0` (or `TargetMin$ <expr>` resolving to 0)
    // does NOT count as a CR 603.10c skip. Default minimum is 1 when
    // the param is absent.
    const targetMinRaw = getLiteralParam(step.params, "TargetMin");
    if (targetMinRaw !== undefined) {
      const tm = Number(targetMinRaw);
      if (Number.isFinite(tm) && tm <= 0) continue;
    }
    const tgtZone = getLiteralParam(step.params, "TgtZone");
    const count = countLegalTargets(
      game,
      validTgts,
      {
        sourceCardId: trigger.sourceCardId,
        controllerSeat: sourceCard.controllerSeat,
      },
      tgtZone,
    );
    if (count === 0) {
      // CR 603.10c — at least one targeted step has no legal target.
      // The trigger doesn't trigger at all.
      return true;
    }
  }
  return false;
}

// =============================================================================
// M6.9 — Trigger requirement gate (mirrors Forge's
// `CardTraitBase#meetsCommonRequirements` + `Trigger#requirementsCheck`).
// =============================================================================

/**
 * Parse a Forge comparator like "GTX" / "GE3" / "EQ1" into operator + numeric
 * operand. The operator is the first two characters; the operand is the
 * remainder. The operand may be a literal integer (`"3"`) or a SVar name
 * (`"X"`); the caller resolves the SVar via `evaluateSVar` if non-numeric.
 */
const parseComparator = (
  cmp: string,
): { readonly op: "GT" | "GE" | "LT" | "LE" | "EQ" | "NE"; readonly operand: string } | null => {
  if (cmp.length < 3) return null;
  const op = cmp.slice(0, 2);
  if (op !== "GT" && op !== "GE" && op !== "LT" && op !== "LE" && op !== "EQ" && op !== "NE") return null;
  return { op, operand: cmp.slice(2) };
};

const compare = (lhs: number, op: "GT" | "GE" | "LT" | "LE" | "EQ" | "NE", rhs: number): boolean => {
  switch (op) {
    case "GT":
      return lhs > rhs;
    case "GE":
      return lhs >= rhs;
    case "LT":
      return lhs < rhs;
    case "LE":
      return lhs <= rhs;
    case "EQ":
      return lhs === rhs;
    case "NE":
      return lhs !== rhs;
  }
};

/**
 * Resolve a Forge SVar operand (number-or-svar-name) via the shared SVar
 * evaluator. Returns `undefined` when the name doesn't resolve to a numeric
 * SVar (e.g. an ability SVar is shaped wrong for a comparator operand —
 * Forge would treat that as zero and fail the requirement).
 */
const resolveOperand = (
  raw: string,
  svars: ReadonlyMap<string, SVarAst>,
  ctx: SvarContext,
): number | undefined => {
  if (raw === "") return undefined;
  const literal = Number(raw);
  if (!Number.isNaN(literal)) return literal;
  const sv = svars.get(raw);
  if (!sv) return undefined;
  if (sv.kind === "ability") return undefined; // operand can't be an ability
  if (sv.expression) {
    try {
      const v = evaluateSVar({ kind: "expression", ast: sv.expression }, ctx);
      return typeof v === "number" ? v : undefined;
    } catch {
      return undefined;
    }
  }
  const n = Number(sv.raw);
  return Number.isNaN(n) ? undefined : n;
};

/**
 * Check whether the controller of `trigger.sourceCardId` meets the
 * `Desert$ True` predicate — i.e., they control a Desert OR have a Desert
 * card in their graveyard. Mirror of Forge's `Player#hasDesert()`.
 */
const controllerHasDesert = (game: Game, trigger: TriggeredAbility): boolean => {
  const source = game.cards.get(trigger.sourceCardId as EntityId);
  if (!source) return false;
  const seat = source.controllerSeat;
  for (const card of game.cards.values()) {
    if (card.controllerSeat !== seat) continue;
    if (card.zone !== ZoneType.Battlefield && card.zone !== ZoneType.Graveyard) continue;
    const chars = game.layerEngine.computeCharacteristics(card.id);
    if (chars.subtypes.has("Desert")) return true;
  }
  return false;
};

/**
 * Probe whether a triggered ability fails its CR 603 / Forge
 * `meetsCommonRequirements` predicate set. Returns `true` iff the
 * trigger's stamped `triggerParams` contain at least one requirement
 * that fails — caller drops the fire (no PendingTrigger queued).
 *
 * Currently honoured params (the subset surfaced by the M6.9 cohort —
 * extend as new scenarios reveal more):
 *   - CheckSVar / SVarCompare (Knight of the White Orchid)
 *   - Desert (Sand Strangler)
 *   - Threshold / Hellbent / Metalcraft (parity-adjacent flag gates;
 *     trivial to add when scenarios surface them)
 */
export function triggerFailsRequirements(game: Game, trigger: TriggeredAbility): boolean {
  const params = (trigger as unknown as { readonly triggerParams?: Readonly<Record<string, ParamValue>> })
    .triggerParams;
  if (!params) return false;
  const sourceCard = game.cards.get(trigger.sourceCardId as EntityId);
  if (!sourceCard) return false;
  const def = sourceCard.paperCard.definition;
  if (!def) return false;
  const svars = (def.svars as ReadonlyMap<string, SVarAst> | undefined) ?? new Map<string, SVarAst>();
  const ctx: SvarContext = {
    game,
    sourceCardId: sourceCard.id,
    svars,
    controller: sourceCard.controllerSeat,
  };

  // CheckSVar$ <name> | SVarCompare$ <op><operand>
  // Forge default operator if SVarCompare$ is missing is "GE1" (>= 1).
  const checkSVar = getStringParam(params, "CheckSVar");
  if (checkSVar !== undefined) {
    const cmpRaw = getStringParam(params, "SVarCompare") ?? "GE1";
    const cmp = parseComparator(cmpRaw);
    if (cmp) {
      // Resolve LHS via the SVar referenced by CheckSVar$.
      const lhs = resolveOperand(checkSVar, svars, ctx) ?? 0;
      const rhs = resolveOperand(cmp.operand, svars, ctx) ?? 0;
      if (!compare(lhs, cmp.op, rhs)) return true;
    }
  }

  // Desert$ True — controller controls a Desert OR has a Desert in graveyard.
  const desert = getStringParam(params, "Desert");
  if (desert === "True") {
    if (!controllerHasDesert(game, trigger)) return true;
  }

  // Threshold$ True — controller has 7+ cards in graveyard.
  const threshold = getStringParam(params, "Threshold");
  if (threshold === "True") {
    const seat = sourceCard.controllerSeat;
    const player = game.getPlayer(seat);
    const gy = player?.zones.get(ZoneType.Graveyard);
    if ((gy?.size ?? 0) < 7) return true;
  }

  // Hellbent$ True — controller has empty hand.
  const hellbent = getStringParam(params, "Hellbent");
  if (hellbent === "True") {
    const seat = sourceCard.controllerSeat;
    const player = game.getPlayer(seat);
    const hand = player?.zones.get(ZoneType.Hand);
    if ((hand?.size ?? 0) > 0) return true;
  }

  // Metalcraft$ True — controller controls 3+ artifacts.
  const metalcraft = getStringParam(params, "Metalcraft");
  if (metalcraft === "True") {
    const seat = sourceCard.controllerSeat;
    let count = 0;
    for (const card of game.cards.values()) {
      if (card.controllerSeat !== seat) continue;
      if (card.zone !== ZoneType.Battlefield) continue;
      const chars = game.layerEngine.computeCharacteristics(card.id);
      if (chars.types.has(CardType.Artifact)) {
        count++;
        if (count >= 3) break;
      }
    }
    if (count < 3) return true;
  }

  // M6.17 — Forge `IsPresent$ <ValidCard>` (CardTraitBase.java line 409).
  // Counts cards in `PresentZone$` (default Battlefield) controlled by
  // `PresentPlayer$` (default Any) matching the filter, then evaluates
  // `PresentCompare$` (default GE1). If the predicate fails, the trigger
  // doesn't queue. Beastbond Outcaster's
  //   IsPresent$ Creature.YouCtrl+powerGE4
  // is the parity driver — the 3/3 itself doesn't satisfy powerGE4 so the
  // trigger never fires. Mirrors Forge's meetsCommonRequirements path.
  const isPresent = getStringParam(params, "IsPresent");
  if (isPresent !== undefined) {
    const presentCompareRaw = getStringParam(params, "PresentCompare") ?? "GE1";
    const presentPlayer = getStringParam(params, "PresentPlayer") ?? "Any";
    const presentZoneRaw = getStringParam(params, "PresentZone");
    const presentZone = presentZoneRaw
      ? (ZONE_BY_TGT_ZONE[presentZoneRaw] ?? ZoneType.Battlefield)
      : ZoneType.Battlefield;
    const seat = sourceCard.controllerSeat;
    let count = 0;
    for (const card of game.cards.values()) {
      if (card.zone !== presentZone) continue;
      const isYou = card.controllerSeat === seat;
      const isOpp = card.controllerSeat !== seat;
      // PresentPlayer$ filter on raw seat.
      if (presentPlayer === "You" && !isYou) continue;
      if ((presentPlayer === "Opponent" || presentPlayer === "Opp") && !isOpp) continue;
      // Default "Any" admits both.
      if (
        cardMatchesFilter(card, isPresent, {
          sourceCardId: sourceCard.id,
          controllerSeat: seat,
        })
      ) {
        count++;
      }
    }
    if (!evalPresentCompare(count, presentCompareRaw)) return true;
  }

  return false;
}
