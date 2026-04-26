// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 10 / Wave 32 — Continuous static handler. Forge's "Mode$ Continuous"
// wraps a passel of layered effects (P/T, type, color, ability, text, kw).
// Currently supported parameter cocktails:
//
//   Bestow flagship (Boon Satyr):
//     S:Mode$ Continuous | Affected$ Card.EnchantedBy
//                        | AddPower$ N | AddToughness$ M
//
//   Threshold flagship (Excavating Anurid, ~30 cards):
//     S:Mode$ Continuous | Affected$ Card.Self
//                        | AddPower$ 1 | AddToughness$ 1
//                        | AddKeyword$ Vigilance
//                        | Condition$ Threshold
//
// Affected$:
//   Card.EnchantedBy → target = the card with attachedTo === sourceId.
//   Card.Self        → target = the static's source card itself.
//
// Condition$ (Wave 32) — string-flag conditions evaluated live at apply
// time. `Threshold` checks the controller's graveyard size (≥7). Other
// canonical Forge conditions (Hellbent, Metalcraft, Delirium, FatefulHour,
// Landfall, Heroic, Revolt, Spellmastery) are TODO(advanced) — they'll
// land alongside their flagship waves; the handler permits the param but
// treats them as always-active until promoted (with a //
// TODO(advanced-condition) comment so the omission is auditable).
//
// AddKeyword$ (Wave 32) — space-preserved keyword tokens (e.g. "First
// Strike", "Vigilance") are routed through a Layer 6 keyword grant.
// Multi-keyword grants (rare in Forge) split on ` & `.
//
// Accepted params: Mode, Affected, AddPower, AddToughness, AddKeyword,
// Condition, Description, EffectZone, Mod (the latter two come from the
// parser unchanged). Anything else triggers an unsupported-param throw
// so we don't silently drop card text.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Layer6KeywordGrant } from "../../layers/keyword-layer.js";
import type { LayerPayload } from "../../layers/layer-dispatch.js";
import type { Layer7cEffect } from "../../layers/layer7-pt.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";

const literalRaw = (p: ParamValue | undefined): string | undefined =>
  p && p.kind === "literal" ? p.raw : undefined;

const numericParam = (p: ParamValue | undefined): number => {
  const raw = literalRaw(p);
  if (raw === undefined) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
};

const ACCEPTED_PARAMS: ReadonlySet<string> = new Set([
  "Mode",
  "Affected",
  "AddPower",
  "AddToughness",
  "AddKeyword",
  "Condition",
  "Description",
  "EffectZone",
  "Mod",
]);

/**
 * Wave 32 — evaluate a string-flag Condition$ live against the current
 * game state. Returns true when the condition holds (the static's
 * effects apply); false when it doesn't (effects are suppressed).
 *
 * Threshold (CR 702.74): controller has ≥7 cards in graveyard.
 *
 * Other Forge conditions (Hellbent, Metalcraft, Delirium, FatefulHour,
 * Landfall, Heroic, Revolt, Spellmastery, etc.) are accepted but not
 * yet evaluated — they default to true so the surrounding effect at
 * least applies. Each TODO(advanced-condition) comment marks one for a
 * subsequent wave.
 */
const evalConditionString = (
  cond: string | undefined,
  game: {
    players: ReadonlyArray<{
      readonly seat: number;
      readonly zones: Map<ZoneType, { readonly size: number }>;
    }>;
  },
  controllerSeat: number,
): boolean => {
  if (cond === undefined) return true;
  switch (cond) {
    case "Threshold": {
      const player = game.players.find((p) => p.seat === controllerSeat);
      if (!player) return false;
      const gy = player.zones.get(ZoneType.Graveyard);
      return gy !== undefined && gy.size >= 7;
    }
    // TODO(advanced-condition): Hellbent (controller's hand is empty).
    // TODO(advanced-condition): Metalcraft (controller controls ≥3 artifacts).
    // TODO(advanced-condition): Delirium (≥4 card types in controller's GY).
    // TODO(advanced-condition): FatefulHour (controller has ≤5 life).
    // TODO(advanced-condition): Landfall (a land entered this turn).
    // TODO(advanced-condition): Heroic (you cast a spell targeting CARDNAME).
    // TODO(advanced-condition): Revolt (handled separately on triggers).
    // TODO(advanced-condition): Spellmastery (≥2 instants/sorceries in GY).
    default:
      return true;
  }
};

