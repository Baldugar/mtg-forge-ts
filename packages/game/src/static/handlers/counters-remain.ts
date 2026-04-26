// SPDX-License-Identifier: GPL-3.0-or-later
// CountersRemainStaticHandler — Forge's `S:Mode$ CountersRemain` static
// ability. Used by cards like Skullbriar, the Walking Grave and Me, the
// Immortal:
//   S:Mode$ CountersRemain | ValidCard$ Card.Self | EffectZone$ All
//   | Description$ Counters remain on NICKNAME as it moves to any zone other than a player's hand or library.
//
// Semantics (CR 122.6 + 121.5): when a permanent moves between zones,
// it normally enters the new zone as a new object with no counters.
// `S:Mode$ CountersRemain` overrides that: the same counters carry over
// to the new object (or, equivalently, the engine refrains from clearing
// them) for any destination other than hand or library.
//
// Implementation: this static is `replacementGenerating` (per
// static-ability-mode.ts category map). On register it derives a
// ReplacementAbility that intercepts a synthetic `clearCountersOnZoneChange`
// mutation intent. SP3's engine does NOT yet emit that intent (counters
// are not auto-cleared on zone change in our port — every Card object's
// `counters` Map persists across zone moves naturally). This makes the
// generated replacement effectively a no-op at runtime today, but the
// generator exists so:
//   (1) the parser doesn't reject the line as an unknown mode,
//   (2) the static's lifecycle is wired through StaticEffectRegistry,
//   (3) when SP4 introduces the auto-clear-on-zone-change behavior, this
//       generator already produces the corresponding replacement and the
//       cards' rules text becomes mechanically active without a code
//       change at the card layer.
//
// MVP support: ValidCard$ Card.Self is recognized; the generated
// replacement matches when the synthetic clear intent's cardId equals
// sourceCardId. EffectZone$ All means the static activates in every
// zone — normalizeActiveInZones expands "all" to every real zone.
import type {
  EntityId,
  MutationIntent,
  ParamValue,
  ReplacementAbility,
  StaticAbility,
  StaticAst,
} from "@mtg-forge-ts/core";
import type { ReplacementGenPayload } from "../../statics/replacement-generating.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";

const literalRaw = (p: ParamValue | undefined): string | undefined =>
  p && p.kind === "literal" ? p.raw : undefined;

export class CountersRemainStaticHandler extends StaticHandler {
  static override readonly mode = "CountersRemain" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const validCardRaw = literalRaw(ast.params.ValidCard) ?? "Card.Self";
    const { game, sourceCardId, controllerSeat, staticId } = ctx;
    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    const timestamp = game.newEntityId();

    // Derive the replacement that prevents auto-clear-counters on a
    // zone change to non-hand/non-library destinations. The runtime
    // doesn't yet emit the matching intent kind, so this replacement is
    // inert at execution time today — but it lives in the registry the
    // moment the static activates, satisfying the lifecycle contract.
    const replacementId: EntityId = game.newEntityId();
    const generatedReplacement: ReplacementAbility = {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones,
      timestamp,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: false,
      layer: "cantHappen",

      matches(intent: MutationIntent): boolean {
        // Synthetic intent kind reserved for the future auto-clear flow:
        //   { kind: "clearCountersOnZoneChange", cardId, toZone }
        // The replacement matches when the affected card matches
        // ValidCard$ and the destination zone is not hand/library.
        const kind = (intent as { kind?: string }).kind;
        if (kind !== "clearCountersOnZoneChange") return false;
        const mi = intent as { cardId?: EntityId; toZone?: string };
        if (mi.cardId === undefined) return false;
        if (validCardRaw === "Card.Self") {
          if (mi.cardId !== sourceCardId) return false;
        } else if (validCardRaw !== "Card") {
          // Other ValidCard$ values deferred to SP4.
          return false;
        }
        // Counters always remain unless the destination is hand or
        // library (CR 122.6). The Forge SVar omits the destination
        // filter — every CountersRemain rules text mentions "any zone
        // other than a player's hand or library".
        if (mi.toZone === "Hand" || mi.toZone === "Library") return false;
        return true;
      },

      apply(_intent: MutationIntent, _game: unknown): MutationIntent | null {
        // Prevent the synthetic clear → counters carry over.
        return null;
      },
    };

    const payload: ReplacementGenPayload = {
      kind: "replacementGen",
      replacements: [generatedReplacement],
    };

    return {
      id: staticId,
      kind: "static",
      sourceCardId,
      activeInZones,
      timestamp,
      controllerSeatAtReg: controllerSeat,
      category: "replacementGenerating",
      mode: "CountersRemain",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(CountersRemainStaticHandler);
