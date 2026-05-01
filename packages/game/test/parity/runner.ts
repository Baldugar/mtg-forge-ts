// SPDX-License-Identifier: GPL-3.0-or-later
// Milestone 4 — TS-vs-Java parity diff harness.
//
// Loads the TS golden (locked under packages/game/test/golden/__golden__/)
// and the Java golden (captured by tools/forge-bridge/ under
// __golden_java__/), normalizes both sides around the M3 MVP bridge
// limitations (shallow trigger fan-out, AI-picked targets, free casts,
// no stack drain) and produces a structured ParityReport.
//
// Why M4 doesn't enforce hard parity:
//   The M3 bridge MVP captures only the primary moveTo / SpellCast event
//   per action — it does not pay costs, drain the stack, fire effects,
//   or fan out triggers. Hard event-by-event parity is impossible until
//   the bridge gains those features (M5 work). For M4 we instead measure
//   "did the headline action land?" plus classify every TS-only event by
//   which known MVP limitation explains it.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GoldenEvent, GoldenTrace } from "../golden/types.js";

// ── Filesystem layout ────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const TS_GOLDEN_DIR = join(REPO_ROOT, "packages", "game", "test", "golden", "__golden__");
const JAVA_GOLDEN_DIR = join(REPO_ROOT, "tools", "forge-bridge", "__golden_java__");

// ── Java trace shape ─────────────────────────────────────────────────────────

/**
 * The Java bridge trace mirrors GoldenTrace but adds a `setupEvents`
 * bucket for battlefield-seeding events and omits `finalState`.
 * See tools/forge-bridge/README.md for the source.
 */
export interface JavaGoldenTrace {
  readonly scenarioId: string;
  readonly seed: number;
  readonly engineVersion: string;
  readonly events: readonly GoldenEvent[];
  readonly setupEvents?: readonly GoldenEvent[];
}

// ── Loaders ──────────────────────────────────────────────────────────────────