/** Split AddKeyword$ value on " & " (the rare multi-grant separator). */
const splitKeywords = (raw: string): string[] => {
  const parts = raw.split(/\s+&\s+/);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
};

export class ContinuousStaticHandler extends StaticHandler {
  static override readonly mode = "Continuous" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params = ast.params;
    const affected = literalRaw(params.Affected);
    const addPower = numericParam(params.AddPower);
    const addToughness = numericParam(params.AddToughness);
    const addKeywordRaw = literalRaw(params.AddKeyword);
    const conditionRaw = literalRaw(params.Condition);

    if (affected !== "Card.EnchantedBy" && affected !== "Card.Self") {
      throw new Error(
        `ContinuousStaticHandler: Affected$ "${affected ?? "<missing>"}" not yet supported (only Card.EnchantedBy / Card.Self are implemented in this MVP)`,
      );
    }

    const otherKeys = Object.keys(params).filter((k) => !ACCEPTED_PARAMS.has(k));
    if (otherKeys.length > 0) {
      throw new Error(
        `ContinuousStaticHandler: parameters [${otherKeys.join(", ")}] not yet supported in Continuous mode`,
      );
    }

    const game = ctx.game;
    const sourceId: EntityId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;
    const timestamp = game.newEntityId();

    // Resolve the affected target id at apply time. Card.Self → sourceId
    // when the condition holds; Card.EnchantedBy → the aura's current
    // attachedTo. Returns null to suppress the effect (condition false,
    // attachment missing).
    const targetCardIdFn = (): EntityId | null => {
      if (affected === "Card.Self") {
        if (!evalConditionString(conditionRaw, game, controllerSeat)) return null;
        return sourceId;
      }
      // Card.EnchantedBy
      const aura = game.cards.get(sourceId);
      if (!aura) return null;
      if (!evalConditionString(conditionRaw, game, controllerSeat)) return null;
      return aura.attachedTo;
    };

    // Build payload entries. We always add a pt-modify (delta may be
    // 0/0 — the applier short-circuits for non-creatures and 0/0 is a
    // no-op). When AddKeyword$ is present, append one kw-grant per
    // keyword token (multi-keyword grants are rare but supported).
    const payloads: LayerPayload[] = [];
    if (addPower !== 0 || addToughness !== 0) {
      const layer7c: Layer7cEffect = {
        kind: "modify",
        powerDelta: addPower,
        toughnessDelta: addToughness,
        timestamp,
        sourceAbilityId: ctx.staticId,
        targetCardIdFn,
      };
      payloads.push({ kind: "pt-modify", effect: layer7c });
    }
    if (addKeywordRaw !== undefined) {
      for (const kw of splitKeywords(addKeywordRaw)) {
        const grant: Layer6KeywordGrant = {
          keyword: kw,
          sourceAbilityId: ctx.staticId,
          timestamp,
          targetCardIdFn,
        };
        payloads.push({ kind: "kw-grant", effect: grant });
      }
    }

    // Defensive: a Continuous static with no concrete delta + no keyword
    // grant + no condition would be a no-op. Emit a noop payload so the
    // registry has SOMETHING to register/unregister symmetrically.
    const payload: LayerPayload =
      payloads.length === 0
        ? { kind: "noop" }
        : payloads.length === 1
          ? (payloads[0] as LayerPayload)
          : { kind: "multi", entries: payloads };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);

    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: sourceId,
      activeInZones,
      timestamp,
      controllerSeatAtReg: ctx.controllerSeat,
      category: "continuous",
      mode: "Continuous",
      // describe() must return the same reference every call (referential-
      // equality contract for register/unregister symmetry).
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(ContinuousStaticHandler);
