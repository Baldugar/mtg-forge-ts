// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.L — MustTarget static handler. Forge's
// StaticAbilityMustTarget.java equivalent — POSITIVE target-permission
// gate that REQUIRES at least one of the matched candidates to be
// chosen (when able). This is the Flagbearer mechanic.
//
// Forge cards using this (3 cards in corpus, all Flagbearer):
//   - Coalition Flag         (Aura: enchanted creature is a Flagbearer.
//                              "While an opponent is choosing targets as
//                              part of casting a spell they control or
//                              activating an ability they control, that
//                              player must choose at least one
//                              Flagbearer on the battlefield if able.")
//   - Coalition Honor Guard  (creature: same text).
//   - Standard Bearer        (creature: same text).
//
// DSL examples (corpus):
//   S:Mode$ MustTarget | ValidSA$ Spell.OppCtrl,Activated.OppCtrl
//                      | ValidTarget$ Flagbearer | ValidZone$ Battlefield
//
// What it does (Forge): consulted at target-selection / cast pipeline.
// When an opponent's spell or activated ability is choosing targets,
// the chooser is required to include at least one Flagbearer on the
// battlefield in the target set (provided one exists AND the spell can
// legally target one with at least one of its target slots). If no
// Flagbearer can legally be targeted, the requirement is vacuous.
//
// Routing: cantMustMay per MODE_TO_CATEGORY. Read-side helper
// (`mustTargetCandidates` in wave70l-target-gates.ts) walks the
// registry per-cast/activation and exposes the eligible-Flagbearer set
// the validator must check at validateAtCast time.
//
// MVP scope:
//   - ValidSA$ <filter>      → comma-separated tokens. Each token has a
//                               "Spell"/"Activated" prefix optionally
//                               followed by ".OppCtrl"/".YouCtrl"
//                               controller filter; the Forge corpus
//                               only uses ".OppCtrl" + plain "Spell"/
//                               "Activated" today. We parse into
//                               (saKind, controllerScope) tuples.
//   - ValidTarget$ <filter>  → cardMatchesFilter (Wave 32 grammar).
//                               Selects which cards count as
//                               "Flagbearer" candidates.
//   - ValidZone$ <zone>      → restricts the candidate set to the
//                               specified zone (Battlefield in the
//                               corpus). Empty = battlefield default.
import type { EntityId, ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

/**
 * SA classification used by the helper. The static's controllerSeat is
 * baked into each token's "controllerScope" — e.g. ".OppCtrl" tokens
 * resolve relative to the static's controller seat at query time.
 */
export interface MustTargetSA {
  readonly kind: "spell" | "ability" | "triggered";
  readonly controllerSeat: PlayerSeat;
}

interface SaToken {
  readonly kind: "spell" | "ability" | "triggered";
  /** "OppCtrl" / "YouCtrl" / undefined (= any controller). */
  readonly controllerScope?: "OppCtrl" | "YouCtrl";
}

const parseSaTokens = (raw: string | undefined): readonly SaToken[] => {
  if (raw === undefined || raw.length === 0) return [];
  const out: SaToken[] = [];
  for (const tok of raw.split(",").map((t) => t.trim())) {
    let kind: "spell" | "ability" | "triggered" | undefined;
    let scope: "OppCtrl" | "YouCtrl" | undefined;
    let head = tok;
    let tail: string | undefined;
    const dot = tok.indexOf(".");
    if (dot >= 0) {
      head = tok.slice(0, dot);
      tail = tok.slice(dot + 1);
    }
    // Wave 96 — broader SA-kind heads. "Triggered" lands so the
    // Flagbearer gate also constrains targeting choices made during
    // triggered-ability resolution (CR 603.3d). "Any" / "SpellOrAbility"
    // are aliases for the unconstrained-kind shape.
    if (head === "Spell") kind = "spell";
    else if (head === "Activated") kind = "ability";
    else if (head === "Triggered") kind = "triggered";
    else if (head === "Any" || head === "SpellOrAbility")
      kind = "spell"; // any kind matches
    else continue; // truly-unknown head — skip
    if (tail === "OppCtrl") scope = "OppCtrl";
    else if (tail === "YouCtrl") scope = "YouCtrl";
    else if (tail === undefined) scope = undefined;
    else continue; // unknown tail — skip
    // For the Any / SpellOrAbility alias, emit one token per kind so the
    // saMatches walk treats them as a wildcard. Cheaper than threading a
    // sentinel through the matcher.
    if (head === "Any" || head === "SpellOrAbility") {
      const base = scope === undefined ? {} : { controllerScope: scope };
      out.push({ kind: "spell", ...base });
      out.push({ kind: "ability", ...base });
      out.push({ kind: "triggered", ...base });
      continue;
    }
    out.push(scope === undefined ? { kind } : { kind, controllerScope: scope });
  }
  return out;
};

/**
 * Read-side payload exposing the gate predicates and zone filter. The
 * helper at the cast/activate site consults `saMatches` and
 * `targetMatches` and walks `game.cards` to surface the eligible
 * candidate set per-query.
 */
export interface MustTargetPayload {
  readonly kind: "mustTarget";
  /** True iff the SA matches ValidSA$ (kind + controller scope). */
  readonly saMatches: (sa: MustTargetSA) => boolean;
  /** True iff the candidate target card matches ValidTarget$. */
  readonly targetMatches: (cardId: EntityId, game: Game) => boolean;
  /** Required zone for candidates (undefined = battlefield default). */
  readonly validZone: ZoneType;
}

export class MustTargetStaticHandler extends StaticHandler {
  static override readonly mode = "MustTarget" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;

    const validSARaw = literalRaw(params.ValidSA);
    const validTargetRaw = literalRaw(params.ValidTarget) ?? "Card";
    const validZoneRaw = literalRaw(params.ValidZone);

    const saTokens = parseSaTokens(validSARaw);
    const targetPred = buildCardIdPredicate(validTargetRaw, ctx.sourceCardId, ctx.controllerSeat);
    const validZone: ZoneType =
      validZoneRaw === "Hand"
        ? ZoneType.Hand
        : validZoneRaw === "Graveyard"
          ? ZoneType.Graveyard
          : validZoneRaw === "Exile"
            ? ZoneType.Exile
            : validZoneRaw === "Library"
              ? ZoneType.Library
              : validZoneRaw === "Stack"
                ? ZoneType.Stack
                : ZoneType.Battlefield;

    const staticCtrl = ctx.controllerSeat;

    const payload: MustTargetPayload = {
      kind: "mustTarget",
      saMatches: (sa) => {
        if (saTokens.length === 0) return true;
        for (const t of saTokens) {
          if (t.kind !== sa.kind) continue;
          if (t.controllerScope === undefined) return true;
          if (t.controllerScope === "OppCtrl" && sa.controllerSeat !== staticCtrl) return true;
          if (t.controllerScope === "YouCtrl" && sa.controllerSeat === staticCtrl) return true;
        }
        return false;
      },
      targetMatches: (cardId, game) => targetPred(cardId, game),
      validZone,
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
      mode: "MustTarget",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(MustTargetStaticHandler);
