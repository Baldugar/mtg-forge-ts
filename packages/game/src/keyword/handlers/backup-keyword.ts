// SPDX-License-Identifier: GPL-3.0-or-later
// BackupKeywordHandler — processes K:Backup:N keyword lines (Lord of the
// Rings: Tales of Middle-earth, CR 702.165) and synthesizes an ETB
// trigger that places N +1/+1 counters on a chosen creature and grants
// it the source's listed abilities until end of turn.
//
// CR 702.165a — "Backup N" — "When this creature enters, put N +1/+1
// counters on target creature. If that's another creature, it gains
// the listed abilities until end of turn."
//
// MVP scope:
//   1. Adds "backup" to card.keywords.
//   2. Stamps `card.backupAmount = N`.
//   3. ETB trigger: yield chooseCard for a battlefield creature
//      On resolve: addCounter(P1P1, N), then dispatch the source's
//      `BackupGrant` SVar (kind="ability") on the chosen target.
//
// Wave 94 — closes the "grant listed abilities until end of turn" tail.
// The source's listed abilities are encoded as a `BackupGrant` SVar of
// kind="ability" on the PaperCard.definition.svars. When the chosen
// target is not the source itself (CR 702.165a — "If that's another
// creature ..."), we synthesize a SpellAbility from the SVar's
// EffectInvocation and yield* its resolver. The resolver is responsible
// for any layer 6/7 grant + UEoT scoping — Backup just routes to it.
import type {
  AbilityAst,
  EntityId,
  GameEvent,
  KeywordAst,
  ParamValue,
  SVarAst,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { CardType, CounterType, ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class BackupKeywordHandler extends KeywordHandler {
  static override readonly keyword = "backup" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("backup");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const rawN =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 1;
    const n = Number.isFinite(rawN) && rawN > 0 ? rawN : 1;
    card.backupAmount = n;

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
          // Wave 61.D — Backup picks any creature on the battlefield
          // (CR 702.164: "target creature"). Self is eligible — Backup
          // is allowed to bolster the entering creature itself.
          const eligible: EntityId[] = [];
          for (const [id, c] of g.cards) {
            if (c.zone !== ZoneType.Battlefield) continue;
            const chars = g.layerEngine.computeCharacteristics(id);
            if (!chars.types.has(CardType.Creature)) continue;
            eligible.push(id);
          }
          if (eligible.length === 0) return;

          // Yield chooseCard for the controller of the source.
          const decision = yield {
            kind: "decision",
            request: {
              kind: "chooseCard",
              playerSeat: controllerSeat,
              pool: eligible,
              restriction: { keyword: "backup", amount: n },
              min: 1,
              max: 1,
            },
          };
          const r = decision as { kind: string; chosen?: readonly EntityId[] } | undefined;
          let target: EntityId | undefined;
          if (r && r.kind === "chooseCard" && r.chosen && r.chosen.length === 1) {
            const picked = r.chosen[0];
            if (picked !== undefined && eligible.includes(picked)) target = picked;
          }
          if (target === undefined) target = eligible[0];
          if (target === undefined) return;

          yield* g.action.addCounter(target, CounterType.PlusOnePlusOne, n, sourceCardId);

          // Wave 94 — when target !== sourceCardId, dispatch the source's
          // `BackupGrant` SVar (kind="ability") with the chosen target as
          // the spell-ability's target list. The dispatched SA is
          // responsible for performing the layer-6/7 grant + UEoT scoping.
          // Mirrors RepeatEachEffect's sub-SVar pattern.
          if (target !== sourceCardId) {
            const self = g.cards.get(sourceCardId);
            if (self) {
              const svars =
                (self.paperCard.definition?.svars as ReadonlyMap<string, SVarAst> | undefined) ?? new Map();
              const sv = svars.get("BackupGrant");
              if (sv && sv.kind === "ability" && sv.ability) {
                const fakeAst: AbilityAst = {
                  kind: "spell",
                  effect: sv.ability,
                  cost: { raw: "" },
                };
                const subSa = new SpellAbility(fakeAst, sourceCardId, controllerSeat, svars, [
                  target,
                ] as readonly EntityId[]);
                yield* subSa.makeResolver().resolve(g);
              }
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
    card.keywords?.delete("backup");
    card.backupAmount = undefined;
  }
}

keywordHandlerRegistry.register(BackupKeywordHandler);