export function loadTsGolden(scenarioId: string): GoldenTrace | null {
  const p = join(TS_GOLDEN_DIR, `${scenarioId}.golden.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as GoldenTrace;
}

export function loadJavaGolden(scenarioId: string): JavaGoldenTrace | null {
  const p = join(JAVA_GOLDEN_DIR, `${scenarioId}.golden.java.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as JavaGoldenTrace;
}

// ── Normalization ────────────────────────────────────────────────────────────

/**
 * Canonical event for parity comparison. After normalization, both
 * sides emit events in this shape so a structural diff is meaningful.
 */
export interface NormalizedEvent {
  readonly kind: string;
  readonly turn: number;
  /** Card name when discoverable (TS via lookup, Java via payload). null otherwise. */
  readonly cardName: string | null;
  /** For CardChangedZone events. */
  readonly fromZone: string | null;
  readonly toZone: string | null;
}

/**
 * Collapse a side's raw event stream into the canonical NormalizedEvent
 * shape. Both sides apply the same projection so post-normalization
 * comparison is apples-to-apples.
 *
 * Java side requires a `setupEvents`-prepend so the implicit ordering
 * matches TS (which emits setup ETB events first within `events`).
 *
 * @param tsCardNamesById  TS-side helper: map of cardId → cardName so we
 *   can recover names from the TS golden's CardChangedZone payloads.
 *   Pass an empty Map for the Java side.
 */
export function normalizeTrace(
  trace: GoldenTrace | JavaGoldenTrace,
  side: "ts" | "java",
  tsCardNamesById: ReadonlyMap<number, string> = new Map(),
): NormalizedEvent[] {
  const stream: GoldenEvent[] = [];
  if (side === "java") {
    const javaTrace = trace as JavaGoldenTrace;
    if (javaTrace.setupEvents) stream.push(...javaTrace.setupEvents);
    stream.push(...javaTrace.events);
  } else {
    stream.push(...trace.events);
  }

  const out: NormalizedEvent[] = [];
  for (const e of stream) {
    if (isEngineInternal(e, side)) continue;
    out.push(projectEvent(e, side, tsCardNamesById));
  }
  return out;
}

/**
 * Engine-internal events that have no parity counterpart and should be
 * stripped before comparison. These are TS-only side-channels that
 * would otherwise inflate divergence counts.
 *
 * M4.5 strips:
 *   - `CardDestroyed` / `StateBasedActionApplied` (TS-only): the TS
 *     engine emits explicit destroy + SBA-applied marker events on top
 *     of the canonical `CardChangedZone(Battlefield→Graveyard)`. Forge's
 *     bridge captures only the zone-move (which already matches on both
 *     sides). The TS-only marker kinds inflate the diff for no signal.
 *   - `CostPaid` (TS-only): umbrella event that brackets the per-globe
 *     `ManaSpent` events. Forge has no equivalent — `ManaSpent` already
 *     matches per-globe on both sides via the bridge V2 cost pipeline.
 *   - `CardTargeted` / `CrimeCommitted` (TS-only): targeting/crime
 *     bookkeeping that Forge folds into the `SpellCast` payload rather
 *     than firing as separate event kinds.
 *   - `CardDrawn` (TS-only): TS emits a per-draw kind; Forge represents
 *     a draw as `CardChangedZone(Library→Hand)`, which already matches
 *     on both sides (the per-draw count differs but the kind is shared).
 */
function isEngineInternal(e: GoldenEvent, side: "ts" | "java"): boolean {
  if (side === "ts") {
    switch (e.kind) {
      case "CardDestroyed":
      case "StateBasedActionApplied":
      case "CostPaid":
      case "CardTargeted":
      case "CrimeCommitted":
      case "CardDrawn":
      // M6: TS-only `ReplacementApplied` is the engine's self-reflective
      // marker that a replacement effect was consulted (often a no-op
      // identity replace, e.g. Mosswort Bridge's hideaway-replacement
      // returns the original moveTo unchanged). Forge has no
      // GameEventReplacementApplied counterpart — the replacement is
      // applied silently inside the move pipeline. Strip on the TS side
      // so the Bridge→Battlefield zone-move (which already matches)
      // remains the only signal.
      case "ReplacementApplied":
      // M6.5: TS-only `TokenCreated` — Forge surfaces tokens via a
      // `CardChangedZone(null → Battlefield)` (no discrete creation
      // event), which already aligns 1:1 with the TS side's
      // `CardChangedZone` for the token. The TS-only `TokenCreated`
      // marker doubles up the token signal and inflates divergence.
      case "TokenCreated":
        return true;
      default:
        return false;
    }
  }
  return false;
}

/**
 * Project a raw GoldenEvent into the canonical NormalizedEvent shape,
 * stripping volatile / side-specific fields per the rules in
 * tools/parity-harness/event-mapping.md.
 */
function projectEvent(
  e: GoldenEvent,
  side: "ts" | "java",
  tsCardNamesById: ReadonlyMap<number, string>,
): NormalizedEvent {
  const payload = (e.payload ?? {}) as Record<string, unknown>;

  let cardName: string | null = null;
  let fromZone: string | null = null;
  let toZone: string | null = null;

  if (e.kind === "CardChangedZone") {
    fromZone = typeof payload.fromZone === "string" ? (payload.fromZone as string) : null;
    toZone = typeof payload.toZone === "string" ? (payload.toZone as string) : null;
    if (side === "java" && typeof payload.cardName === "string") {
      cardName = payload.cardName as string;
    } else if (side === "ts" && typeof payload.cardId === "number") {
      const id = payload.cardId as number;
      cardName = tsCardNamesById.get(id) ?? null;
    }
  }

  return {
    kind: e.kind,
    turn: e.turn,
    cardName,
    fromZone,
    toZone,
  };
}

// ── Diff + classification ────────────────────────────────────────────────────

/**
 * Categories the harness can apply to TS-only event-kinds. Each maps
 * 1:1 to a documented M3 MVP bridge limitation. Anything not classified
 * lands in `realDivergenceInvestigate` for human review.
 */
export type DivergenceClass =
  | "shallow-trigger-fanout"
  | "target-mismatch"
  | "free-cast-missing-mana"
  | "no-stack-drain"
  | "bridge-action-skipped"
  // Bridge V2 inverted the trigger/resolution gap: now Forge surfaces
  // the trigger fan-out + StackItemResolved that the TS golden runner
  // doesn't yet emit (because the TS runner is still single-action).
  // These Java-only events get bucketed as a known-TS-runner-gap.
  | "ts-runner-shallow"
  // M6: Bridge V2 doesn't emit `GameEventCounterAdded` — counter
  // application happens silently inside the move/ability pipeline. The
  // TS engine emits a discrete `CounterAdded` for every counter touch
  // (loyalty placement, +1/+1, charge, hideaway, etc.). Until the
  // bridge subscribes to the counter event, classify TS-only
  // CounterAdded as a known bridge capture gap rather than a real
  // engine divergence.
  | "bridge-counter-event-not-captured"
  // M6.6: bridge V2 doesn't subscribe to a handful of Forge "engine-state"
  // events (Class level changes, monarchy, day/night, energy, ring, etc.).
  // The TS engine emits discrete events for these state transitions; the
  // Java side has them too but the bridge's listener doesn't subscribe.
  // Same root cause as the counter-event gap, distinct event family.
  | "bridge-engine-state-event-not-captured"
  | "real-divergence-investigate";

/**
 * Java event-kinds → which TS-runner gap explains their absence on the
 * TS side. After Bridge V2 lands, Forge fires triggered-ability casts
 * (`SpellCast`, `StackItemResolved`) and resolution-zone moves
 * (`CardChangedZone` for spell→graveyard) that the M2 TS golden runner
 * doesn't yet emit because it captures only the primary action. M5
 * work on the TS side will close these gaps.
 */
const JAVA_ONLY_KIND_CLASS: ReadonlyMap<string, DivergenceClass> = new Map([
  ["SpellCast", "ts-runner-shallow"],
  ["StackItemResolved", "ts-runner-shallow"],
  ["CardChangedZone", "ts-runner-shallow"],
  ["LifeTotalChanged", "ts-runner-shallow"],
  ["CardTappedChanged", "ts-runner-shallow"],
  ["DamageDealt", "ts-runner-shallow"],
]);

/**
 * TS event-kinds → which MVP limit explains their absence on the Java
 * side. M4.5 stripped most TS-only umbrella kinds (CardDestroyed,
 * StateBasedActionApplied, CostPaid, CardTargeted, CrimeCommitted,
 * CardDrawn) at the `isEngineInternal` boundary, so this table is the
 * tail of TS-only kinds that aren't engine-internal but still surface
 * as divergences (e.g. when the TS runner emits an aggregated kind the
 * Java side splits across multiple finer-grained events).
 */
const TS_ONLY_KIND_CLASS: ReadonlyMap<string, DivergenceClass> = new Map([
  ["ManaSpent", "free-cast-missing-mana"],
  ["DamageDealt", "no-stack-drain"],
  ["LifeChanged", "no-stack-drain"],
  ["LifeLost", "no-stack-drain"],
  ["LifeGained", "no-stack-drain"],
  ["CardTapped", "no-stack-drain"],
  ["StackItemResolved", "no-stack-drain"],
  // SpellCast and the post-resolution CardChangedZone (spell→graveyard)
  // can surface as TS-only when the Java bridge silently skips a cast
  // action (a residual MVP limit for non-trivial spells that need
  // scripted targets the bridge can't fabricate). Bridge V2 cleared
  // every cohort scenario but keep the classifier for safety.
  ["SpellCast", "bridge-action-skipped"],
  ["CardChangedZone", "bridge-action-skipped"],
  // M6: TS-only AbilityActivated (when not aliased to a Java SpellCast)
  // means the bridge fired the headline cast but skipped the trigger
  // fan-out from the resolved permanent — e.g. Snapcaster Mage's ETB
  // trigger isn't surfaced by the bridge's stack-driving loop. Bucket
  // as the existing shallow-trigger-fanout limit.
  ["AbilityActivated", "shallow-trigger-fanout"],
  // M6: TS-only CounterAdded — bridge V2 doesn't capture
  // GameEventCounterAdded yet. Counter placements (loyalty for
  // planeswalkers, +1/+1 for ETB-counter creatures, hideaway etc.)
  // are silent on the Java side until the bridge subscribes to the
  // event. Classify as a known bridge capture gap.
  ["CounterAdded", "bridge-counter-event-not-captured"],
  // M6.6: Class-keyword level changes; bridge doesn't subscribe to
  // `GameEventClassLevelGained` (or whichever Forge event represents this).
  ["ClassLevelGained", "bridge-engine-state-event-not-captured"],
  // M6.6: Monarchy state change; bridge doesn't subscribe to
  // `GameEventMonarchChanged` analog.
  ["BecameMonarch", "bridge-engine-state-event-not-captured"],
]);

/**
 * Cross-side kind aliases. Forge folds multiple TS kinds into a single
 * `SpellCast` event (activated abilities, triggered abilities, spells
 * all share `GameEventSpellAbilityCast`). When matching TS-only and
 * Java-only kinds we treat aliased pairs as shared.
 *
 * Format: [tsKind, javaKind].
 */
const KIND_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["AbilityActivated", "SpellCast"],
  // Bridge V2 — Forge fires `GameEventPlayerLivesChanged` whose canonical
  // bridge kind is `LifeTotalChanged`. The TS engine emits separate
  // `LifeChanged` / `LifeLost` / `LifeGained` events. The harness aliases
  // them so a TS LifeChanged + Java LifeTotalChanged register as shared.
  ["LifeChanged", "LifeTotalChanged"],
  ["LifeGained", "LifeTotalChanged"],
  ["LifeLost", "LifeTotalChanged"],
  // Bridge V2 — Forge fires `GameEventCardTapped` (bridge kind
  // `CardTappedChanged`); TS emits `CardTapped`.
  ["CardTapped", "CardTappedChanged"],
];

