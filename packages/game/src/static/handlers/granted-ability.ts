// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.B — Continuous static grants of triggered, replacement, and
// static abilities.
//
// Forge's `S:Mode$ Continuous` payloads `AddTrigger$ <SVarName>`,
// `AddReplacement$ <SVarName>`, and `AddStaticAbility$ <SVarName>`
// each grant a corresponding T:/R:/S: ability — defined in the named
// SVar on the static's source card — to every card matching the static's
// `Affected$` filter. ~500-1000 cards depend on at least one of these
// (anthems with granted triggers, lord effects, "creatures you control
// have <triggered ability>" / "permanents you control have
// <replacement>" clauses).
//
// Lifecycle:
//
//   1. At static activation, the Continuous handler builds a
//      `GrantedAbilitySweep` for each Add{Trigger,Replacement,
//      StaticAbility}$ payload, parses the SVar text into an AST once
//      (cached on the sweep), and adds the sweep to
//      `game.layerEngine.grantedAbilitySweeps`.
//   2. The sweep is run immediately to register grants for all currently
//      matched cards.
//   3. On every `LayerEngine.bumpEpoch`, every sweep re-evaluates its
//      filter — it adds grants for newly-matched cards and removes
//      grants for previously-matched-now-unmatched cards.
//   4. At static deactivation, `removeLayerPayload` walks the sweep's
//      registry and unregisters all extant grants, then drops the sweep
//      from the layer-engine list.
//
// SVar parsing is done by re-lexing the SVar `raw` text with the
// appropriate prefix prepended (`T:` / `R:` / `S:`) and dispatching to
// the existing single-line parsers in @mtg-forge-ts/cards. SVar bodies
// for granted abilities are written without the line prefix in Forge
// (e.g. `SVar:JeskaiTrigger:Mode$ Phase | Phase$ Upkeep | ...`); the
// re-lex path stitches the prefix back on so the standard parser
// pipeline applies verbatim.
//
// Granted-ability ownership semantics (matches Forge):
//   - `sourceCardId = matchedCardId` — the granted ability's source is
//     the matched card, so `Card.Self` checks in `matches()` resolve to
//     that card and effects targeting "this creature" hit it.
//   - `controllerSeatAtReg = matchedCard.controllerSeat` — the granted
//     ability is controlled by whoever controls the matched card.
//   - SVar lookup at resolve-time goes to the **static's source card**
//     (not the matched card), so the printed SVar text is the
//     authoritative body. The standard registry path looks up SVars
//     against `sourceCardId`, so granted triggers wrap their resolver
//     to redirect SVar lookup to the static-source.
import { lex, parseReplacementLine, parseStaticLine, parseTriggerLine } from "@mtg-forge-ts/cards";
import type {
  AbilityAst,
  EntityId,
  PlayerSeat,
  ReplacementAbility,
  ReplacementAst,
  SVarAst,
  StaticAbility,
  StaticAbilityMode,
  StaticAst,
  TriggerAst,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import type { Game } from "../../game.js";
import { replacementHandlerRegistry } from "../../replacement/replacement-handler-registry.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { triggerHandlerRegistry } from "../../trigger/trigger-handler-registry.js";
import { staticHandlerRegistry } from "../static-handler.js";

// ----------------------------------------------------------------------------
// SVar text → AST helpers
// ----------------------------------------------------------------------------

/**
 * Re-lex an SVar's raw body as a `T:` / `R:` / `S:` line and dispatch to
 * the corresponding @mtg-forge-ts/cards parser. Forge stores the body
 * sans line prefix; we stitch it back on so the standard parser pipeline
 * applies verbatim. Returns null on lex/parse failure (graceful no-op
 * for malformed cards rather than throwing).
 */
const reparseSVarAs = <T>(
  svarRaw: string,
  prefix: "T" | "R" | "S",
  // biome-ignore lint/suspicious/noExplicitAny: the parser dispatch chooses one of three return shapes
  parser: (line: any) => T | readonly T[],
): T | null => {
  const source = `${prefix}:${svarRaw}`;
  let lines: ReturnType<typeof lex>;
  try {
    lines = lex(source);
  } catch {
    return null;
  }
  const line = lines[0];
  if (!line) return null;
  try {
    const result = parser(line);
    if (Array.isArray(result)) {
      return (result[0] as T | undefined) ?? null;
    }
    return result as T;
  } catch {
    return null;
  }
};

/** Look up an SVar by name on a card's PaperCard definition. */
const lookupSVar = (game: Game, cardId: EntityId, svarName: string): SVarAst | undefined => {
  const card = game.cards.get(cardId);
  if (!card) return undefined;
  const def = card.paperCard.definition;
  if (!def) return undefined;
  const svars = def.svars as ReadonlyMap<string, SVarAst>;
  return svars.get(svarName);
};

/**
 * Resolve an SVar by name to its `raw` body string. Granted-ability
 * SVars on Forge cards are stored as `kind: "value"` with the body in
 * `raw` (the parser's value-SVar branch is taken since the body does
 * not start with `DB$`). Returns null if the SVar does not exist or
 * cannot be coerced to a usable body.
 */
const svarRawBody = (sv: SVarAst): string | null => {
  // Most common: kind === "value" with raw holding the printed body
  // ("Mode$ ChangesZone | ..." / "Event$ Moved | ..." / etc.).
  if (sv.raw && sv.raw.length > 0) return sv.raw;
  return null;
};

// ----------------------------------------------------------------------------
// Granted-trigger resolver wrapping (SVar lookup redirection)
// ----------------------------------------------------------------------------

/**
 * Build the resolver that drives a granted trigger's `Execute$` SVar.
 * Standard trigger handlers look up SVars on the trigger's
 * `sourceCardId`; granted triggers source from the matched card but
 * the SVar body lives on the static-source. We override the resolver
 * so SVar lookup hits the static-source and effects still operate on
 * the matched card (via `sa.sourceCardId = matchedCardId`).
 */
const makeGrantedTriggerResolver = (params: {
  readonly executeKey: string;
  readonly staticSourceCardId: EntityId;
  readonly matchedCardId: EntityId;
  readonly controllerSeat: PlayerSeat;
}): StackItemResolver => ({
  *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
    const game = gameUnknown as Game;
    const staticSrc = game.cards.get(params.staticSourceCardId);
    if (!staticSrc) return;
    const def = staticSrc.paperCard.definition;
    if (!def) return;
    const svars = def.svars as ReadonlyMap<string, SVarAst>;
    const sv = svars.get(params.executeKey);
    if (!sv) {
      // Don't throw — granted trigger has no body to fire. Mirrors the
      // graceful skip pattern of static-handler unknown modes.
      return;
    }
    if (sv.kind !== "ability" || !sv.ability) {
      // Not an ability-bodied SVar; nothing to resolve.
      return;
    }
    const fakeAst: AbilityAst = {
      kind: "spell",
      effect: sv.ability,
      cost: { raw: "" },
    };
    const sa = new SpellAbility(
      fakeAst,
      params.matchedCardId,
      params.controllerSeat,
      svars,
      [], // no caster-selected targets at MVP
    );
    const innerResolver = sa.makeResolver();
    yield* innerResolver.resolve(game);
  },
});

