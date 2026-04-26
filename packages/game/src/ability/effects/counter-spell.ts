// SPDX-License-Identifier: GPL-3.0-or-later
// CounterSpellEffect — counters a target spell or ability on the stack
// (CR 701.5). Removes the targeted stack item from the Stack and, for spell
// items (kind "spell" | "copy"), moves the source card to its owner's
// graveyard. Emits StackItemCountered so trigger handlers observe the event.
//
// Wave 48 — fires a `CounteredIntent` through applyReplacementLoop before
// the move so `R:Event$ Counter` replacements (Cavern of Souls / Gaea's
// Herald "this can't be countered" Layer$ CantHappen, plus
// counter-and-exile / counter-to-hand redirects) intercept.
//
// Forge DSL: SP$ Counter | ValidTgts$ Spell
//
// Wave 53 broadens the MVP:
//   - DestinationZone$ <Zone>     — override the post-counter destination
//                                    (default: owner's graveyard, CR 701.5b).
//                                    Lapse of Certainty exiles; Hindering
//                                    Light bounces to hand; Spelljack
//                                    re-stages.
//   - LibraryPosition$ <N>        — when DestinationZone$ Library, sign:
//                                    -1 (default for "bottom"); 0 = top.
import type { EntityId, MutationIntent, ZoneType as ZoneTypeT } from "@mtg-forge-ts/core";
import { ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { applyReplacementLoop } from "../../replacements/apply-loop.js";
import type { CounteredIntent } from "../../replacements/mutation-intent.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const ZONE_BY_NAME: Readonly<Record<string, ZoneTypeT>> = {
  Battlefield: ZoneType.Battlefield,
  Graveyard: ZoneType.Graveyard,
  Exile: ZoneType.Exile,
  Hand: ZoneType.Hand,
  Library: ZoneType.Library,
};

export class CounterSpellEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Counter";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    for (const targetId of sa.targets) {
      // Wave 48 — peek the item without removing first so the
      // CounteredIntent runs through the replacement loop while the
      // target is still on the stack (replacements may inspect it).
      const item = game.sharedZones.stack.toArray().find((it) => it.id === targetId);
      if (!item) continue; // already gone — spell fizzled or was already countered

      // Wave 48 — fire CounteredIntent through the replacement loop so
      // "this can't be countered" / "counter-and-exile" replacements
      // intercept. We drive applyReplacementLoop directly because the
      // effect already owns the surrounding StackItemCountered emit
      // ordering; using applyWithReplacements would duplicate the
      // canonical-event role.
      const intent: CounteredIntent = {
        kind: "countered",
        stackItemId: item.id,
        counteredCardId: item.sourceCardId,
        sourceId: sa.sourceCardId,
        seat: item.controllerSeat,
      };
      const replResult = yield* applyReplacementLoop(intent as unknown as MutationIntent, game);
      for (const rid of replResult.appliedIds) {
        yield {
          kind: "event",
          event: mkEvent("ReplacementApplied", game.turn, game.phase, {
            replacementId: rid,
            original: intent,
            replaced: replResult.status === "applied" ? replResult.final : null,
          }),
        };
      }
      if (replResult.status === "prevented") {
        // "This spell can't be countered" — emit EventPrevented and skip
        // the actual counter. The spell stays on the stack; resolution
        // will continue when CounterSpellEffect's caller proceeds.
        yield {
          kind: "event",
          event: mkEvent("EventPrevented", game.turn, game.phase, { original: intent }),
        };
        continue;
      }

      // Replacement apply path may have rewritten the destination zone
      // (counter-and-exile / counter-to-hand). Default destination is
      // the owner's graveyard per CR 701.5b.
      //
      // Wave 53 — DestinationZone$ explicitly overrides the default. The
      // replacement-loop's destination still wins over the param when both
      // are present (replacement-driven counter-and-exile beats a
      // hard-coded DestinationZone$).
      const finalIntent = replResult.final as unknown as CounteredIntent & {
        readonly destination?: ZoneTypeT;
      };
      const destFromParam: ZoneTypeT | undefined = hasParam(sa, "DestinationZone")
        ? ZONE_BY_NAME[evaluateParamRaw(sa, "DestinationZone").trim()]
        : undefined;
      const destination: ZoneTypeT = finalIntent.destination ?? destFromParam ?? ZoneType.Graveyard;

      // Now physically remove the stack item.
      game.sharedZones.stack.removeById(targetId);

      // CR 701.5a — emit StackItemCountered so trigger handlers observe it.
      yield game.emitEvent(
        mkEvent("StackItemCountered", game.turn, game.phase, {
          stackItemId: item.id,
          byEffectId: sa.sourceCardId as EntityId,
        }),
      );

      // CR 701.5b — move the source card to its owner's graveyard (or to
      // the replacement-overridden destination). Only applies to spell
      // items; activated/triggered abilities have no card to move (they're
      // not "put" anywhere per CR 702.5).
      if (item.kind === "spell" || item.kind === "copy") {
        const sourceCard = game.cards.get(item.sourceCardId);
        if (sourceCard) {
          yield* game.action.moveTo(item.sourceCardId, destination, {
            toSeat: sourceCard.ownerSeat,
            cause: "countered",
          });
          // Wave 53 — LibraryPosition$ relocates the card on the library
          // post-move. The default for moveTo→Library is bottom; if 0 is
          // requested, lift the card and re-add to top.
          if (destination === ZoneType.Library && hasParam(sa, "LibraryPosition")) {
            const pos = evaluateParamRaw(sa, "LibraryPosition").trim();
            if (pos === "0") {
              const ownerLib = game.getPlayer(sourceCard.ownerSeat).zones.get(ZoneType.Library);
              if (ownerLib) {
                ownerLib.remove(item.sourceCardId);
                ownerLib.addToTop(item.sourceCardId);
              }
            }
          }
        }
      }
    }
  }
}

effectRegistry.register(CounterSpellEffect);