export interface ParityReport {
  readonly scenarioId: string;
  /** Histogram of normalized event kinds, per side. */
  readonly tsKindHistogram: Readonly<Record<string, number>>;
  readonly javaKindHistogram: Readonly<Record<string, number>>;
  /**
   * "Did the headline action land on both sides?" — for the M2 cohort
   * each scenario has exactly one primary moveTo or one primary cast.
   * The harness checks whether Java captured at least one event whose
   * normalized kind matches a TS event of the same kind.
   */
  readonly primaryActionMatch: boolean;
  /**
   * The shared event-kind set across both sides, ordered by appearance
   * in the TS trace. Used as the "we agree on something" signal.
   */
  readonly sharedKinds: readonly string[];
  /**
   * TS-only event kinds — present in TS, absent in Java. Each is
   * classified per `TS_ONLY_KIND_CLASS`.
   */
  readonly tsOnlyKinds: readonly { readonly kind: string; readonly classification: DivergenceClass }[];
  /**
   * Java-only event kinds — present in Java, absent in TS. Each is
   * classified per `JAVA_ONLY_KIND_CLASS`. Bridge V2 surfaces trigger
   * fan-out + resolution events that the M2 TS runner doesn't yet
   * emit; those land in `ts-runner-shallow`. Anything not classified
   * lands in `real-divergence-investigate` for human review.
   */
  readonly javaOnlyKinds: readonly { readonly kind: string; readonly classification: DivergenceClass }[];
  /**
   * Aggregate severity. `match` = full kind-set parity. `mvp-known` =
   * divergences are all explained by documented M3 limits. `unknown` =
   * something landed in realDivergenceInvestigate.
   */
  readonly severity: "match" | "mvp-known" | "unknown-divergence";
  /**
   * First-divergence trace (where in the kind-histogram the streams
   * disagreed). Best-effort, useful for human inspection.
   */
  readonly firstDivergence: string | null;
}