// ----------------------------------------------------------------------------
// Granted-ability builders (per kind)
// ----------------------------------------------------------------------------

/**
 * Build a granted TriggeredAbility for `matchedCardId` from the parsed
 * SVar text. Uses the standard trigger handler registry to construct
 * `matches()` / `interveningIf` / `captureLki`, then overrides
 * `resolver` so SVar lookup hits the static-source card. Returns null
 * if the trigger mode is not registered (graceful no-op — Wave 60 MVP
 * accepts this rather than throwing on rare modes).
 */
const buildGrantedTrigger = (
  game: Game,
  triggerAst: TriggerAst,
  staticSourceCardId: EntityId,
  matchedCardId: EntityId,
  staticId: EntityId,
  svarName: string,
): TriggeredAbility | null => {
  const matched = game.cards.get(matchedCardId);
  if (!matched) return null;
  const Cls = triggerHandlerRegistry.lookup(triggerAst.mode);
  if (!Cls) return null;
  const handler = new Cls();
  const triggerId = game.newEntityId();
  const ta = handler.build(triggerAst, {
    game,
    sourceCardId: matchedCardId,
    controllerSeat: matched.controllerSeat,
    triggerId,
  });
  // Override resolver — SVar lookup must hit the static-source so the
  // printed SVar text is authoritative. Cast through unknown because the
  // resolver field is duck-typed (not declared on the core
  // TriggeredAbility type — extension shape from
  // changes-zone-trigger.ts:54).
  const overridden = ta as unknown as {
    resolver: StackItemResolver | null;
    grantedBy?: { staticId: EntityId; targetCardId: EntityId; svarName: string };
  };
  overridden.resolver = makeGrantedTriggerResolver({
    executeKey: triggerAst.effect.handlerKey,
    staticSourceCardId,
    matchedCardId,
    controllerSeat: matched.controllerSeat,
  });
  // Tag with grantedBy so future audits / snapshot inspection can find
  // the parent. Wave 60.B doesn't yet read this field outside of debug
  // contexts, but it makes the relationship discoverable.
  overridden.grantedBy = { staticId, targetCardId: matchedCardId, svarName };
  return ta;
};

