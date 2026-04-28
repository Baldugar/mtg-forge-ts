// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.I — Crew static handler. CR 702.122 — the Crew keyword is
// usually wired as an *activated* ability (Wave 28 — `K:Crew:N`). The
// `S:Mode$ Crew` static form is rarer and corresponds to a "becomes a
// creature" continuous effect on a Vehicle that does NOT require
// crewing — e.g. Heart of Kiran-shape effects where a counter/cost
// removal grants creature-ness without tapping crew creatures.
//
// Implementation strategy:
//   The "is a creature without crewing" payload reduces to a
//   Continuous Layer-4 type addition (AddType$ Creature). Wave 47
//   already implements this via `S:Mode$ Continuous | Affected$
//   Card.Self | AddType$ Creature`. So the Crew static MVP collapses
//   onto stamping `card.crewStatic = true` (a marker the type-derivation
//   code can read in addition to the regular Continuous AddType path).
//
//   For full Forge parity (the rare static-Crew shape that requires
//   activation), the handler builds an internal ContinuousAddType
//   payload + sets the marker. The MVP sets the marker only; downstream
//   type derivation reads it (via a sibling helper, TODO(advanced)).
//
// DSL (forward-compatible / kickoff-prompt-shape):
//   S:Mode$ Crew | ValidCard$ Card.Self | Power$ N | Description$ ...
//
// Notes for future fidelity:
//   * Forge's enum doesn't enumerate `Crew` as a static-ability mode
//     (only `CantCrew` is in StaticAbilityMode.java). Adding the mode
//     here is a forward-compatibility extension to keep the parser
//     accepting any S:Mode$ Crew that ships from a future card or test.
//   * Power$ N is the crew threshold; for the static form (no crewing
//     needed) the value is informational. We expose it on the payload
//     for downstream consumers and clear it on deactivate.
//
// Routing: cantMustMay category (action-filter family) — keeps the
// registry hookup uniform with the other Wave 60 gates. The actual
// "becomes a creature" semantics flow through the Continuous AddType
// machinery (Layer 4) rather than a cantMustMay restriction; the gate
// here is the registry presence + the per-card flag.
import type { ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { literalRaw } from "./restriction-helpers.js";

export interface CrewStaticPayload {
  readonly kind: "crewStatic";
  /** Crew threshold (informational; the static form doesn't gate on it). */
  readonly power: number;
}

const parseIntDefault = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw.length === 0) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
};

const stampCrewStaticFlag = (game: Game, sourceCardId: number): void => {
  // Stamp the per-card marker so type-derivation can read it without
  // walking the registry each query. Mirrors the buybackPaid /
  // awakenAmount slot pattern (Card-level scratch slots that handlers
  // stamp directly).
  const card = game.cards.get(sourceCardId as never);
  if (!card) return;
  card.crewStaticActive = true;
};

export class CrewStaticHandler extends StaticHandler {
  static override readonly mode = "Crew" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const power = parseIntDefault(literalRaw(params.Power), 0);

    // Stamp the per-card flag on activate. The flag is the durable
    // contract: type-derivation reads it to add Creature to the card's
    // type line without crewing. (Continuous AddType$ Creature wired
    // synthesis → TODO(advanced) — once the synthesizer hook exists,
    // the same handler can register a derived Continuous static.)
    stampCrewStaticFlag(ctx.game, ctx.sourceCardId as unknown as number);

    const payload: CrewStaticPayload = {
      kind: "crewStatic",
      power,
    };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      category: "cantMustMay",
      mode: "Crew",
      describe: () => payload,
    };
  }
}

// Exported for the future deactivate hook in StaticEffectRegistry. Today
// the registry doesn't fire a per-handler deactivate — so the slot
// lifetime mirrors the static's lifetime: re-stamped on re-activate,
// cleared via the registry-walk gate below (consumer reads the flag AND
// confirms the registry still has an active Crew entry for the card).
export const _clearCrewStaticFlag = (game: Game, sourceCardId: number): void => {
  const card = game.cards.get(sourceCardId as never);
  if (!card) return;
  card.crewStaticActive = undefined;
};

staticHandlerRegistry.register(CrewStaticHandler);
