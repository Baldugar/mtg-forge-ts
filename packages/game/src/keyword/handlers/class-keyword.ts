// SPDX-License-Identifier: GPL-3.0-or-later
// ClassKeywordHandler — processes K:Class:level:cost:flag:abilityKey
// keyword lines (Adventures in the Forgotten Realms / Streets of New
// Capenna, CR 715) and synthesizes the level-up activated abilities.
//
// CR 715.1 — A Class enchantment has level abilities that let its
//            controller pay a cost as a sorcery to advance the
//            permanent to the next level. Each Class starts at level 1
//            (the printed text + first ability slot) and may reach
//            higher levels by paying activation costs.
// CR 715.2 — A Class permanent's level number is tracked by level
//            counters on it (CR 122.1k / Forge: card.classLevel +
//            CounterType.Level mirror). Triggers / statics keyed to a
//            given level are active iff that level has been reached.
//
// DSL form (one K:Class line per non-base level):
//   K:Class:2:1 G:AddTrigger$ TriggerAttackersDeclared
//   K:Class:3:3 G:AddStaticAbility$ SMayLook & SMayPlay
//
// The keyword-line parser stores the payload under params.detail as
// the literal "level:cost:flagAndKey" (everything after `K:Class:`).
// We split on the first two ":" to recover (level, cost, flagAndKey).
// The flag/abilityKey portion is opaque to MVP — the full per-level
// trigger/static gating is TODO(advanced).
//
// This handler:
//   1. Adds "class" to card.keywords. Stamps card.classLevel = 1 if
//      undefined (mirror of the SBA "Class without a Level counter
//      gains level 1" rule in saga-class.ts).
//   2. For each K:Class line, synthesizes a Battlefield-zone
//      sorcery-speed activated SpellAbility with the printed cost.
//      On resolve, the SA stamps card.classLevel = max(prev, level)
//      AND adds Level counters so the SBA gates and counter-driven
//      reads agree.
//   3. CounterAdded watcher: when a Level counter is added to this
//      Class, bump card.classLevel = max(prev, total) so per-level
//      conditional triggers/statics that consult `card.classLevel >= N`
//      stay synchronized with the live counter total without relying
//      on the SBA sweep timing (closes the prior TODO(advanced)).
import type {
  EntityId,
  GameEvent,
  KeywordAst,
  ParamValue,
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
 * Parse the Class detail string. Form: "level:cost:flagAndKey" — the
 * level is parsed as an int; the cost is everything between the first
 * two inner colons (preserves multi-segment mana like "1 G"); the
 * remainder is opaque (TODO(advanced)). Returns level + cost; falls
 * back to {level:0, cost:""} on malformed inputs.
 */
const parseClassDetail = (raw: string): { level: number; cost: string; ability: string } => {
  if (raw === "") return { level: 0, cost: "", ability: "" };
  const firstColon = raw.indexOf(":");
  if (firstColon < 0) {
    const lvl = Number.parseInt(raw, 10);
    return { level: Number.isFinite(lvl) ? lvl : 0, cost: "", ability: "" };
  }
  const head = raw.slice(0, firstColon);
  const tail = raw.slice(firstColon + 1);
  const lvl = Number.parseInt(head, 10);
  const level = Number.isFinite(lvl) ? lvl : 0;
  const secondColon = tail.indexOf(":");
  if (secondColon < 0) {
    return { level, cost: tail.trim(), ability: "" };
  }
  const cost = tail.slice(0, secondColon).trim();
  const ability = tail.slice(secondColon + 1).trim();
  return { level, cost, ability };
};

export class ClassKeywordHandler extends KeywordHandler {
  static override readonly keyword = "class" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("class");

    // Default level 1 on first activation (mirror of the SBA bump in
    // sba/saga-class.ts which adds Level=1 when the counter is 0).
    if (card.classLevel === undefined) card.classLevel = 1;

    // Wave 113 — CounterAdded watcher: when a Level counter is added to
    // this Class, bump card.classLevel = max(prev, total). Closes the
    // prior TODO(advanced) so per-level static / trigger gates that read
    // `card.classLevel >= N` agree with the live counter total without
    // relying on the SBA sweep timing. Idempotent (registered once per
    // activate) — the keyword handler activates once per zone-entry, so
    // a single watcher per source card is correct. Mirrors chapter-keyword's
    // Lore-counter watcher pattern.
    if (card.classLevelWatcherRegistered !== true) {
      card.classLevelWatcherRegistered = true;
      const game = ctx.game;
      const sourceCardId = ctx.sourceCardId;
      const controllerSeat = ctx.controllerSeat;
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
          return p.counterType === (CounterType.Level as string);
        },
        resolver: {
          // biome-ignore lint/correctness/useYield: pure data-mutation watcher — bumps classLevel from the live Level counter total; no engine yields needed
          *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
            const g = gameUnknown as Game;
            const c = g.cards.get(sourceCardId);
            if (!c) return;
            const total = c.counters.get(CounterType.Level) ?? 0;
            const prev = c.classLevel ?? 1;
            if (total > prev) {
              c.classLevel = total;
              g.layerEngine.bumpEpoch("class-level-bump");
            }
            return;
          },
        },
      };
      if (!card.triggeredAbilities) card.triggeredAbilities = [];
      card.triggeredAbilities.push(watcher as unknown as TriggeredAbility);
      game.triggerRegistry.register(watcher as unknown as TriggeredAbility);
    }

    const detailParam = ast.params?.detail as ParamValue | undefined;
    const detailRaw = detailParam && detailParam.kind === "literal" ? (detailParam.raw as string) : "";
    const { level, cost } = parseClassDetail(detailRaw);
    if (level <= 1 || cost === "") {
      // Either malformed or a level-1 placeholder — nothing to
      // synthesize. The base level-1 abilities are encoded as separate
      // T:/S: lines on the card (Forge convention), already wired by
      // activateTriggersFromDefinition / static intrinsics.
      return;
    }

    // Synthesize the level-up activated SA. The SA's effect stamps
    // card.classLevel = max(prev, level) and adds Level counters so
    // both reads (slot + counter) agree.
    //
    // We use the synthetic "ClassLevelUp" handlerKey so the effect
    // dispatcher (when wired in Wave 53) can look up the level + source.
    // Today the resolver below is short-circuited by SpellAbility's
    // standard resolution path — the cost is paid by the cast pipeline,
    // and the effect handler stamps the level. As a safety net, the
    // handlerKey "PutCounter" with CounterType=Level + CounterNum=1 is
    // the durable operation: each activation adds 1 Level counter, and
    // the SBA + classLevel mirror picks up the bump.
    const fakeAst = {
      kind: "activated" as const,
      effect: {
        handlerKey: "PutCounter",
        params: {
          Defined: { kind: "literal" as const, raw: "Self" },
          CounterType: { kind: "literal" as const, raw: "level" },
          CounterNum: { kind: "literal" as const, raw: "1" },
        },
      },
      cost: { raw: cost },
      rulesText: `Class — Pay ${cost} to gain level ${level}. Activate only as a sorcery.`,
    };

    const def = card.paperCard.definition;
    const svars = (def?.svars as ReadonlyMap<string, SVarAst>) ?? new Map<string, SVarAst>();
    const sa = new SpellAbility(
      fakeAst,
      ctx.sourceCardId,
      ctx.controllerSeat,
      svars,
      [],
      undefined,
      new Set([ZoneType.Battlefield]),
      new Set(["class", "sorcery_speed", `class_level_${level}`]),
    );

    card.spellAbilities.push(sa);

    // Hook: when this SA resolves, also bump card.classLevel so the
    // slot stays in sync with the counter total. We piggy-back on the
    // PutCounter effect by post-stamping in the SA's resolved handler
    // — but since the SpellAbility resolution path is generic, we
    // instead expose the level via an attached metadata slot read by
    // a CounterAdded watcher (mirroring chapter-keyword).
    //
    // Wave 113 — the per-level CounterAdded watcher is now wired at
    // the top of activate() (gated by classLevelWatcherRegistered).
    // The watcher fires on each Level-counter add and stamps
    // card.classLevel = max(prev, total). The synthesized SA's
    // PutCounter handlerKey adds 1 Level counter on each activation,
    // so the watcher sees the bump and propagates it to the slot.
    void level;
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("class");
    // Wave 113 — clear the watcher guard so a re-entry (blink / clone /
    // bestow re-attach) can re-register the watcher.
    card.classLevelWatcherRegistered = undefined;
    // classLevel slot left as-is — re-entry after blink/exile re-stamps
    // via activate(). Wave 53+ may add a controller-change reset hook.
  }
}

keywordHandlerRegistry.register(ClassKeywordHandler);
