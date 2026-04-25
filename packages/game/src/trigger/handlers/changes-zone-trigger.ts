// SPDX-License-Identifier: GPL-3.0-or-later
// ChangesZoneTrigger — handles Forge's `T:Mode$ ChangesZone` trigger line.
// Matches the engine's "CardChangedZone" event and checks Origin$,
// Destination$, and ValidCard$ params against the event payload.
//
// Forge pattern:
//   T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw
//
// ValidCard$ MVP support:
//   Card.Self  — only the source card triggers (ETB/LTB self-trigger).
//   Card       — any card moving between zones triggers (global watcher).
//
// Resolver is stubbed (throws "deferred") — Part E2 wires Execute$ → SVar
// resolution → SpellAbility construction → stack push.
import type { EntityId, GameEvent, TriggerAst, TriggeredAbility } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { TriggerHandler } from "../trigger-handler.js";

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
    const { sourceCardId, controllerSeat, triggerId } = ctx;
    const originZone = normalizeZone(originRaw);
    const destZone = normalizeZone(destRaw);

    const ta: TriggeredAbility = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      // ChangesZone triggers are active while on the battlefield (default).
      // CR 603.6d: triggers on cards in other zones are handled separately.
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0, // populated by activateTriggersFromDefinition if needed
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

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

        // Check ValidCard$ param
        if (validRaw === "Card.Self") return cardId === sourceCardId;
        if (validRaw === "Card") return true;

        // Other ValidCard$ filters (Creature, Player's, etc.) deferred to Part E2.
        return false;
      },
    };

    return ta;
  }
}

triggerHandlerRegistry.register(ChangesZoneTrigger);
