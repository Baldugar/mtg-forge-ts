// SPDX-License-Identifier: GPL-3.0-or-later
// SpellCastTrigger — handles Forge's `T:Mode$ SpellCast` trigger line.
// Matches the engine's "SpellCast" event and checks the ValidCard$ and
// ValidActivatingPlayer$ params against the event payload.
//
// Forge pattern:
//   T:Mode$ SpellCast | ValidCard$ Card.nonCreature+YouCtrl | Execute$ TrigPumpSelf | TriggerDescription$ Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.
//
// ValidCard$ MVP support:
//   Card               — any spell cast fires this trigger.
//   Card.Self          — NEVER matches: a card cannot trigger its own cast
//                        (the trigger is not yet active when the card is cast).
//   Card.nonCreature+YouCtrl — any noncreature spell cast by the controller.
//                        `+YouCtrl` constrains the caster; `.nonCreature`
//                        checks the raw card types from paperCard.definition.types.
//
// ValidActivatingPlayer$ MVP support:
//   You       — castingSeat must equal this trigger's controllerSeat.
//   Opponent  — castingSeat must differ from this trigger's controllerSeat.
//   Each      — any caster qualifies (default).
//
// For ValidCard$ filters that include type qualifiers (e.g. `.nonCreature`),
// the trigger looks up the spell card in game.cards at match-time and checks
// paperCard.definition.types. This is safe as long as the card object exists
// at the time the SpellCast event fires (it always does — cards are added to
// game.cards before being cast).
//
// Part E2: resolver is stamped on the returned TriggeredAbility so the
// priority orchestrator can drive the trigger body via the SVar pipeline.
import type {
  AbilityAst,
  EntityId,
  GameEvent,
  PlayerSeat,
  SVarAst,
  TriggerAst,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { CardType, ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { TriggerHandler } from "../trigger-handler.js";

// TriggeredAbility extended with the resolver the priority orchestrator
// duck-types. Core does not carry StackItemResolver so we extend locally
// and cast to TriggeredAbility on return.
type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extract a literal string param from TriggerAst.params, or return undefined. */
const getParamRaw = (ast: TriggerAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  // svarRef / expression params are not supported for trigger conditions in MVP.
  return undefined;
};

// ---------------------------------------------------------------------------
// SpellCastTrigger
// ---------------------------------------------------------------------------

export class SpellCastTrigger extends TriggerHandler {
  static override readonly mode = "SpellCast";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validCardRaw = getParamRaw(ast, "ValidCard") ?? "Card";
    const validPlayerRaw = getParamRaw(ast, "ValidActivatingPlayer") ?? "Each";
    const { sourceCardId, controllerSeat, triggerId, game } = ctx;

    // Execute$ value — the SVar name this trigger resolves to (e.g. "TrigPumpSelf").
    const executeKey = ast.effect.handlerKey;

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      // SpellCast triggers are active while on the battlefield.
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0, // populated by activateTriggersFromDefinition if needed
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        if (event.kind !== "SpellCast") return false;
        const { cardId, controllerSeat: castingSeat } = event.payload as {
          stackItemId: EntityId;
          cardId: EntityId;
          controllerSeat: PlayerSeat;
        };

        // ValidActivatingPlayer$ check — who cast the spell.
        const playerOk =
          validPlayerRaw === "Each" ||
          (validPlayerRaw === "You" && castingSeat === controllerSeat) ||
          (validPlayerRaw === "Opponent" && castingSeat !== controllerSeat);
        if (!playerOk) return false;

        // ValidCard$ checks — which spell was cast.

        // Card.Self — a creature cannot trigger its own cast (not yet active).
        if (validCardRaw === "Card.Self") return false;

        // Card — any spell.
        if (validCardRaw === "Card") return true;

        // Card.nonCreature+YouCtrl — noncreature spell cast by controller.
        // The `+YouCtrl` part constrains the controller of the spell card
        // (same as the casting seat for cast triggers).
        if (validCardRaw === "Card.nonCreature+YouCtrl") {
          // YouCtrl: the caster must be the trigger's controller.
          if (castingSeat !== controllerSeat) return false;
          // nonCreature: look up the spell in game.cards and check its type.
          const spellCard = game.cards.get(cardId);
          if (!spellCard) return false;
          const def = spellCard.paperCard.definition;
          if (!def) return false;
          return !def.types.has(CardType.Creature);
        }

        // Other ValidCard$ filters deferred to future parts.
        return false;
      },

      // Part E2 — resolver: look up the Execute$ SVar at resolve-time,
      // wrap its EffectInvocation in a SpellAbility, and drive it.
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const resolveGame = gameUnknown as Game;
          const sourceCard = resolveGame.cards.get(sourceCardId);
          if (!sourceCard) return;
          const def = sourceCard.paperCard.definition;
          if (!def) return;
          const svars = def.svars as ReadonlyMap<string, SVarAst>;
          const sv = svars.get(executeKey);
          if (!sv) {
            throw new Error(
              `SpellCastTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `SpellCastTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          const fakeAst: AbilityAst = {
            kind: "spell",
            effect: sv.ability,
            cost: { raw: "" },
          };
          const sa = new SpellAbility(
            fakeAst,
            sourceCardId,
            controllerSeat,
            svars,
            [], // triggered abilities have no caster-selected targets at MVP
          );
          const innerResolver = sa.makeResolver();
          yield* innerResolver.resolve(resolveGame);
        },
      },
    };

    return ta as unknown as TriggeredAbility;
  }
}

triggerHandlerRegistry.register(SpellCastTrigger);