/**
 * Build a granted ReplacementAbility for `matchedCardId`. Same shape as
 * `buildGrantedTrigger` — uses the standard registry to construct the
 * replacement, then tags `grantedBy` for ownership. The replacement's
 * `apply()` already executes via the registry's standard intent path;
 * SVar-bodied replacements that need to dispatch to the static-source's
 * SVars are TODO(advanced) — Wave 60.B MVP supports replacements whose
 * `ReplaceWith$` is a built-in handler (DBExile, DBHand, Prevent, etc.)
 * via the standard MovedReplacement path.
 */
const buildGrantedReplacement = (
  game: Game,
  replacementAst: ReplacementAst,
  staticSourceCardId: EntityId,
  matchedCardId: EntityId,
  staticId: EntityId,
  svarName: string,
): ReplacementAbility | null => {
  const matched = game.cards.get(matchedCardId);
  if (!matched) return null;
  const Cls = replacementHandlerRegistry.lookup(replacementAst.eventKind);
  if (!Cls) return null;
  const handler = new Cls();
  const replacementId = game.newEntityId();
  const ra = handler.build(replacementAst, {
    game,
    sourceCardId: matchedCardId,
    controllerSeat: matched.controllerSeat,
    replacementId,
  });
  const tagged = ra as unknown as {
    grantedBy?: { staticId: EntityId; targetCardId: EntityId; svarName: string };
  };
  tagged.grantedBy = { staticId, targetCardId: matchedCardId, svarName };
  // Suppress unused-variable lint on staticSourceCardId: the static
  // source is implicit via grantedBy.staticId; callers that need to
  // resolve the source can re-derive from there. We capture it in the
  // closure so future SVar-bodied replacement dispatch can reach it
  // without a registry lookup.
  void staticSourceCardId;
  return ra;
};

/**
 * Build a granted StaticAbility for `matchedCardId`. The granted static
 * is itself a sub-static (commonly Continuous with `Affected$ Card.Self`)
 * — its source is the matched card, so layer effects scope correctly.
 * Returns null if the inner mode is not registered.
 */
const buildGrantedStatic = (
  game: Game,
  staticAst: StaticAst,
  staticSourceCardId: EntityId,
  matchedCardId: EntityId,
  parentStaticId: EntityId,
  svarName: string,
): StaticAbility | null => {
  const matched = game.cards.get(matchedCardId);
  if (!matched) return null;
  // staticAst.mode is typed `string` from the parser AST; the registry
  // takes the canonical StaticAbilityMode enum. We rely on the registry
  // to return undefined for unknown modes, so a soft cast is safe.
  const Cls = staticHandlerRegistry.lookup(staticAst.mode as StaticAbilityMode);
  if (!Cls) return null;
  const handler = new Cls();
  const staticId = game.newEntityId();
  const built = handler.build(staticAst, {
    game,
    sourceCardId: matchedCardId,
    controllerSeat: matched.controllerSeat,
    staticId,
  });
  const tagged = built as unknown as {
    grantedBy?: { staticId: EntityId; targetCardId: EntityId; svarName: string };
  };
  tagged.grantedBy = { staticId: parentStaticId, targetCardId: matchedCardId, svarName };
  void staticSourceCardId;
  return built;
};