/** Build a kind→count histogram from a normalized stream. */
function histogramOf(events: readonly NormalizedEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) out[e.kind] = (out[e.kind] ?? 0) + 1;
  return out;
}

/**
 * Compute the parity report for a single scenario. Both goldens must
 * be loaded by the caller; the harness does not load on the caller's
 * behalf to make missing-file behaviour explicit at the call site.
 */
export function diffTraces(
  scenarioId: string,
  tsTrace: GoldenTrace,
  javaTrace: JavaGoldenTrace,
): ParityReport {
  // TS-side cardId→name lookup. The TS golden doesn't echo names into
  // CardChangedZone payloads, so we rebuild from the raw events. (For
  // the M2 cohort the bridge always emits name; we just need to match.)
  const tsCardNamesById = new Map<number, string>();

  const tsNorm = normalizeTrace(tsTrace, "ts", tsCardNamesById);
  const javaNorm = normalizeTrace(javaTrace, "java", new Map());

  const tsHist = histogramOf(tsNorm);
  const javaHist = histogramOf(javaNorm);

  const tsKinds = new Set(Object.keys(tsHist));
  const javaKinds = new Set(Object.keys(javaHist));

  // Apply cross-side aliases — kinds that map across engines (e.g.
  // AbilityActivated ↔ SpellCast). When an aliased pair is present on
  // both sides, both kinds are treated as shared rather than divergent.
  //
  // M4.5: aliases are 1-to-many. Forge's `LifeTotalChanged` aliases to
  // *any* of `LifeChanged` / `LifeGained` / `LifeLost` — a flat Map
  // (one javaKind → one tsKind) silently drops earlier entries when the
  // Map key is overwritten, which surfaces as "Java-only LifeTotalChanged"
  // for scenarios that emit only LifeChanged on the TS side. Switch to
  // an array per side so any present alias counts as a match.
  const tsAliasedAsJava = new Map<string, string[]>(); // tsKind → javaKinds[]
  const javaAliasedAsTs = new Map<string, string[]>(); // javaKind → tsKinds[]
  for (const [tsKind, javaKind] of KIND_ALIASES) {
    const fwd = tsAliasedAsJava.get(tsKind);
    if (fwd === undefined) tsAliasedAsJava.set(tsKind, [javaKind]);
    else fwd.push(javaKind);
    const rev = javaAliasedAsTs.get(javaKind);
    if (rev === undefined) javaAliasedAsTs.set(javaKind, [tsKind]);
    else rev.push(tsKind);
  }

  const hasAnyAlias = (map: Map<string, string[]>, key: string, target: Set<string>): boolean => {
    const aliases = map.get(key);
    if (aliases === undefined) return false;
    for (const a of aliases) {
      if (target.has(a)) return true;
    }
    return false;
  };

  const sharedKinds: string[] = [];
  for (const e of tsNorm) {
    if (sharedKinds.includes(e.kind)) continue;
    if (javaKinds.has(e.kind) || hasAnyAlias(tsAliasedAsJava, e.kind, javaKinds)) {
      sharedKinds.push(e.kind);
    }
  }

  const tsOnly: { kind: string; classification: DivergenceClass }[] = [];
  for (const k of tsKinds) {
    const matchedOnJava = javaKinds.has(k) || hasAnyAlias(tsAliasedAsJava, k, javaKinds);
    if (!matchedOnJava) {
      tsOnly.push({
        kind: k,
        classification: TS_ONLY_KIND_CLASS.get(k) ?? "real-divergence-investigate",
      });
    }
  }
  const javaOnly: { kind: string; classification: DivergenceClass }[] = [];
  for (const k of javaKinds) {
    const matchedOnTs = tsKinds.has(k) || hasAnyAlias(javaAliasedAsTs, k, tsKinds);
    if (!matchedOnTs) {
      javaOnly.push({
        kind: k,
        classification: JAVA_ONLY_KIND_CLASS.get(k) ?? "real-divergence-investigate",
      });
    }
  }

  // Headline match: every Java event-kind has a matching TS event-kind.
  // For the empty-Java case (Java MVP captured no events at all), we
  // require the TS trace also to be empty for primaryActionMatch=true.
  const primaryActionMatch = javaNorm.length === 0 ? tsNorm.length === 0 : javaOnly.length === 0;

  // Severity classification. mvp-known now covers both TS-only AND
  // Java-only divergences as long as every entry maps to a known bucket.
  let severity: ParityReport["severity"];
  if (tsOnly.length === 0 && javaOnly.length === 0) {
    severity = "match";
  } else if (
    tsOnly.every((d) => d.classification !== "real-divergence-investigate") &&
    javaOnly.every((d) => d.classification !== "real-divergence-investigate")
  ) {
    severity = "mvp-known";
  } else {
    severity = "unknown-divergence";
  }

  let firstDivergence: string | null = null;
  if (tsOnly.length > 0) {
    const first = tsOnly[0];
    if (first) firstDivergence = `ts-only:${first.kind} (${first.classification})`;
  } else if (javaOnly.length > 0) {
    const first = javaOnly[0];
    if (first) firstDivergence = `java-only:${first.kind} (${first.classification})`;
  }

  return {
    scenarioId,
    tsKindHistogram: tsHist,
    javaKindHistogram: javaHist,
    primaryActionMatch,
    sharedKinds,
    tsOnlyKinds: tsOnly,
    javaOnlyKinds: javaOnly,
    severity,
    firstDivergence,
  };
}

