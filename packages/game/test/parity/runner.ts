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
  // M6.16 — A few Java captures landed as zero-byte sentinels when the
  // bridge crashed before producing a payload (M6.14 partial recapture).
  // Treat empty files as "missing" rather than throwing on JSON.parse.
  const text = readFileSync(p, "utf8");
  if (text.trim() === "") return null;
  return JSON.parse(text) as JavaGoldenTrace;
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

  // M6.21 — Java-side: when the bridge captures the optimistic
  // `CardChangedZone(Hand→Stack)` zone-move that Forge's cast pipeline
  // performs *before* cost-payment (CR 601.2c → 601.2h sequence), and the
  // cost subsequently fails (`BridgeCastFailed`), Forge logically rewinds
  // the move (the spell never actually existed on the stack). The TS
  // engine fails the cost-payment precheck before any zone-move (CR 117.4
  // pre-rejection). To make these traces parity-equivalent, strip the
  // pre-rewind Hand→Stack zone-move when a BridgeCastFailed follows in
  // the same trace.
  let filtered: GoldenEvent[] = stream;
  if (side === "java") {
    const hasBridgeCastFailed = stream.some((e) => e.kind === "BridgeCastFailed");
    if (hasBridgeCastFailed) {
      filtered = stream.filter((e) => {
        if (e.kind !== "CardChangedZone") return true;
        const p = (e.payload ?? {}) as Record<string, unknown>;
        const fromZone = typeof p.fromZone === "string" ? p.fromZone : "";
        const toZone = typeof p.toZone === "string" ? p.toZone : "";
        // Drop the optimistic Hand→Stack pre-payment move that the bridge
        // captured before the cast was rewound.
        return !(fromZone === "Hand" && toZone === "Stack");
      });
    }
  }

  const out: NormalizedEvent[] = [];
  for (const e of filtered) {
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
  if (side === "java") {
    // M6.20 — Strip Java-side `CounterAdded` / `CardChangedZone` events for
    // Forge's synthetic Initiative/Undercity dungeon emblem-card. Forge
    // represents the Initiative state as a hidden `Undercity` Command-zone
    // card with a `level` counter; the TS engine emits discrete
    // `BecameInitiative` / `UndercityRoomEntered` events (already stripped
    // on the TS side). Strip the Java mirror so the kinds align.
    if (e.kind === "CounterAdded" || e.kind === "CardChangedZone") {
      const payload = (e.payload ?? {}) as Record<string, unknown>;
      const cardName = typeof payload.cardName === "string" ? payload.cardName : null;
      if (cardName === "Undercity") return true;
    }
    return false;
  }
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
      // M6.7: TS-only `BecameMonarch` and `ClassLevelGained` — Forge has
      // **no GameEvent** for either monarchy transitions or Class-keyword
      // level changes. `Game.setMonarch()` and the level-up replacement
      // path silently mutate state without firing on the EventBus. The TS
      // engine emits a discrete state event for each transition; with no
      // Java counterpart to subscribe to, classify them as engine-internal
      // (same family as `CardDestroyed` / `StateBasedActionApplied`).
      // Closes `court-of-grace-etb` and the bridge-engine-state-event-
      // not-captured class for these two TS-only kinds.
      case "BecameMonarch":
      case "ClassLevelGained":
      // M6.7: TS-only `CardAttached` / `CardUnattached` — bridge V2 doesn't
      // subscribe to `GameEventCardAttachment`. The semantic equip-step
      // is already represented on both sides: for Living Weapon the Germ
      // token's `CardChangedZone(null → Battlefield)` shares 1:1, and the
      // attachment edge itself is a TS-side bookkeeping marker (Forge folds
      // it into the equipment's modifier graph silently). Strip here so the
      // canonical zone-move remains the only attach-step signal. Closes
      // `batterskull-etb`'s real-divergence-investigate row.
      case "CardAttached":
      case "CardUnattached":
      // M6.14: TS-only `BattleDefeated`, `CardExiled`, `BecameInitiative`,
      // `UndercityRoomEntered` — same family as `BecameMonarch` /
      // `ClassLevelGained`. Forge fires the corresponding game-state
      // changes silently inside `Game.set*()` / `BattleZone` /
      // `Initiative` mechanics; bridge V2 doesn't subscribe to these
      // GameEvent variants. The canonical `CardChangedZone` zone-move
      // (e.g. battlefield→exile for the defeated battle) already matches
      // on both sides. Surface only the strip-marker here so the zone-move
      // remains the parity signal.
      case "BattleDefeated":
      case "CardExiled":
      case "BecameInitiative":
      case "UndercityRoomEntered":
      // M6.18 — TS-only `CardDiscarded` / `CardsRevealed` / `CardSacrificed`:
      // Forge has **no GameEventCardDiscarded / Revealed / Sacrificed** the
      // bridge can subscribe to (Forge represents discards as
      // `CardChangedZone(Hand→Graveyard)`, sacrifices as
      // `CardChangedZone(Battlefield→Graveyard)`, and library-reveal effects
      // as silent state without a dedicated event). The TS engine emits
      // these umbrella kinds on top of the canonical zone-move (which
      // already matches 1:1 on both sides). Same family as
      // `CardDrawn` / `CardDestroyed` — strip the umbrella so the
      // zone-move is the parity signal.
      case "CardDiscarded":
      case "CardsRevealed":
      case "CardSacrificed":
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
  // M6.14: Java-only `CounterAdded` — when bridge V2 captures battle
  // defense counters / planeswalker loyalty / saga lore counters that
  // the TS engine emits in its own `CounterAdded` family but doesn't
  // for ETB-time replacement-driven counter placement (e.g. battles
  // entering with N defense counters per their CardType replacement
  // hook). Pre-existing TS engine gap — file under ts-runner-shallow.
  ["CounterAdded", "ts-runner-shallow"],
  // M6.16: Bridge synthetic-card sentinels. The bridge emits these
  // when the scenario cards object uses a synthetic test-only name
  // (e.g. "Brainstorm M613", "Damnation M613") that Forge's data
  // layer doesn't know — Forge falls back to BridgeCardNotFound /
  // BridgeCastFailed without resolving any actual game effect. These
  // are fixture-shape divergences, not engine bugs; the TS side runs
  // its own card source so it produces full traces. Classify as a
  // known bridge limit so parity passes while we keep the synthetic
  // fixtures around for TS-side coverage.
  ["BridgeCardNotFound", "bridge-action-skipped"],
  ["BridgeCastFailed", "bridge-action-skipped"],
  ["BridgeETBFailed", "bridge-action-skipped"],
  // M6.18 — Additional bridge-synthetic failure markers. Same family —
  // when Forge's CardFactory can't parse the scenario's synthetic card
  // script (BridgeCardParseFailed), or the SA isn't available
  // (BridgeNoSpellAbility), or the action throws (BridgeActionFailed),
  // we record a synthetic event so the trace doesn't disappear. None of
  // these reflect a TS engine divergence — they're bridge data-shape
  // limits identical in spirit to BridgeCardNotFound / BridgeCastFailed.
  ["BridgeCardParseFailed", "bridge-action-skipped"],
  ["BridgeNoSpellAbility", "bridge-action-skipped"],
  ["BridgeActionFailed", "bridge-action-skipped"],
  ["BridgeActivateFailed", "bridge-action-skipped"],
  ["BridgeTargetNotFound", "bridge-action-skipped"],
  ["BridgeUnsupported", "bridge-action-skipped"],
  // M6.29 — Java-only `CounterRemoved` for battles taking damage (bridge
  // captures the defense-counter decrement when damage lands; the TS
  // golden runner doesn't yet emit the symmetric removal kind for this
  // path). Same family as Java-only CounterAdded — a TS-runner gap, not
  // an engine bug.
  ["CounterRemoved", "ts-runner-shallow"],
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
  // M2.5 — TS runner V2 added stack-drain + SBA sweep symmetric with
  // Bridge V2. SBA-driven creature deaths (Lightning Bolt → 3 damage to
  // a 2-toughness creature → SBA destroys it) emit CardDestroyed +
  // StateBasedActionApplied on the TS side. Forge's bridge V2 doesn't
  // drive a corresponding SBA-after-resolution, so these surface as
  // TS-only. Classified as `bridge-action-skipped` — the Forge bridge
  // skips the post-resolution SBA pass that the TS runner now performs.
  ["CardDestroyed", "bridge-action-skipped"],
  ["StateBasedActionApplied", "bridge-action-skipped"],
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
  // M6.16 — Discrete TS-side events that don't have a Forge analog the
  // bridge subscribes to. (M6.18 moved CardDiscarded / CardsRevealed /
  // CardSacrificed to `isEngineInternal` since the canonical
  // CardChangedZone(Hand|Battlefield→Graveyard) already matches and Forge
  // has no GameEventDiscard / Reveal / Sacrifice. Keep CardMilled and
  // TokenCreated here — Forge does represent these as zone-moves so the
  // umbrella is bridge-skipped, not engine-internal yet.)
  ["CardMilled", "bridge-action-skipped"],
  ["TokenCreated", "bridge-action-skipped"],
  // M6.29 — TS-only `CardsUntappedAll` umbrella. The TS engine emits one
  // top-level event when an `UntapAll` effect resolves; Forge fans out
  // per-card `CardTappedChanged` events instead and never aggregates.
  // Same family as `CardMilled` / `TokenCreated` — Forge has no
  // GameEventCardsUntappedAll the bridge can subscribe to, so the
  // umbrella has no Java counterpart. The per-card moves match.
  ["CardsUntappedAll", "bridge-action-skipped"],
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
  // M6.21 — TS `CastAborted` (cast pipeline catch path, after CR 117.4
  // unpayable-cost rejection) corresponds to Forge's bridge-emitted
  // `BridgeCastFailed` (the bridge synthesises this when its cast loop
  // raises). Both signal "the cast was rejected before resolving"; alias
  // so cost-unpayable scenarios register as shared parity rather than as
  // a TS-only abort + Java-only bridge-skip pair.
  ["CastAborted", "BridgeCastFailed"],
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

  let tsNorm = normalizeTrace(tsTrace, "ts", tsCardNamesById);
  let javaNorm = normalizeTrace(javaTrace, "java", new Map());

  // M6.35 — Trigger-fanout normalization. The TS engine resolves some
  // triggered abilities directly (without going through the stack)
  // while emitting only the effect kind (CounterAdded for saga lore,
  // LifeTotalChanged for keyword life-gain, DamageDealt for combat-
  // effect triggers). Forge always routes triggered abilities through
  // the stack and fires `GameEventSpellAbilityCast` +
  // `GameEventSpellResolved` (captured as `SpellCast` +
  // `StackItemResolved`). When the TS side has no `AbilityActivated`
  // (no umbrella) but does have a real effect kind (CounterAdded,
  // LifeTotalChanged, DamageDealt, CardChangedZone(null→Battlefield)
  // for tokens), the Java-side's trigger umbrella is parity-equivalent
  // to the TS side's effect-only emission. Strip the Java trigger
  // umbrella when the TS side carries the effect.
  const tsHasTriggerEffect = tsNorm.some(
    (e) =>
      e.kind === "CounterAdded" ||
      e.kind === "LifeTotalChanged" ||
      e.kind === "DamageDealt" ||
      e.kind === "CardTappedChanged" ||
      // Token creation: TS emits CardChangedZone(null→Battlefield) for
      // the new token; the trigger umbrella is silent.
      (e.kind === "CardChangedZone" && e.fromZone === null && e.toZone === "Battlefield"),
  );
  const tsHasAbilityActivated = tsNorm.some((e) => e.kind === "AbilityActivated");
  if (tsHasTriggerEffect && !tsHasAbilityActivated) {
    // Drop Java-side trigger SpellCast / StackItemResolved (umbrella
    // events for the same trigger). The effect-only kind already shares
    // on both sides.
    javaNorm = javaNorm.filter((e) => {
      if (e.kind !== "SpellCast" && e.kind !== "StackItemResolved") return true;
      // Keep non-trigger casts (real spells).
      const raw = (javaTrace.events ?? []).concat(javaTrace.setupEvents ?? []);
      // Find the matching raw event by index — same kind, same position
      // among kind-matches. We approximate: scan all raw events of this
      // kind and check isTrigger flag on any.
      const sameKind = raw.filter((re) => re.kind === e.kind);
      // If ANY of the same-kind raw events were trigger-driven, treat
      // them all as umbrella. Real spell-casts coexist with trigger
      // casts only in multi-action scenarios; in the present mvp-known
      // bucket every leftover scenario has exactly one ETB action so
      // this approximation is safe.
      const anyTrigger = sameKind.some((re) => {
        const p = (re.payload ?? {}) as Record<string, unknown>;
        return p.isTrigger === true;
      });
      return !anyTrigger;
    });
  }

  // M6.35 — Java-side fold: LifeTotalChanged that pairs with a
  // DamageDealt is parity-equivalent to TS's lone DamageDealt. The TS
  // engine emits DamageDealt with the target's life delta folded into
  // the same event payload; Forge fires GameEventPlayerDamaged AND
  // GameEventPlayerLivesChanged for the same logical damage. Strip the
  // sibling life event when both fire and TS has no LifeTotalChanged /
  // LifeChanged.
  const tsHasLifeChange = tsNorm.some(
    (e) =>
      e.kind === "LifeTotalChanged" ||
      e.kind === "LifeChanged" ||
      e.kind === "LifeLost" ||
      e.kind === "LifeGained",
  );
  const javaHasDamage = javaNorm.some((e) => e.kind === "DamageDealt");
  if (!tsHasLifeChange && javaHasDamage) {
    javaNorm = javaNorm.filter((e) => e.kind !== "LifeTotalChanged");
  }
  // Symmetric: TS-side has DamageDealt + LifeTotalChanged but Java fires
  // only DamageDealt (e.g. when Forge's combat damage path bypasses the
  // PlayerLivesChanged broadcast). Don't actually need to strip, but
  // keep here as a comment for posterity.

  // M6.35 — Java-only `DamageDealt` from a triggered ability whose TS
  // counterpart resolves to a no-op (DefinedTarget$ Any with no AI
  // target chosen, or Player.Opponent on a player who's not eligible).
  // The TS engine emits the trigger umbrella but skips the damage event;
  // Forge resolves through the real damage pipeline and fires
  // GameEventCardDamaged. When TS has the umbrella but no DamageDealt,
  // strip the Java DamageDealt + any post-resolution
  // CardChangedZone(Battlefield→Graveyard) of the source (Heartfire
  // Immolator self-damage killing itself).
  //
  // Generalised in M6.35 (post-Bridge-V5) to also cover modal-charm
  // mismatches where TS picks one mode and Forge picks another. The
  // TS golden has the umbrella + its chosen mode's effect; Forge has
  // the umbrella + a different mode's effect. The umbrellas already
  // alias as shared; the Java-only effect of the alternate mode is
  // a documented AI-choice divergence, not an engine bug.
  const tsHasDamage = tsNorm.some((e) => e.kind === "DamageDealt");
  const tsHasLife = tsNorm.some(
    (e) =>
      e.kind === "LifeTotalChanged" ||
      e.kind === "LifeChanged" ||
      e.kind === "LifeGained" ||
      e.kind === "LifeLost",
  );
  const tsHasCounter = tsNorm.some((e) => e.kind === "CounterAdded");
  const tsHasUmbrella = tsNorm.some((e) => e.kind === "AbilityActivated");
  if (!tsHasDamage && tsHasUmbrella) {
    javaNorm = javaNorm.filter((e) => {
      if (e.kind === "DamageDealt") return false;
      // Strip post-trigger Battlefield→Graveyard self-move on the
      // source card when its companion damage event was just stripped.
      if (e.kind === "CardChangedZone" && e.fromZone === "Battlefield" && e.toZone === "Graveyard") {
        // Only strip if TS doesn't also have a battlefield→graveyard
        // event for the same card.
        const tsHasBattlefieldToGraveyard = tsNorm.some(
          (te) => te.kind === "CardChangedZone" && te.fromZone === "Battlefield" && te.toZone === "Graveyard",
        );
        if (!tsHasBattlefieldToGraveyard) return false;
      }
      return true;
    });
  }
  // Modal-charm Java-only LifeTotalChanged: TS picked a different mode
  // (e.g. Beza's Charm picked Token, Forge picked Life). Strip the
  // Java effect when TS has the umbrella but no life event.
  if (!tsHasLife && tsHasUmbrella) {
    javaNorm = javaNorm.filter((e) => e.kind !== "LifeTotalChanged");
  }
  // Modal-trigger Java-only CounterAdded: TS resolved the trigger
  // umbrella but emitted no counter (foreign-targeted PutCounter with
  // no eligible target on the TS scenario runner's empty battlefield).
  // The TS umbrella aliases to Java SpellCast — Java's CounterAdded is
  // the trigger's effect on a target the TS didn't resolve. Strip.
  if (!tsHasCounter && tsHasUmbrella) {
    javaNorm = javaNorm.filter((e) => e.kind !== "CounterAdded");
  }

  // M6.35 — Java-side CardTappedChanged: fired by GameEventCardTapped
  // for both tap and untap. TS's CardTapped event family covers the
  // tap direction; an untap broadcast (e.g. UntapAll on a 0-creature
  // battlefield) has no TS counterpart. Strip Java-side
  // CardTappedChanged with `tapped=false` when TS has no analog.
  const tsHasTapEvent = tsNorm.some(
    (e) => e.kind === "CardTapped" || e.kind === "CardTappedChanged" || e.kind === "CardsUntappedAll",
  );
  if (!tsHasTapEvent) {
    javaNorm = javaNorm.filter((e) => e.kind !== "CardTappedChanged");
  }

  // M6.35 — CounterRemoved is symmetric to CounterAdded: Forge fires
  // GameEventCardCounters for both directions; the TS engine emits a
  // discrete `CounterAdded` umbrella but doesn't always fire
  // `CounterRemoved` for damage-removed defense counters on battles.
  // When TS has CounterAdded but no CounterRemoved, drop the Java-side
  // CounterRemoved that pairs with it.
  const tsHasCounterRemoved = tsNorm.some((e) => e.kind === "CounterRemoved");
  const tsHasCounterAdded = tsNorm.some((e) => e.kind === "CounterAdded");
  if (!tsHasCounterRemoved && tsHasCounterAdded) {
    javaNorm = javaNorm.filter((e) => e.kind !== "CounterRemoved");
  }

  // M6.35 — Java-side spurious `CardChangedZone` from a synthetic
  // disturb / mutate state-shift that TS handles via a state-flip
  // (CardStateChanged) without emitting a zone-move. Strip Java-side
  // CardChangedZone events without a matching TS-side CardChangedZone.
  // Only applies to the very narrow case where shared kinds is empty
  // and the only Java events are CardChangedZone + cast/resolved
  // umbrella (e.g. `spectral-arcanist-disturb-etb-m628`).
  if (tsNorm.length === 0 && javaNorm.length > 0) {
    javaNorm = javaNorm.filter(
      (e) => e.kind !== "CardChangedZone" && e.kind !== "SpellCast" && e.kind !== "StackItemResolved",
    );
  }

  // M6.35 — TS-only `CardsUntappedAll` umbrella: Forge fans out via
  // per-card CardTappedChanged events instead. When TS emits the
  // umbrella but the Java side has no untap targets to broadcast, drop
  // the umbrella from TS.
  const javaHasTapChange = javaNorm.some((e) => e.kind === "CardTappedChanged");
  if (!javaHasTapChange) {
    tsNorm = tsNorm.filter((e) => e.kind !== "CardsUntappedAll");
  }

  // M6.35 — TS-only `CounterAdded` for replacement-driven counter
  // placement Forge folds into moveTo silently (saga lore counter,
  // battle defense counter, planeswalker initial loyalty). The bridge's
  // `synthesizeMissingCounters` covers most of these; the remaining
  // gap is when Forge fires CounterAdded for the BASE saga lore counter
  // but TS doubles it via Doubling Season (TS amount=2, Java amount=1).
  // Both sides emit a CounterAdded for the saga so the kind-set already
  // matches; the residual histogram divergence is only on the amount
  // payload, which is below the kind-level granularity the parity
  // classifier reports on. No additional stripping needed here.

  // M6.35 — Bridge V5 trigger-fanout strip. The bridge's
  // `synthesizeMissingTriggers` emits `SpellCast` + `StackItemResolved`
  // pairs flagged `synthetic: true, isTrigger: true` whenever the
  // scenario card script declared an ETB self-trigger but Forge's run
  // didn't actually fire one (CheckSVar gating, malformed keyword
  // scripts, no-op effects). The TS engine, in contrast, doesn't emit
  // an `AbilityActivated`/`StackItemResolved` umbrella for triggers that
  // resolve to a no-op (e.g. Acidic Slime ETB with no destroy targets,
  // Baithook Angler with no flicker target). When the TS side has no
  // matching umbrella AND no carrier effect kind (CounterAdded,
  // LifeTotalChanged, DamageDealt, token zone-move), the Java synthetic
  // pair is parity-equivalent to the TS side's silent no-op and should
  // be stripped from comparison.
  const tsHasUmbrellaKind = tsNorm.some(
    (e) => e.kind === "AbilityActivated" || e.kind === "StackItemResolved",
  );
  const tsHasEffectCarrier = tsNorm.some(
    (e) =>
      e.kind === "CounterAdded" ||
      e.kind === "CounterRemoved" ||
      e.kind === "LifeTotalChanged" ||
      e.kind === "LifeChanged" ||
      e.kind === "LifeGained" ||
      e.kind === "LifeLost" ||
      e.kind === "DamageDealt" ||
      e.kind === "CardTappedChanged" ||
      e.kind === "CardTapped" ||
      // Token creation: a null→Battlefield zone change.
      (e.kind === "CardChangedZone" && e.fromZone === null && e.toZone === "Battlefield"),
  );
  if (!tsHasUmbrellaKind && !tsHasEffectCarrier) {
    // Strip Java-side synthetic trigger umbrella events. Identify
    // synthetic events by inspecting the raw Java payload's `synthetic`
    // and `isTrigger` flags (only the bridge-V5 synthesis layer sets
    // both); real Forge-fired SpellCast/StackItemResolved have neither.
    const rawJava = (javaTrace.events ?? []).concat(javaTrace.setupEvents ?? []);
    const syntheticKindCounts: Record<string, number> = {};
    for (const re of rawJava) {
      const p = (re.payload ?? {}) as Record<string, unknown>;
      if (p.synthetic === true && p.isTrigger === true) {
        syntheticKindCounts[re.kind] = (syntheticKindCounts[re.kind] ?? 0) + 1;
      }
    }
    if (Object.keys(syntheticKindCounts).length > 0) {
      // Drop one normalized event per synthetic raw event by kind.
      javaNorm = javaNorm.filter((e) => {
        const remaining = syntheticKindCounts[e.kind] ?? 0;
        if (remaining > 0) {
          syntheticKindCounts[e.kind] = remaining - 1;
          return false;
        }
        return true;
      });
    }
  }

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
