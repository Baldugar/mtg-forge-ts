// SPDX-License-Identifier: GPL-3.0-or-later
// DelayedTriggerEffect — Forge `SP$ DelayedTrigger` / `DB$ DelayedTrigger`
// (At-EOC destroy, Phase-Upkeep transform, EndCombat blocker-cleanup, etc.).
// Registers a one-shot delayed trigger on game.delayedTriggerQueue. When the
// matching event fires, the queue forwards it back to the trigger registry
// (mirrors EffectEffect's host-trigger registration path).
//
// Forge DSL examples:
//   SVar:TrigDelayTransform:DB$ DelayedTrigger | Mode$ Phase | Phase$ Upkeep
//                                               | Execute$ TrigTransform
//   SVar:DelTrigBlocked:DB$ DelayedTrigger | Mode$ Phase | Phase$ EndCombat
//                                          | Execute$ TrigDestroy | RememberObjects$ TriggeredAttackerLKICopy
//
// MVP scope:
//   - Mode$ Phase, Phase$ <PhaseStep>: fires on the named StepStarted event.
//   - Mode$ ChangesZone, Origin$ X, Destination$ Y: fires on CardChangedZone.
//   - Execute$ <SVar>: SVar named on the source card; the trigger handler
//     resolves the SVar as a sub-ability when the trigger fires.
//   - RememberObjects$ — captured creation context (Targeted / Self / Remembered).
//
// Implementation: register a DelayedTrigger that, on match, builds a
// SpellAbility from the named SVar and pushes it onto the trigger registry's
// pending queue via onEventForcedByDelayed (existing path used by every
// delayed trigger in the engine).
import type { AbilityAst, EntityId, PhaseStep, SVarAst, ZoneType } from "@mtg-forge-ts/core";
import { ZoneType as Zt } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import { SpellAbility } from "../spell-ability.js";

const PHASE_BY_NAME: Record<string, PhaseStep> = {
  untap: "Untap" as PhaseStep,
  upkeep: "Upkeep" as PhaseStep,
  draw: "Draw" as PhaseStep,
  main1: "Main1" as PhaseStep,
  begincombat: "BeginCombat" as PhaseStep,
  declareattackers: "DeclareAttackers" as PhaseStep,
  declareblockers: "DeclareBlockers" as PhaseStep,
  combatdamage: "CombatDamage" as PhaseStep,
  endcombat: "EndCombat" as PhaseStep,
  main2: "Main2" as PhaseStep,
  end: "End" as PhaseStep,
  cleanup: "Cleanup" as PhaseStep,
};

export class DelayedTriggerEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "DelayedTrigger";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const mode = hasParam(sa, "Mode") ? evaluateParamRaw(sa, "Mode").trim() : "Phase";
    const executeSvar = hasParam(sa, "Execute") ? evaluateParamRaw(sa, "Execute") : "";
    if (!executeSvar) return;

    // Capture creation-context: rememberedIds at registration time.
    let rememberedIds: readonly EntityId[] = [];
    if (hasParam(sa, "RememberObjects")) {
      const tok = evaluateParamRaw(sa, "RememberObjects").trim();
      if (tok === "Targeted") rememberedIds = [...sa.targets];
      else if (tok === "Self") rememberedIds = [sa.sourceCardId];
      else if (tok === "Remembered") {
        const src = game.cards.get(sa.sourceCardId);
        if (src) rememberedIds = [...src.remembered];
      }
    }

    const dtId = game.newEntityId();
    const sourceCardId = sa.sourceCardId;
    const ownerSeat = sa.controllerSeat;
    const svars = sa.svars;
    const createdAtTurn = game.turn;

    // Build a per-event match predicate based on Mode$.
    let matches: (event: { kind: string; payload: unknown }) => boolean;
    if (mode === "Phase") {
      const phaseRaw = (hasParam(sa, "Phase") ? evaluateParamRaw(sa, "Phase") : "End").toLowerCase();
      const phaseStep = PHASE_BY_NAME[phaseRaw] ?? ("End" as PhaseStep);
      matches = (event) => {
        if (event.kind !== "StepStarted") return false;
        const p = event.payload as { step?: PhaseStep };
        return p.step === phaseStep;
      };
    } else if (mode === "ChangesZone" || mode === "ChangeZone") {
      const origin = hasParam(sa, "Origin") ? (evaluateParamRaw(sa, "Origin") as ZoneType) : Zt.Battlefield;
      const dest = hasParam(sa, "Destination")
        ? (evaluateParamRaw(sa, "Destination") as ZoneType)
        : Zt.Graveyard;
      matches = (event) => {
        if (event.kind !== "CardChangedZone") return false;
        const p = event.payload as { fromZone?: ZoneType; toZone?: ZoneType };
        return p.fromZone === origin && p.toZone === dest;
      };
    } else {
      // Unknown mode — register a never-matches predicate so the trigger is
      // inert (better than throwing; corpus may have niche modes).
      matches = () => false;
    }

    // On match, run the executeSvar as a sub-ability inline. We register a
    // matches() side-effect that drives the SVar resolution; this mirrors
    // the cleanup-on-match pattern in EffectEffect.ExileOnMoved.
    const tearDown = (): void => {
      const sv: SVarAst | undefined = svars.get(executeSvar);
      if (!sv || sv.kind !== "ability" || !sv.ability) return;
      const fakeAst: AbilityAst = {
        kind: "spell",
        effect: sv.ability,
        cost: { raw: "" },
      };
      const subSa = new SpellAbility(fakeAst, sourceCardId, ownerSeat, svars, [...rememberedIds]);
      // Drive the resolver synchronously for MVP — drains every yield on
      // the spot. For full fidelity (decisions, replacement-pipeline events)
      // a follow-up wave will route through the trigger-stack-push path
      // used by triggered-ability handlers.
      const resolver = subSa.makeResolver();
      const gen = resolver.resolve(game) as Generator<unknown, void, unknown>;
      let r = gen.next();
      while (!r.done) r = gen.next();
    };

    game.delayedTriggerQueue.add({
      id: dtId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([Zt.Battlefield, Zt.Stack, Zt.Graveyard, Zt.Command]),
      timestamp: 0,
      controllerSeatAtReg: ownerSeat,
      isDelayed: true,
      createdAtTurn,
      creationContext: { rememberedIds },
      oneShot: true,
      matches(event) {
        if (!matches(event as unknown as { kind: string; payload: unknown })) return false;
        tearDown();
        return true;
      },
    });
  }
}

effectRegistry.register(DelayedTriggerEffect);
