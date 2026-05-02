// SPDX-License-Identifier: GPL-3.0-or-later
// ChapterKeywordHandler — processes K:Chapter:N:DB1,DB2,...,DBN keyword
// lines (Dominaria, CR 714) and synthesizes the Saga lore-counter
// machinery.
//
// CR 714.2  — As a Saga enters the battlefield, its controller puts a
//             lore counter on it.
// CR 714.3  — After your draw step, you put a lore counter on each Saga
//             you control (turn-based action).
// CR 714.4  — Whenever one or more lore counters are put onto a Saga,
//             its chapter ability with that lore counter total triggers.
// CR 704.5v — If a Saga's number of lore counters is greater than or
//             equal to its final chapter number, and it has no chapter
//             abilities on the stack, its controller sacrifices it.
//             (sba-engine.ts already implements this read against
//             card.sagaFinalChapterResolved.)
//
// DSL form:
//   K:Chapter:3:DBToken,DBToken,DBPump
//
// The keyword-line parser stores the payload under params.detail as the
// literal "3:DBToken,DBToken,DBPump". This handler:
//   1. Adds "chapter" to card.keywords. Stamps card.sagaChapterCount = N
//      and card.sagaChapterSVars = [DB1,...,DBN] for inspection.
//   2. Synthesizes a CardChangedZone-to-Battlefield trigger that, on
//      ETB, adds 1 Lore counter (CR 714.2b).
//   3. Synthesizes a StepStarted{Main1, controller}-trigger that adds
//      1 Lore counter at the start of the controller's precombat main
//      (Forge's "after your draw step" turn-based action — modeled as a
//      Main1-start trigger so it interleaves correctly with regular
//      triggered abilities).
//   4. Synthesizes a CounterAdded watcher: when the new total of Lore
//      counters on this card equals the final chapter number N, set
//      card.sagaFinalChapterResolved = true so the SBA engine
//      (sba/saga-class.ts) sacrifices the saga at the next sweep.
//
// Wave 94 — per-chapter SVar dispatch (resolving DB1..DBN as their printed
// chapter abilities) is now closed: when the CounterAdded watcher fires,
// it looks up the SVar named `sagaChapterSVars[total - 1]` on the source
// card's PaperCard.definition.svars (mirrors RepeatEachEffect's pattern)
// and yields the synthesized SpellAbility's resolver. The final-chapter
// flag is still set so the SBA sweep handles sacrifice on top of this.
import type {
  AbilityAst,
  EntityId,
  GameEvent,
  KeywordAst,
  ParamValue,
  PhaseStep,
  PlayerSeat,
  SVarAst,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { CounterType, ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

/**
 * Parse the Chapter detail string. Form: "N:DB1,DB2,...,DBN" or
 * "N" (no SVar names). Returns chapterCount + svar names. Defensive
 * against malformed inputs (returns count=0 + empty list).
 */
const parseChapterDetail = (raw: string): { count: number; svars: readonly string[] } => {
  if (raw === "") return { count: 0, svars: [] };
  const colonIdx = raw.indexOf(":");
  if (colonIdx < 0) {
    const n = Number.parseInt(raw, 10);
    return { count: Number.isFinite(n) ? n : 0, svars: [] };
  }
  const head = raw.slice(0, colonIdx);
  const tail = raw.slice(colonIdx + 1);
  const n = Number.parseInt(head, 10);
  const count = Number.isFinite(n) ? n : 0;
  const svars =
    tail === ""
      ? []
      : tail
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
  return { count, svars };
};

export class ChapterKeywordHandler extends KeywordHandler {
  static override readonly keyword = "chapter" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("chapter");

    const detailParam = ast.params?.detail as ParamValue | undefined;
    const detailRaw = detailParam && detailParam.kind === "literal" ? (detailParam.raw as string) : "";
    const { count, svars } = parseChapterDetail(detailRaw);
    card.sagaChapterCount = count;
    card.sagaChapterSVars = svars;

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;

    // M6.20 — CR 714.2b ("As a Saga enters the battlefield, its controller
    // puts a lore counter on it.") is a replacement effect in Forge, NOT
    // a triggered ability. Mirror by stamping `etbCounterSpecs`; the
    // ETB pipeline (game-action.ts#applyEtbStamping) consumes the slot
    // before any triggered ability would see the card. This eliminates
    // the AbilityActivated/StackItemResolved pair the prior trigger-shaped
    // implementation emitted on each Saga ETB.
    //
    // Forge reference: CardState.java:765-770 — for any Saga without
    // Read-ahead, `sagaRep = CardFactoryUtil.makeEtbCounter("etbCounter:LORE:1", …)`
    // is added to the card's replacement effect set.
    //
    // Read-ahead path (CR 714.4d): the counter amount is a controller
    // choice in [1..finalChapterNr]. Forge encodes this as a separate
    // replacement (`Read ahead` in CardFactoryUtil.java:2453-2468) with
    // `UpTo$ True` + `UpToMin$ 1`. Since the TS etbCounterSpecs slot has
    // no decision-yield consumer, Read-ahead Sagas keep a triggered
    // ETB so the chooser can yield. The trigger is registered ALWAYS
    // (handlers may apply Read ahead before or after Chapter — keyword
    // line ordering is not guaranteed). The trigger's `matches` returns
    // false when `card.readAhead !== true`, so non-Read-ahead Sagas
    // never enqueue the trigger and stay silent.
    const slot = card as unknown as {
      etbCounterSpecs?: Array<{
        readonly counterType: CounterType;
        readonly amount: number;
        readonly variable: boolean;
      }>;
    };
    if (!slot.etbCounterSpecs) slot.etbCounterSpecs = [];
    slot.etbCounterSpecs.push({
      counterType: CounterType.Lore,
      amount: 1,
      variable: false,
    });

    // Trigger 1 — ETB Lore counter (Read-ahead branch only). The
    // matches() gate keeps the trigger inert for non-Read-ahead Sagas.
    // CR 714.4d — controller picks a chapter [1..N]; place that many
    // Lore counters. The etbCounterSpecs slot already added 1 silently,
    // so this trigger places (chosen - 1) ADDITIONAL counters when fired.
    const etbId = game.newEntityId();
    const etb: TriggeredAbilityWithResolver = {
      id: etbId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "CardChangedZone") return false;
        const p = event.payload as { cardId: EntityId; toZone: ZoneType };
        if (p.cardId !== sourceCardId || p.toZone !== ZoneType.Battlefield) return false;
        // Read-ahead gate — only fires when the Saga has Read ahead.
        // Non-Read-ahead Sagas use etbCounterSpecs (silent replacement)
        // exclusively; the trigger stays dormant.
        const c = game.cards.get(sourceCardId);
        return c?.readAhead === true;
      },
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const c = g.cards.get(sourceCardId);
          if (!c) return;
          // Idempotency guard: if the Saga already has Lore counters
          // beyond the bare etbCounterSpecs default (blink loop / re-entry
          // stamp from a prior chapter advance), do not yield chooseNumber
          // and do not add more. The presence of any Lore > 0 prior to
          // this resolver firing means the etbCounterSpecs slot ALREADY
          // ran and we're past the "as it enters" choice window.
          const existing = c.counters.get(CounterType.Lore) ?? 0;
          if (existing > 0) return;
          let amount = 1;
          const maxChapter = c.sagaChapterCount ?? 0;
          if (maxChapter >= 1) {
            const response = (yield {
              kind: "decision",
              request: {
                kind: "chooseNumber",
                sourceId: sourceCardId,
                min: 1,
                max: maxChapter,
              },
            }) as { readonly kind?: string; readonly chosen?: number } | undefined;
            if (response && response.kind === "chooseNumber" && typeof response.chosen === "number") {
              const chosen = response.chosen;
              if (Number.isFinite(chosen) && chosen >= 1 && chosen <= maxChapter) {
                amount = Math.floor(chosen);
              }
            }
          }
          yield* g.action.addCounter(sourceCardId, CounterType.Lore, amount, sourceCardId);
        },
      },
    };
    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(etb as unknown as TriggeredAbility);
    game.triggerRegistry.register(etb as unknown as TriggeredAbility);

    // Trigger 2 — Main1 start on controller's turn: +1 Lore counter.
    // Forge's "after your draw step" turn-based action is modeled as a
    // start-of-Main1 trigger; the timing matches CR 714.3 closely enough
    // for the durable contract (chapter abilities still resolve before
    // any non-trigger main-phase priority window).
    const main1Id = game.newEntityId();
    const main1: TriggeredAbilityWithResolver = {
      id: main1Id,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "StepStarted") return false;
        const { step, activeSeat } = event.payload as { step: PhaseStep; activeSeat: PlayerSeat };
        if (step !== ("Main1" as PhaseStep)) return false;
        const c = game.cards.get(sourceCardId);
        if (!c) return false;
        return activeSeat === c.controllerSeat;
      },
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const c = g.cards.get(sourceCardId);
          if (!c) return;
          yield* g.action.addCounter(sourceCardId, CounterType.Lore, 1, sourceCardId);
        },
      },
    };

    // Trigger 3 — CounterAdded watcher: detect final-chapter resolution.
    // When the new total of Lore counters on this Saga equals N, stamp
    // sagaFinalChapterResolved = true so the next SBA sweep sacrifices.
    // Wave 94 — also dispatch the per-chapter SVar (DB1..DBN) at the
    // matching count so each printed chapter ability resolves once. The
    // SVar name lives at `sagaChapterSVars[total - 1]`; we look it up on
    // the source's PaperCard.definition.svars (kind="ability"), build a
    // SpellAbility from its EffectInvocation, and yield* its resolver.
    const watcherId = game.newEntityId();
    const watcher: TriggeredAbilityWithResolver = {
      id: watcherId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "CounterAdded") return false;
        const p = event.payload as { cardId: EntityId; counterType: string };
        if (p.cardId !== sourceCardId) return false;
        if (p.counterType !== (CounterType.Lore as string)) return false;
        // M6.33 — Stay inert when there's no work to do. The watcher exists
        // both to dispatch chapter SVars (DB1..DBN) and to flip
        // `sagaFinalChapterResolved` for the SBA sacrifice sweep. When a
        // saga has neither chapter SVars NOR a chapter count, skip the
        // fire entirely so explicit chapter triggers carry the load alone.
        const c = game.cards.get(sourceCardId);
        if (!c) return false;
        const target = c.sagaChapterCount ?? 0;
        const svarNames = c.sagaChapterSVars ?? [];
        if (svarNames.length === 0 && target === 0) return false;
        // M6.34 — Two cases for the watcher fire window during ETB:
        //
        // 1) Real Forge K:Chapter:N:DB1,...,DBN cards (history-of-benalia,
        //    fable-of-the-mirror-breaker, etc.): Forge's CardFactoryUtil
        //    generates per-chapter implicit Mode$ CounterAdded triggers.
        //    These triggers fire on the ETB lore counter add and are
        //    observable in the Java golden trace (SpellCast +
        //    StackItemResolved for chapter I). The TS watcher is the
        //    equivalent dispatch — it must fire on the ETB lore add too.
        //
        // 2) Synthetic test sagas with K:Chapter:N (no DBs) + explicit
        //    T:Mode$ CounterAdded triggers (mending-of-dominaria-m627,
        //    welcome-to-skys-end, etc.): Forge's CardFactoryUtil parser
        //    throws on the missing DB list, so no implicit triggers
        //    register; the explicit T: triggers ARE visible to ETB lore
        //    add via the CR 614 replacement window. But on Java, the
        //    visible chapter trigger is suppressed in the ETB window
        //    (Forge CR 614 replacement applies BEFORE explicit triggers
        //    register from the just-entered card). Java traces show only
        //    CounterAdded + ZoneMove for these synthetic sagas. The TS
        //    watcher must NOT fire when there's no SVar to dispatch (no
        //    DBs) — its only side effect would be flipping
        //    sagaFinalChapterResolved, which the SBA sweep handles
        //    independently on the precombat-main lore tick.
        //
        // Gate: fire only when there's a chapter SVar to dispatch for the
        // current lore total. Forge silently suppresses chapter triggers
        // when the K:Chapter:N:DB1,DB2,... line names DBs that aren't
        // actually defined on the card (synthetic test scenarios sometimes
        // use placeholder DB names without SVar:DB1 entries).
        if (svarNames.length === 0) return false;
        const lore = c.counters.get(CounterType.Lore) ?? 0;
        if (lore < 1 || lore > svarNames.length) return false;
        const svarName = svarNames[lore - 1];
        if (svarName === undefined) return false;
        const cardSvars = c.paperCard.definition?.svars as ReadonlyMap<string, SVarAst> | undefined;
        if (cardSvars !== undefined) {
          const sv = cardSvars.get(svarName);
          if (!sv || sv.kind !== "ability" || !sv.ability) return false;
        }
        return true;
      },
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const c = g.cards.get(sourceCardId);
          if (!c) return;
          const total = c.counters.get(CounterType.Lore) ?? 0;
          const target = c.sagaChapterCount ?? 0;

          // Wave 94 — per-chapter SVar dispatch. Look up the chapter
          // ability for this lore count (1-based: total=1 → svars[0]).
          // Mirrors RepeatEachEffect's pattern: build a fakeAst over
          // the SVar's EffectInvocation, instantiate a SpellAbility,
          // and yield* its resolver. Guards against missing/stale SVar
          // entries (graceful no-op on lookup failure).
          const svarNames = c.sagaChapterSVars ?? [];
          if (total >= 1 && total <= svarNames.length) {
            const svarName = svarNames[total - 1];
            const svars =
              (c.paperCard.definition?.svars as ReadonlyMap<string, SVarAst> | undefined) ?? new Map();
            if (svarName !== undefined) {
              const sv = svars.get(svarName);
              if (sv && sv.kind === "ability" && sv.ability) {
                const fakeAst: AbilityAst = {
                  kind: "spell",
                  effect: sv.ability,
                  cost: { raw: "" },
                };
                // Default the SA's target list to the source card so
                // sub-abilities written as `Defined$ Self` (read via
                // sa.targets) resolve. SVar authors that need a different
                // target shape can splice their own AST.
                const subSa = new SpellAbility(
                  fakeAst,
                  sourceCardId,
                  c.controllerSeat ?? controllerSeat,
                  svars,
                  [sourceCardId] as readonly EntityId[],
                );
                yield* subSa.makeResolver().resolve(g);
              }
            }
          }

          if (target > 0 && total >= target) {
            c.sagaFinalChapterResolved = true;
          }
          // Pure data mutation tail (the SBA sweep on next priority-
          // window opening picks up sagaFinalChapterResolved).
          return;
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    // The ETB trigger (Read-ahead branch) is already pushed/registered
    // above — it fires only when card.readAhead === true. Non-Read-ahead
    // Sagas rely on etbCounterSpecs for the silent CR 714.2b counter add.
    card.triggeredAbilities.push(main1 as unknown as TriggeredAbility);
    card.triggeredAbilities.push(watcher as unknown as TriggeredAbility);
    game.triggerRegistry.register(main1 as unknown as TriggeredAbility);
    game.triggerRegistry.register(watcher as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("chapter");
    // Slot data left as-is on deactivate — handlers re-stamp on each
    // re-entry via activate().
  }
}

keywordHandlerRegistry.register(ChapterKeywordHandler);