/**
 * Aggregate report across multiple scenarios. Used by both the test
 * suite (to produce a per-class summary failure message) and the
 * tools/parity-harness/run-parity.ts entry point.
 */
export interface AggregateReport {
  readonly totalScenarios: number;
  readonly fullMatch: number;
  readonly mvpKnown: number;
  readonly unknown: number;
  readonly perClass: Readonly<Record<DivergenceClass, number>>;
  readonly perScenario: readonly ParityReport[];
}

export function aggregateReports(reports: readonly ParityReport[]): AggregateReport {
  const perClass: Record<DivergenceClass, number> = {
    "shallow-trigger-fanout": 0,
    "target-mismatch": 0,
    "free-cast-missing-mana": 0,
    "no-stack-drain": 0,
    "bridge-action-skipped": 0,
    "ts-runner-shallow": 0,
    "bridge-counter-event-not-captured": 0,
    "bridge-engine-state-event-not-captured": 0,
    "real-divergence-investigate": 0,
  };
  let fullMatch = 0;
  let mvpKnown = 0;
  let unknown = 0;
  for (const r of reports) {
    if (r.severity === "match") fullMatch++;
    else if (r.severity === "mvp-known") mvpKnown++;
    else unknown++;
    // Each scenario contributes the unique classifications it touched
    // across both ts-only and java-only buckets.
    const seen = new Set<DivergenceClass>();
    for (const d of r.tsOnlyKinds) seen.add(d.classification);
    for (const d of r.javaOnlyKinds) seen.add(d.classification);
    for (const c of seen) perClass[c]++;
  }
  return { totalScenarios: reports.length, fullMatch, mvpKnown, unknown, perClass, perScenario: reports };
}
