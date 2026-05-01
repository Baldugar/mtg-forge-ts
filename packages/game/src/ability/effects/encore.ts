// SPDX-License-Identifier: GPL-3.0-or-later
// EncoreEffect — resolver for the synthesized Encore graveyard-zone
// activated ability (Commander Legends, CR 702.143).
//
// CR 702.143a — "Encore [cost]" — "[cost], Exile this card from your
// graveyard: For each opponent, create a token that's a copy of this
// card, except it's a Spirit in addition to its other types. Each
// token gains haste and is tapped and attacking that opponent.
// Sacrifice them at the beginning of the next end step. Activate only
// as a sorcery."
//
// MVP scope (Wave 61.F):
//   1. For each opponent of the controller, create one token-copy of
//      the source via game.action.createToken with isCopy=true. Stamp
//      tokenOverrides.addedTypes = ["Spirit"] so derived characteristics
//      report the token as a Spirit in addition to its other types.
//   2. Stamp `tapped = true`, `attackingDefender = <opponent seat>`,
//      and `keywords += "haste"` on each token. The tapped + attacking
//      stamps are duck-typed slots consumed by the combat module
//      (mirroring NinjutsuEffect's stamp pattern).
//   3. Register a one-shot delayed trigger on StepStarted (step=End)
//      that sacrifices the spawned tokens at the start of the next End
//      step. Mirrors MobilizeKeywordHandler's EOT-sac pattern.
//
// The exile-self cost is paid by CostExileSelfFromGrave before this
// resolver runs, courtesy of the SpellAbility's cost string
// `<cost>, ExileFromGrave<1/CARDNAME>`.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class EncoreEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Encore";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const source = game.cards.get(sa.sourceCardId);
    if (!source) return;
    const controller = sa.controllerSeat;

    // Enumerate live opponents (every seat that isn't the controller).
    // Encore explicitly says "for each opponent", so we don't filter on
    // hasLost — by the time activation could fire, lost players are
    // already gone from the active roster anyway.
    const opponents: PlayerSeat[] = [];
    for (const p of game.players) {
      if (p.seat !== controller) opponents.push(p.seat);
    }
    if (opponents.length === 0) return;

    const spawnedIds: EntityId[] = [];
    for (const oppSeat of opponents) {
      const ids = yield* game.action.createToken({
        paperCard: source.paperCard,
        controller,
        count: 1,
        isCopy: true,
        copyOf: sa.sourceCardId,
      });
      for (const tokId of ids) {
        const tok = game.cards.get(tokId);
        if (!tok) continue;
        // Spirit-type addition (per CR 702.143a).
        tok.tokenOverrides = {
          ...(tok.tokenOverrides ?? {}),
          addedTypes: [...(tok.tokenOverrides?.addedTypes ?? []), "Spirit"],
        };
        // Haste keyword grant (CR 702.143a — "gains haste").
        if (!tok.keywords) tok.keywords = new Set();
        tok.keywords.add("haste");
        // Tapped + attacking-that-opponent stamp.
        tok.tapped = true;
        (tok as unknown as { attackingDefender?: PlayerSeat }).attackingDefender = oppSeat;
        spawnedIds.push(tokId);
      }
    }

    // EOT sacrifice — one-shot delayed trigger on the next End step.
    if (spawnedIds.length === 0) return;
    const dtId = game.newEntityId();
    const sourceCardId = sa.sourceCardId;
    game.delayedTriggerQueue.add({
      id: dtId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield, ZoneType.Stack, ZoneType.Graveyard, ZoneType.Exile]),
      timestamp: 0,
      controllerSeatAtReg: controller,
      isDelayed: true,
      createdAtTurn: game.turn,
      creationContext: { rememberedIds: spawnedIds },
      oneShot: true,
      matches(event) {
        if (event.kind !== "StepStarted") return false;
        const p = (event as unknown as { payload?: { step?: string } }).payload;
        if (p?.step !== "EndStep" && p?.step !== "End") return false;
        for (const tid of spawnedIds) {
          const t = game.cards.get(tid);
          if (!t) continue;
          if (t.zone !== ZoneType.Battlefield) continue;
          const gen = game.action.sacrifice(tid, { sourceId: sourceCardId });
          let r = gen.next();
          while (!r.done) r = gen.next();
        }
        return true;
      },
    });
  }
}

effectRegistry.register(EncoreEffect);