// ----------------------------------------------------------------------------
// GrantedAbilitySweep — per-payload state machine
// ----------------------------------------------------------------------------

/**
 * What a sweep grants. Determines which registry the sweep targets and
 * how the SVar text is parsed.
 */
export type GrantedAbilityKind = "trigger" | "replacement" | "static";

/**
 * Parameters captured at static-build time and passed to the sweep.
 * Held as a frozen struct so the sweep's behavior is fully driven by
 * its construction context.
 */
export interface GrantedAbilitySweepParams {
  readonly staticId: EntityId;
  readonly staticSourceCardId: EntityId;
  readonly controllerSeat: PlayerSeat;
  readonly kind: GrantedAbilityKind;
  readonly svarName: string;
  /** Live filter predicate — re-evaluated on every sweep. */
  readonly appliesToCardIdFn: (cardId: EntityId) => boolean;
}

/**
 * Per-payload sweep that tracks which cards currently hold a granted
 * ability and reconciles add/remove deltas on every layer-engine
 * recompute.
 *
 * The sweep parses its SVar text once, lazily, on first sweep — this
 * delays the parse until the static is actually live, and avoids
 * crashing the static-build path if the SVar happens to be malformed
 * (the sweep simply registers no grants, mirroring the graceful skip
 * pattern of static-handler unknown modes).
 */
export class GrantedAbilitySweep {
  // matchedCardId → grantedAbilityId. Always in sync with the
  // appropriate registry's content; reconciled in sweep().
  private readonly granted = new Map<EntityId, EntityId>();
  // Parsed AST cached after first successful parse. null = parse failed
  // (or hasn't been attempted yet — the boolean below differentiates).
  private parsedAst: TriggerAst | ReplacementAst | StaticAst | null = null;
  private parseAttempted = false;

  constructor(public readonly params: GrantedAbilitySweepParams) {}

  /**
   * Lazy parse — called on first sweep. Stitches the SVar `raw` body
   * onto the appropriate `T:` / `R:` / `S:` prefix and dispatches to the
   * @mtg-forge-ts/cards single-line parser. On parse failure (malformed
   * card data) the sweep silently grants nothing for the rest of its
   * lifetime; deactivation still cleans up correctly via the empty
   * `granted` map.
   */
  private ensureAst(game: Game): TriggerAst | ReplacementAst | StaticAst | null {
    if (this.parseAttempted) return this.parsedAst;
    this.parseAttempted = true;
    const sv = lookupSVar(game, this.params.staticSourceCardId, this.params.svarName);
    if (!sv) return null;
    const body = svarRawBody(sv);
    if (body === null) return null;
    let ast: TriggerAst | ReplacementAst | StaticAst | null = null;
    if (this.params.kind === "trigger") {
      ast = reparseSVarAs<TriggerAst>(body, "T", parseTriggerLine);
    } else if (this.params.kind === "replacement") {
      ast = reparseSVarAs<ReplacementAst>(body, "R", parseReplacementLine);
    } else {
      ast = reparseSVarAs<StaticAst>(body, "S", parseStaticLine);
    }
    this.parsedAst = ast;
    return ast;
  }

