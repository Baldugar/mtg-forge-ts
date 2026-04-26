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
// Per-chapter SVar dispatch (resolving DB1..DBN as their printed
// chapter abilities) is TODO(advanced); the count + final-chapter flag
// is enough for the SBA-driven sacrifice path and exercises ~all
// Saga corpus cards as the durable contract.
import type {
  EntityId,
  GameEvent,
  KeywordAst,
  ParamValue,
  PhaseStep,
  PlayerSeat,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { CounterType, ZoneType } from "@mtg-forge-ts/core";
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

    // Trigger 1 — ETB: stamp 1 Lore counter (CR 714.2b).
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
        return p.cardId === sourceCardId && p.toZone === ZoneType.Battlefield;
      },
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const c = g.cards.get(sourceCardId);
          if (!c) return;
          // Idempotency guard: if the Saga already has Lore counters
          // (e.g. blink loop), do not double-stamp.
          const existing = c.counters.get(CounterType.Lore) ?? 0;
          if (existing > 0) return;
          yield* g.action.addCounter(sourceCardId, CounterType.Lore, 1, sourceCardId);
        },
      },
    };

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
    // TODO(advanced) — also dispatch the per-chapter SVar (DB1..DBN) at
    // matching counts so the printed chapter abilities resolve. The
    // count + flag is the durable contract for ~all Saga corpus cards;
    // per-chapter ability resolution lands when SVar resolution from a
    // synthesized SpellAbility name is wired up.
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
        return p.counterType === (CounterType.Lore as string);
      },
      resolver: {
        // biome-ignore lint/correctness/useYield: pure data-flag mutation; SBA sweep observes
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const c = g.cards.get(sourceCardId);
          if (!c) return;
          const total = c.counters.get(CounterType.Lore) ?? 0;
          const target = c.sagaChapterCount ?? 0;
          if (target > 0 && total >= target) {
            c.sagaFinalChapterResolved = true;
          }
          // Pure data mutation; the SBA sweep on next priority-window
          // opening picks up the flag.
          return;
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(etb as unknown as TriggeredAbility);
    card.triggeredAbilities.push(main1 as unknown as TriggeredAbility);
    card.triggeredAbilities.push(watcher as unknown as TriggeredAbility);
    game.triggerRegistry.register(etb as unknown as TriggeredAbility);
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
