// SPDX-License-Identifier: GPL-3.0-or-later
// ChangesZoneTrigger — handles Forge's `T:Mode$ ChangesZone` trigger line.
// Matches the engine's "CardChangedZone" event and checks Origin$,
// Destination$, and ValidCard$ params against the event payload.
//
// Forge pattern:
//   T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw
//
// ValidCard$ support:
//   Card.Self  — only the source card triggers (ETB/LTB self-trigger).
//   Card       — any card moving between zones triggers (global watcher).
//   <Filter>   — comma-OR of plus/dot-joined alternatives (Wave 32). E.g.
//                Card.Self,Enchantment.Other+YouCtrl   (Constellation)
//                Creature.YouCtrl                      (generic)
//
// Wave 32 — Constellation (Theros: Beyond Death, ~20 cards):
//   T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield
//     | ValidCard$ Card.Self,Enchantment.Other+YouCtrl
//     | Execute$ TrigDraw
//   The comma-OR ValidCard$ + the `Other` + `YouCtrl` qualifiers cover
//   "this enchantment OR another enchantment you control".
//
// Wave 32 — Revolt$ True (Aether Revolt, ~15 cards):
//   T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield
//     | ValidCard$ Card.Self | Execute$ TrigDestroy | Revolt$ True
//   When Revolt$ True is set, matches() additionally requires that a
//   permanent left the battlefield under controllerSeatAtReg's control
//   this turn (game.flags.permanentsLeftBfThisTurn).
//
// Part E2: Execute$ SVar is resolved at resolve-time to a SpellAbility whose
// makeResolver() drives the trigger body. Resolver is stamped on the returned
// TriggeredAbility so the priority orchestrator can drive it.
import type {
  AbilityAst,
  EntityId,
  GameEvent,
  SVarAst,
  TriggerAst,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { cardMatchesFilter } from "../card-filter.js";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { TriggerHandler } from "../trigger-handler.js";

// TriggeredAbility extended with the resolver the priority orchestrator
// duck-types at line ~91-92 of priority-orchestrator.ts. Core does not carry
// StackItemResolver (avoiding a core→game circular import) so we extend
// locally and cast to TriggeredAbility on return.
//
// `executeKey` is the SVar name this trigger's Execute$ resolves to. Stamped
// here so the trigger-registry's M6.8 target-legality probe can walk the
// chain without re-parsing the AST. CR 603.10c skip path.
type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
  readonly executeKey: string;
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

/**
 * Map a Forge Zone name (from Origin$/Destination$ param) to the engine's
 * ZoneType enum string. Forge uses PascalCase matching ZoneType already, so
 * for most cases this is a pass-through. "Any" is kept as a sentinel.
 */
const normalizeZone = (raw: string): string => raw; // ZoneType strings already PascalCase

// ---------------------------------------------------------------------------
// ChangesZoneTrigger
// ---------------------------------------------------------------------------

export class ChangesZoneTrigger extends TriggerHandler {
  static override readonly mode = "ChangesZone";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const originRaw = getParamRaw(ast, "Origin") ?? "Any";
    const destRaw = getParamRaw(ast, "Destination") ?? "Any";
    const validRaw = getParamRaw(ast, "ValidCard") ?? "Card";
    const revoltGate = getParamRaw(ast, "Revolt") === "True";
    const { sourceCardId, controllerSeat, triggerId, game } = ctx;
    const originZone = normalizeZone(originRaw);
    const destZone = normalizeZone(destRaw);

    // Execute$ value is the SVar name this trigger resolves to (e.g. "TrigDraw").
    // The TriggerAst.effect.handlerKey holds this name (see trigger-line.ts).
    const executeKey = ast.effect.handlerKey;

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      // ChangesZone triggers are active while on the battlefield (default).
      // CR 603.6d: triggers on cards in other zones are handled separately.
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0, // populated by activateTriggersFromDefinition if needed
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      // M6.8 — stamped for the trigger-registry's CR 603.10c target-legality
      // probe. The probe walks svars[executeKey].ability's effect chain
      // looking for ValidTgts$ steps to skip the trigger fire if no legal
      // target exists.
      executeKey,

      matches(event: GameEvent): boolean {
        if (event.kind !== "CardChangedZone") return false;
        const { fromZone, toZone, cardId } = event.payload as {
          fromZone: ZoneType;
          toZone: ZoneType;
          cardId: EntityId;
        };

        // Check Origin$ param. originZone is a ZoneType string value or "Any".
        if (originZone !== "Any" && fromZone !== (originZone as ZoneType)) return false;

        // Check Destination$ param. destZone is a ZoneType string value or "Any".
        if (destZone !== "Any" && toZone !== (destZone as ZoneType)) return false;

        // Check ValidCard$ param. Fast paths first (Card.Self, Card)
        // avoid touching game.cards. The general path delegates to the
        // shared cardMatchesFilter helper (comma-OR / plus-AND grammar).
        let validCardOk = false;
        if (validRaw === "Card.Self") {
          validCardOk = cardId === sourceCardId;
        } else if (validRaw === "Card") {
          validCardOk = true;
        } else {
          const card = game.cards.get(cardId);
          if (!card) return false;
          validCardOk = cardMatchesFilter(card, validRaw, {
            controllerSeat,
            sourceCardId,
          });
        }
        if (!validCardOk) return false;

        // Revolt$ True — Aether Revolt (CR-style "a permanent you
        // controlled left the battlefield this turn"). Per-seat counter
        // populated by game-action.ts moveTo + reset by phase-handler.
        if (revoltGate) {
          const n = game.flags.permanentsLeftBfThisTurn.get(controllerSeat) ?? 0;
          if (n <= 0) return false;
        }

        return true;
      },

      // Part E2 — resolver: look up the Execute$ SVar at resolve-time,
      // wrap its EffectInvocation in a SpellAbility, and drive it.
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const game = gameUnknown as Game;
          const sourceCard = game.cards.get(sourceCardId);
          if (!sourceCard) return;
          const def = sourceCard.paperCard.definition;
          if (!def) return;
          const svars = def.svars as ReadonlyMap<string, SVarAst>;
          const sv = svars.get(executeKey);
          if (!sv) {
            throw new Error(
              `ChangesZoneTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `ChangesZoneTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          // Wrap the ability EffectInvocation in a minimal AbilityAst and
          // create a SpellAbility so effectRegistry.lookup + effect.resolve
          // can drive the body through the standard path.
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
          yield* innerResolver.resolve(game);
        },
      },
    };

    return ta as unknown as TriggeredAbility;
  }
}

triggerHandlerRegistry.register(ChangesZoneTrigger);
