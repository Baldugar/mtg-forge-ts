// SPDX-License-Identifier: GPL-3.0-or-later
// TributeKeywordHandler — processes K:Tribute:N keyword lines (Born of
// the Gods, CR 702.99) and synthesizes an ETB trigger that yields a
// chooseGenericOption to the controller (pick which opponent gets the
// choice) followed by a confirmAction to the chosen opponent. If they
// confirm: addCounter +1/+1 N. If they decline: stamp `tributePaid =
// false` so the alternate trigger (encoded on the source as a
// Conditional Trigger gated on Count$Tribute) fires.
//
// CR 702.99a — "Tribute N" — "As this creature enters, an opponent of
// your choice may put N +1/+1 counters on it. If they don't, the
// alternate 'if no Tribute was paid' trigger fires."
//
// Wave 61.F — multi-decision migration replacing the old single-yield
// confirmAction. Now:
//   1. Adds "tribute" to card.keywords.
//   2. Stamps `card.tributeAmount = N`.
//   3. ETB trigger: yield chooseGenericOption over opponent seats. If
//      no opponents (impossible in standard 2-player with Bob alive),
//      fall back to first non-controller seat. Then yield confirmAction
//      to the chosen opponent. On confirm: addCounter +1/+1 N + stamp
//      tributePaid = true. On decline: stamp tributePaid = false.
//
// M6.20 — Tribute remains a triggered ability (interactive chooser
// requires decision yields, which the silent etbCounterSpecs slot does
// not support). Forge splits this across a replacement-effect (silent
// counter put when paid) and a trigger ("notTributed" alt branch); the
// TS approach folds both into one trigger to keep the chooser yield
// localised. Saga/Backup-style replacement conversion was applied where
// applicable; Tribute stays trigger-shaped for now (deferred to a later
// wave that introduces an interactive-replacement slot).
//
// Wave 94 — alternate-trigger dispatch closed via sub-SVar lookup.
// On decline (`tributePaid = false`), if the source carries an
// `AltTribute` SVar of kind="ability", the handler synthesizes a
// SpellAbility from its EffectInvocation and yields* its resolver.
// Mirrors RepeatEachEffect's sub-SVar pattern; the SBA sweep on the
// next priority window picks up any side-effects.
import type {
  AbilityAst,
  EntityId,
  GameEvent,
  KeywordAst,
  ParamValue,
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

export class TributeKeywordHandler extends KeywordHandler {
  static override readonly keyword = "tribute" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("tribute");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const rawN =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 1;
    const n = Number.isFinite(rawN) && rawN > 0 ? rawN : 1;
    card.tributeAmount = n;

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;
    const triggerId = game.newEntityId();

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
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
          const self = g.cards.get(sourceCardId);
          if (!self) return;

          // Enumerate live opponent seats (everyone but the controller).
          // We do not gate on `hasLost` here — Tribute fires before SBA
          // in real play, and the controller-side defensive pick handles
          // 0-opponents (no possible interaction, fall through to "no").
          const oppSeats: PlayerSeat[] = [];
          for (const p of g.players) {
            if (p.seat !== controllerSeat) oppSeats.push(p.seat);
          }

          let chosenOpp: PlayerSeat | undefined;
          if (oppSeats.length === 0) {
            // No opponents — treat as "no Tribute paid" and stamp false.
            self.tributePaid = false;
            return;
          }
          if (oppSeats.length === 1) {
            // Single-opponent shortcut: skip the chooser yield (no real
            // choice). Match real-play UX: don't ask a one-option pick.
            chosenOpp = oppSeats[0];
          } else {
            // Wave 61.F — controller picks which opponent is offered the
            // tribute choice. Yield chooseGenericOption with one option per
            // opponent seat (`opp:<seatNumber>` ids).
            const options = oppSeats.map((seat) => ({
              id: `opp:${seat as unknown as number}`,
              description: `Opponent ${(seat as unknown as number).toString()}`,
            }));
            const pickResp = yield {
              kind: "decision",
              request: {
                kind: "chooseGenericOption",
                sourceId: sourceCardId,
                playerSeat: controllerSeat,
                options,
              },
            };
            const r = pickResp as { kind: string; optionId?: string } | undefined;
            if (r && r.kind === "chooseGenericOption" && typeof r.optionId === "string") {
              const m = /^opp:(\d+)$/.exec(r.optionId);
              if (m) {
                const seatNum = Number.parseInt(m[1] as string, 10);
                const candidate = oppSeats.find((s) => (s as unknown as number) === seatNum);
                if (candidate !== undefined) chosenOpp = candidate;
              }
            }
            // Fallback to first opponent on missing/invalid response.
            if (chosenOpp === undefined) chosenOpp = oppSeats[0];
          }
          if (chosenOpp === undefined) return;

          // Closure-over-PlayerSeat preserved for future opponent-side
          // routing in confirmAction (the request schema currently lacks
          // a seat slot — Wave 61.F follows existing precedent of using
          // confirmAction with sourceId only; the controller surface is
          // expected to dispatch the prompt to the chosen opponent).
          void (chosenOpp as PlayerSeat);

          const confirmResp = (yield {
            kind: "decision",
            request: {
              kind: "confirmAction",
              sourceId: sourceCardId,
              prompt: `Opponent: pay tribute (put ${n} +1/+1 counters)?`,
            },
          }) as { readonly kind: "confirmAction"; readonly confirmed: boolean } | undefined;

          if (confirmResp?.confirmed === true) {
            self.tributePaid = true;
            yield* g.action.addCounter(sourceCardId, CounterType.PlusOnePlusOne, n, sourceCardId);
          } else {
            self.tributePaid = false;
            // Wave 94 — fire the alternate trigger encoded on the source
            // as an `AltTribute` SVar (kind="ability"). Builds a fakeAst
            // over the SVar's EffectInvocation, instantiates a
            // SpellAbility, and yields* its resolver. Graceful no-op when
            // the SVar is missing.
            const svars =
              (self.paperCard.definition?.svars as ReadonlyMap<string, SVarAst> | undefined) ?? new Map();
            const sv = svars.get("AltTribute");
            if (sv && sv.kind === "ability" && sv.ability) {
              const fakeAst: AbilityAst = {
                kind: "spell",
                effect: sv.ability,
                cost: { raw: "" },
              };
              // Default targets = [self] so sub-abilities written as
              // `Defined$ Self` (via sa.targets) resolve cleanly.
              const subSa = new SpellAbility(
                fakeAst,
                sourceCardId,
                self.controllerSeat ?? controllerSeat,
                svars,
                [sourceCardId] as readonly EntityId[],
              );
              yield* subSa.makeResolver().resolve(g);
            }
          }
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(ta as unknown as TriggeredAbility);
    game.triggerRegistry.register(ta as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("tribute");
    card.tributeAmount = undefined;
    card.tributePaid = undefined;
  }
}

keywordHandlerRegistry.register(TributeKeywordHandler);