  /**
   * Reconcile the granted set with the current filter membership.
   *
   * - Newly-matched cards: build + register a granted ability.
   * - Previously-matched-now-unmatched: unregister.
   * - Cards that left the battlefield mid-flight: their entries in
   *   `granted` may already be unregistered by zone-change cleanup
   *   (`triggerRegistry.unregisterAllForCard`). Calling `unregister(id)`
   *   on an absent entry is a safe no-op, so we don't need to special-
   *   case zone churn here.
   */
  sweep(game: Game): void {
    const ast = this.ensureAst(game);
    if (ast === null) {
      // No AST → nothing to grant. Tear down any previously-granted
      // entries (defensive: keeps the sweep idempotent across stale
      // parsedAst clears).
      this.removeAll(game);
      return;
    }
    // Compute current matches: walk every battlefield card, ask the
    // predicate. The predicate already includes the Affected$ filter +
    // Condition$ gate (built by the Continuous handler).
    const currentMatches = new Set<EntityId>();
    for (const card of game.cards.values()) {
      // The predicate itself enforces zone scoping; we don't pre-filter
      // by zone here so that future AffectedZone$ widening works without
      // a code change.
      if (this.params.appliesToCardIdFn(card.id)) currentMatches.add(card.id);
    }
    // Remove grants for cards no longer matched.
    for (const [cardId, grantedId] of [...this.granted]) {
      if (!currentMatches.has(cardId)) {
        this.unregisterOne(game, cardId, grantedId);
      }
    }
    // Add grants for newly-matched cards.
    for (const cardId of currentMatches) {
      if (this.granted.has(cardId)) continue;
      this.registerOne(game, ast, cardId);
    }
  }

  /** Tear down all current grants (called on payload removal). */
  removeAll(game: Game): void {
    for (const [cardId, grantedId] of [...this.granted]) {
      this.unregisterOne(game, cardId, grantedId);
    }
  }

  private registerOne(
    game: Game,
    ast: TriggerAst | ReplacementAst | StaticAst,
    matchedCardId: EntityId,
  ): void {
    // Register-order matters: the registry's register() may bump the
    // layer-engine epoch (granted statics push layer payloads, granted
    // triggers don't but staying uniform is cheap), and bumpEpoch walks
    // grantedAbilitySweeps and re-runs sweep() on each. If we hadn't
    // yet recorded the new entry in `this.granted`, the re-entrant
    // sweep would observe the matched card as ungranted and register
    // a second time (compounding for the duration of the outer call).
    // Set `this.granted` BEFORE the registry call so re-entrant sweeps
    // see the entry and skip it.
    if (this.params.kind === "trigger") {
      const ta = buildGrantedTrigger(
        game,
        ast as TriggerAst,
        this.params.staticSourceCardId,
        matchedCardId,
        this.params.staticId,
        this.params.svarName,
      );
      if (!ta) return;
      this.granted.set(matchedCardId, ta.id);
      game.triggerRegistry.register(ta);
    } else if (this.params.kind === "replacement") {
      const ra = buildGrantedReplacement(
        game,
        ast as ReplacementAst,
        this.params.staticSourceCardId,
        matchedCardId,
        this.params.staticId,
        this.params.svarName,
      );
      if (!ra) return;
      this.granted.set(matchedCardId, ra.id);
      game.replacementRegistry.register(ra);
    } else {
      const sa = buildGrantedStatic(
        game,
        ast as StaticAst,
        this.params.staticSourceCardId,
        matchedCardId,
        this.params.staticId,
        this.params.svarName,
      );
      if (!sa) return;
      this.granted.set(matchedCardId, sa.id);
      game.staticEffectRegistry.register(sa);
    }
  }

  private unregisterOne(game: Game, matchedCardId: EntityId, grantedId: EntityId): void {
    if (this.params.kind === "trigger") {
      game.triggerRegistry.unregister(grantedId);
    } else if (this.params.kind === "replacement") {
      game.replacementRegistry.unregister(grantedId);
    } else {
      game.staticEffectRegistry.unregister(grantedId);
    }
    this.granted.delete(matchedCardId);
  }

  /**
   * Test / debug accessor — number of currently-granted abilities.
   * Used by wave60-grants.test.ts to verify register/unregister
   * symmetry through filter-membership churn.
   */
  size(): number {
    return this.granted.size;
  }

  /** Test / debug accessor — currently-matched card ids. */
  matchedCards(): readonly EntityId[] {
    return [...this.granted.keys()];
  }
}
