// SPDX-License-Identifier: GPL-3.0-or-later
// MobilizeKeywordHandler — processes K:Mobilize:N keyword lines (Tarkir:
// Dragonstorm, CR 702.176) and synthesizes an attacks-trigger that
// creates N tapped-and-attacking 1/1 red Warrior creature tokens that
// attack the same defender as the source. Sacrifice them at the
// beginning of the next end step.
//
// CR 702.176a — "Mobilize N" — "Whenever this creature attacks, create
// N tapped and attacking 1/1 red Warrior creature tokens. Sacrifice
// them at the beginning of the next end step."
//
// Wave 61.F — closes the Wave 58 token-creation TODO. The handler now:
//   1. Adds "mobilize" to card.keywords + stamps card.mobilizeAmount.
//   2. AttackersDeclared trigger: spawns N 1/1 red Warrior tokens via
//      game.action.createToken (using a hand-rolled Warrior PaperCard
//      mirroring the LivingWeapon Germ pattern), stamps tapped +
//      attackingDefender = source's defender on each, and registers a
//      one-shot delayed trigger on TurnEnded that sacrifices the
//      spawned tokens at the start of the End step.
import {
  type CardDefinition,
  CardType,
  Color,
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  type EntityId,
  type GameEvent,
  type KeywordAst,
  type PaperCard,
  type ParamValue,
  type PlayerSeat,
  type Supertype,
  type TriggeredAbility,
  TypeLine,
  ZoneType,
} from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

type AttackersDeclaredPayload = {
  readonly attackingSeat: PlayerSeat;
  readonly attackers?: readonly {
    readonly attackerId: EntityId;
    readonly defender:
      | { readonly kind: "player"; readonly seat: PlayerSeat }
      | { readonly kind: "planeswalker"; readonly id: EntityId }
      | { readonly kind: "battle"; readonly id: EntityId };
  }[];
};

/**
 * Build a 1/1 red Warrior creature token PaperCard. Mirrors the inline
 * pattern in LivingWeaponKeywordHandler (Germ) — we hand-roll the
 * shape so we don't depend on the cards-package token database here.
 * The Warrior token is also registered in the cards-package
 * tokenDatabase as `r_1_1_warrior` for parity with TokenScript$ paths.
 */
const buildWarriorPaperCard = (): PaperCard => {
  const NO_SUPERTYPES: readonly Supertype[] = [];
  const types = new TypeLine(NO_SUPERTYPES, [CardType.Creature], ["Warrior"]);
  const definition: CardDefinition = {
    name: "Warrior Token",
    oracle: "",
    types,
    manaCost: null,
    pt: { power: "1", toughness: "1" },
    colors: ColorSet.of(Color.Red),
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  };
  return {
    name: "Warrior Token",
    edition: "TOK",
    collectorNumber: "0",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition,
  };
};

export class MobilizeKeywordHandler extends KeywordHandler {
  static override readonly keyword = "mobilize" as const;

  override activate(ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("mobilize");

    const amountParam = ast.params?.amount as ParamValue | undefined;
    const rawN =
      amountParam && amountParam.kind === "literal" ? Number.parseInt(amountParam.raw as string, 10) : 1;
    const n = Number.isFinite(rawN) && rawN > 0 ? rawN : 1;
    card.mobilizeAmount = n;

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;
    const triggerId = game.newEntityId();

    // Capture the defender attached to this source's attack at decl
    // time so the resolver knows where to point the spawned tokens.
    let capturedDefender:
      | { readonly kind: "player"; readonly seat: PlayerSeat }
      | { readonly kind: "planeswalker"; readonly id: EntityId }
      | { readonly kind: "battle"; readonly id: EntityId }
      | undefined;

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        if (event.kind !== "AttackersDeclared") return false;
        const p = event.payload as AttackersDeclaredPayload;
        const entry = p.attackers?.find((a) => a.attackerId === sourceCardId);
        if (!entry) return false;
        capturedDefender = entry.defender;
        return true;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          const amount = self.mobilizeAmount ?? n;
          if (amount <= 0) return;

          const paper = buildWarriorPaperCard();
          const ids = (yield* g.action.createToken({
            paperCard: paper,
            controller: controllerSeat,
            count: amount,
          })) as readonly EntityId[];

          // Stamp tapped + attacking the same defender as source. We
          // duck-type `attackingDefender` per the conventional slot
          // used elsewhere (Ninjutsu / combat module). For player
          // defenders we stamp the seat number; for planeswalker /
          // battle defenders we stamp the entity id. Both are
          // observable as a non-undefined slot, which is what the
          // combat module reads at damage step.
          let defenderStamp: PlayerSeat | EntityId | undefined;
          if (capturedDefender !== undefined) {
            if (capturedDefender.kind === "player") defenderStamp = capturedDefender.seat;
            else defenderStamp = capturedDefender.id;
          }
          for (const tokId of ids) {
            const tok = g.cards.get(tokId);
            if (!tok) continue;
            tok.tapped = true;
            if (defenderStamp !== undefined) {
              (tok as unknown as { attackingDefender?: typeof defenderStamp }).attackingDefender =
                defenderStamp;
            }
          }

          // Register a one-shot delayed trigger that sacrifices the
          // spawned tokens at the start of the next End step. We watch
          // StepStarted with step=End on the registration turn; the
          // queue's createdAtTurn pruning keeps the trigger from
          // reaching across turns.
          if (ids.length === 0) return;
          const dtId = g.newEntityId();
          const tokenIds = [...ids];
          g.delayedTriggerQueue.add({
            id: dtId,
            kind: "triggered",
            sourceCardId,
            activeInZones: new Set([ZoneType.Battlefield, ZoneType.Stack, ZoneType.Graveyard]),
            timestamp: 0,
            controllerSeatAtReg: controllerSeat,
            isDelayed: true,
            createdAtTurn: g.turn,
            creationContext: { rememberedIds: tokenIds },
            oneShot: true,
            matches(event) {
              if (event.kind !== "StepStarted") return false;
              const p = (event as unknown as { payload?: { step?: string } }).payload;
              if (p?.step !== "EndStep" && p?.step !== "End") return false;
              // Drive the sacrifices eagerly. Mirrors EffectEffect /
              // FogEffect's "tear-down on match" pattern. Each call
              // self-guards against missing cards.
              for (const tid of tokenIds) {
                const t = g.cards.get(tid);
                if (!t) continue;
                if (t.zone !== ZoneType.Battlefield) continue;
                const gen = g.action.sacrifice(tid, { sourceId: sourceCardId });
                let r = gen.next();
                while (!r.done) r = gen.next();
              }
              return true;
            },
          });
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
    card.keywords?.delete("mobilize");
    card.mobilizeAmount = undefined;
  }
}

keywordHandlerRegistry.register(MobilizeKeywordHandler);
