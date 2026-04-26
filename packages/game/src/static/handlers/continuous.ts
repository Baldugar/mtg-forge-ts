// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 10 — Continuous static handler. Forge's "Mode$ Continuous" wraps a
// passel of layered effects (P/T, type, color, ability, text). This MVP
// covers the subset needed by Bestow's flagship card (Boon Satyr):
//   S:Mode$ Continuous | Affected$ Card.EnchantedBy | AddPower$ N | AddToughness$ M
//
// Affected$ Card.EnchantedBy resolves at apply time to "the card whose
// `attachedTo` equals this static's source card id" — i.e. the creature
// currently enchanted by the Aura emitting this static. Other Affected$
// values fall back to the unhandled-static-mode silent-skip path until
// they're implemented.
//
// AddPower$ / AddToughness$ are routed through Layer 7c (modify P/T) with
// `targetCardIdFn` returning the live attachedTo target. Other parameters
// (AddType$, AddColor$, AddKeyword$, etc.) are out of scope for this
// handler MVP and intentionally cause an unsupported-static throw.
import type { EntityId, ParamValue, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
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

export class ContinuousStaticHandler extends StaticHandler {
  static override readonly mode = "Continuous" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params = ast.params;
    const affected = literalRaw(params.Affected);
    const addPower = numericParam(params.AddPower);
    const addToughness = numericParam(params.AddToughness);

    // Currently we support exactly Affected$ Card.EnchantedBy with
    // AddPower / AddToughness. Anything else flags as unsupported so we
    // don't silently drop card text.
    if (affected !== "Card.EnchantedBy") {
      throw new Error(
        `ContinuousStaticHandler: Affected$ "${affected ?? "<missing>"}" not yet supported (only Card.EnchantedBy is implemented in this MVP)`,
      );
    }
    const otherKeys = Object.keys(params).filter(
      (k) =>
        k !== "Mode" && k !== "Affected" && k !== "AddPower" && k !== "AddToughness" && k !== "Description",
    );
    if (otherKeys.length > 0) {
      throw new Error(
        `ContinuousStaticHandler: parameters [${otherKeys.join(", ")}] not yet supported in Continuous mode`,
      );
    }

    const game = ctx.game;
    const sourceId: EntityId = ctx.sourceCardId;
    const timestamp = game.newEntityId();

    // Build the Layer 7c effect: applied only to the card whose attachedTo
    // points back to the static's source. The function-shape lookup tracks
    // re-attachments without needing to splice/re-register on attach.
    const layer7cEffect: Layer7cEffect = {
      kind: "modify",
      powerDelta: addPower,
      toughnessDelta: addToughness,
      timestamp,
      sourceAbilityId: ctx.staticId,
      targetCardIdFn: () => {
        const aura = game.cards.get(sourceId);
        if (!aura) return null;
        return aura.attachedTo;
      },
    };

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
      describe: () => ({ kind: "pt-modify", effect: layer7cEffect }),
    };
  }
}

staticHandlerRegistry.register(ContinuousStaticHandler);
