// SPDX-License-Identifier: GPL-3.0-or-later
// RandomLegalController — SP2 Milestone W Task 73. Covers every one of the
// 51 DecisionRequest kinds with a deterministic random-legal strategy. The
// shared Rng drives every pick so test replays are reproducible under a
// fixed seed. SP3 expands this further with cost-aware heuristics; SP2's
// scope is "pick a legal answer, any legal answer" so driver tests can
// exercise full flows without hand-rolling per-kind responses.
import type { DecisionRequest, DecisionResponse, PlayerSeat, PriorityAction, Rng } from "@mtg-forge-ts/core";
import { Color, ColorSet, IllegalDecisionError } from "@mtg-forge-ts/core";
import type { PlayerController } from "./controller.js";

export class RandomLegalController implements PlayerController {
  constructor(private readonly rng: Rng) {}

  decide(req: DecisionRequest): DecisionResponse {
    switch (req.kind) {
      // === SP1 baseline ===
      case "priority":
        return { kind: "priority", action: this.pickPriorityAction(req.legalActions) };
      case "mulligan":
        return { kind: "mulligan", keep: true };
      case "mulliganBottom":
        return { kind: "mulliganBottom", bottomed: req.hand.slice(0, req.countToBottom) };
      case "openingHandAction":
        return { kind: "openingHandAction", chosenActions: [] };
      case "chooseTargets":
        return { kind: "chooseTargets", targets: this.pickCount(req.choicesAllowed, req.min, req.max) };
      case "chooseModes":
        return { kind: "chooseModes", modeIds: this.pickModeIds(req.modes, req.min, req.max) };
      case "chooseX":
        return { kind: "chooseX", x: this.rng.nextInt(0, req.maxX + 1) };
      case "distribute": {
        const assignments = new Array(req.recipients.length).fill(0) as number[];
        for (let i = 0; i < req.recipients.length; i++) {
          assignments[i] = req.minPerRecipient;
        }
        const minTotal = req.recipients.length * req.minPerRecipient;
        let remaining = req.amount - minTotal;
        if (remaining < 0) remaining = 0;
        if (assignments.length > 0 && assignments[0] !== undefined) {
          assignments[0] = assignments[0] + remaining;
        }
        return { kind: "distribute", assignments };
      }
      case "choosePayment":
        return { kind: "choosePayment", plan: null };
      case "orderTriggers":
        return { kind: "orderTriggers", order: [...req.triggerIds] };
      case "orderReplacements":
        return { kind: "orderReplacements", order: [...req.replacementIds] };
      case "declareAttackers":
        return { kind: "declareAttackers", attackers: [] };
      case "declareBlockers":
        return { kind: "declareBlockers", blocks: [] };
      case "orderBlockers":
        return { kind: "orderBlockers", order: [...req.blockers] };
      case "assignDamage": {
        const slots = req.blockerOrder.length;
        const assignments = new Array(slots).fill(0) as number[];
        if (slots > 0) assignments[0] = req.amountToAssign;
        return { kind: "assignDamage", assignments };
      }
      case "chooseCard":
        return { kind: "chooseCard", chosen: this.pickCount(req.pool, req.min, req.max) };
      case "chooseCardOrder":
        return { kind: "chooseCardOrder", order: [...req.cards] };
      case "scry":
        return { kind: "scry", toTop: [...req.cards], toBottom: [] };
      case "surveil":
        return { kind: "surveil", toTop: [...req.cards], toGraveyard: [] };
      case "chooseOption": {
        if (req.options.length === 0) {
          throw new IllegalDecisionError("RandomLegalController: chooseOption with no options");
        }
        return { kind: "chooseOption", optionId: this.rng.choose(req.options).id };
      }
      case "declareSplit":
        return {
          kind: "declareSplit",
          faceIds: req.faces.length > 0 ? [req.faces[0]?.id ?? ""] : [],
        };
      case "choosePlayer":
        return {
          kind: "choosePlayer",
          chosen: this.pickPlayerCount(req.min, req.max),
        };
      case "chooseZone": {
        if (req.zones.length === 0) {
          throw new IllegalDecisionError("RandomLegalController: chooseZone with no zones");
        }
        const z = req.zones[0];
        if (z === undefined) {
          throw new IllegalDecisionError("RandomLegalController: chooseZone zone[0] undefined");
        }
        return { kind: "chooseZone", chosen: z };
      }
      case "chooseAltCost":
        return {
          kind: "chooseAltCost",
          altCostId: req.altCosts.length > 0 ? (req.altCosts[0]?.id ?? "") : "",
        };
      // === Post-audit generic choosers ===
      case "chooseNumber":
        return { kind: "chooseNumber", chosen: this.rng.nextInt(req.min, req.max + 1) };
      case "chooseColor": {
        const colors = [Color.White, Color.Blue, Color.Black, Color.Red, Color.Green];
        if (req.allowColorless && this.rng.nextInt(0, 2) === 0) {
          return { kind: "chooseColor", color: null };
        }
        return { kind: "chooseColor", color: this.rng.choose(colors) };
      }
      case "chooseColors": {
        const colors = [Color.White, Color.Blue, Color.Black, Color.Red, Color.Green];
        const count = this.rng.nextInt(req.min, Math.min(req.max, 5) + 1);
        const shuffled = this.rng.shuffle(colors);
        const picked = shuffled.slice(0, count);
        return { kind: "chooseColors", colors: ColorSet.of(...picked) };
      }
      case "chooseCounterType":
        return { kind: "chooseCounterType", counterTypes: [] };
      case "chooseCardsPile":
        return { kind: "chooseCardsPile", chosen: this.rng.nextInt(0, 2) === 0 ? "a" : "b" };
      case "vote": {
        if (req.choices.length === 0) {
          throw new IllegalDecisionError("RandomLegalController: vote with no choices");
        }
        return { kind: "vote", voteId: this.rng.choose(req.choices).id };
      }
      case "confirmAction":
        return { kind: "confirmAction", confirmed: this.rng.nextInt(0, 2) === 0 };
      case "confirmReplacement":
        return { kind: "confirmReplacement", applied: this.rng.nextInt(0, 2) === 0 };
      case "confirmTrigger":
        return { kind: "confirmTrigger", use: this.rng.nextInt(0, 2) === 0 };
      case "chooseStartingPlayer":
        return { kind: "chooseStartingPlayer", goFirst: this.rng.nextInt(0, 2) === 0 };
      case "chooseOptionalCosts":
        return { kind: "chooseOptionalCosts", chosenIds: [] };
      case "chooseKeywordForPump": {
        if (req.keywords.length === 0) {
          throw new IllegalDecisionError("RandomLegalController: chooseKeywordForPump with no keywords");
        }
        return { kind: "chooseKeywordForPump", keyword: this.rng.choose(req.keywords) };
      }
      case "chooseProtectionType":
        return { kind: "chooseProtectionType", protection: "color", value: "white" };
      // === Die-roll modifiers ===
      case "chooseRollToModify":
        return { kind: "chooseRollToModify", apply: this.rng.nextInt(0, 2) === 0 };
      case "chooseRollToReroll":
        return { kind: "chooseRollToReroll", reroll: this.rng.nextInt(0, 2) === 0 };
      case "chooseRollToIgnore":
        return { kind: "chooseRollToIgnore", ignoredRollIds: [] };
      case "chooseRollToSwap":
        return { kind: "chooseRollToSwap", swap: null };
      // === Attractions / Contraptions ===
      case "chooseSector": {
        if (req.sectorIds.length === 0) {
          throw new IllegalDecisionError("RandomLegalController: chooseSector with no sectors");
        }
        return { kind: "chooseSector", sectorId: this.rng.choose(req.sectorIds) };
      }
      case "chooseSprocket": {
        if (req.sprockets.length === 0) {
          throw new IllegalDecisionError("RandomLegalController: chooseSprocket with no sprockets");
        }
        return { kind: "chooseSprocket", sprocket: this.rng.choose(req.sprockets) };
      }
      case "chooseContraptionsToCrank":
        return { kind: "chooseContraptionsToCrank", chosen: [] };
      // === SP2 milestone additions ===
      case "chooseLegendKeeper":
        if (req.candidateIds.length === 0) {
          throw new IllegalDecisionError("RandomLegalController: chooseLegendKeeper with no candidates");
        }
        return { kind: "chooseLegendKeeper", keeperId: this.rng.choose(req.candidateIds) };
      case "chooseFace":
        if (req.options.length === 0) {
          throw new IllegalDecisionError("RandomLegalController: chooseFace with no options");
        }
        return { kind: "chooseFace", face: this.rng.choose(req.options) };
      case "chooseCastTargets": {
        const picked = req.legalTargets.slice(0, req.min);
        if (req.divideX !== undefined && picked.length > 0) {
          const per = Math.floor(req.divideX.amount / picked.length);
          const rem = req.divideX.amount - per * picked.length;
          const divisions: Record<number, number> = {};
          for (let i = 0; i < picked.length; i++) {
            divisions[i] = per + (i === 0 ? rem : 0);
          }
          return { kind: "chooseCastTargets", targets: picked, divisions };
        }
        return { kind: "chooseCastTargets", targets: picked };
      }
      case "activateManaAbilities":
        return { kind: "activateManaAbilities", done: true };
      case "chooseRingBearer":
        if (req.currentBearer !== null) {
          return { kind: "chooseRingBearer", bearerId: null };
        }
        if (req.candidateIds.length === 0) {
          return { kind: "chooseRingBearer", bearerId: null };
        }
        return { kind: "chooseRingBearer", bearerId: this.rng.choose(req.candidateIds) };
      case "chooseProliferateTargets":
        return {
          kind: "chooseProliferateTargets",
          chosenCards: [],
          chosenPlayers: [],
          counterChoices: {},
        };
      case "companionDeclaration":
        return { kind: "companionDeclaration", companionId: null };
      // Wave 4 — ChooseTypeEffect
      case "chooseType":
        return { kind: "chooseType", type: "Goblin" };
      // Wave 15 — GenericChoiceEffect / NameCardEffect
      case "chooseGenericOption": {
        const first = req.options[0];
        return { kind: "chooseGenericOption", optionId: first ? first.id : "" };
      }
      case "nameCard":
        return { kind: "nameCard", cardName: "Forest" };
      // Wave 23 — Convoke / Improvise: random-legal declines (no taps).
      // Picking a random subset is legal but adds nondeterminism without
      // satisfying any specific test scenario.
      case "chooseConvokeImproviseTap":
        return { kind: "chooseConvokeImproviseTap", tapIds: [] };
      // Wave 24 — Crew / Saddle: random-legal declines (no taps). The
      // synthesized activated ability fizzles cleanly when tapIds is empty.
      case "chooseCrewSaddleCreatures":
        return { kind: "chooseCrewSaddleCreatures", tapIds: [] };
      // Wave 26 — Conspire: random-legal declines (no taps → no copy).
      case "chooseConspireTap":
        return { kind: "chooseConspireTap", tapIds: [] };
      default: {
        const _never: never = req;
        throw new IllegalDecisionError(
          `RandomLegalController: unhandled decision kind ${String((_never as { kind?: string }).kind)}`,
        );
      }
    }
  }

  // === Helpers ===

  private pickPriorityAction(legal: readonly PriorityAction[]): PriorityAction {
    const pass = legal.find((a) => a.kind === "pass");
    if (pass) return pass;
    const concede = legal.find((a) => a.kind === "concede");
    if (concede) return concede;
    if (legal.length === 0) {
      throw new IllegalDecisionError("RandomLegalController: priority with empty legalActions");
    }
    return this.rng.choose(legal);
  }

  private pickCount<T>(pool: readonly T[], min: number, max: number): readonly T[] {
    const actualMax = Math.min(max, pool.length);
    const actualMin = Math.min(min, actualMax);
    const count = this.rng.nextInt(actualMin, actualMax + 1);
    return this.rng.shuffle(pool).slice(0, count);
  }

  private pickModeIds(
    modes: readonly { readonly id: string }[],
    min: number,
    max: number,
  ): readonly string[] {
    const actualMax = Math.min(max, modes.length);
    const actualMin = Math.min(min, actualMax);
    const count = this.rng.nextInt(actualMin, actualMax + 1);
    return this.rng
      .shuffle(modes)
      .slice(0, count)
      .map((m) => m.id);
  }

  private pickPlayerCount(min: number, max: number): readonly PlayerSeat[] {
    if (min > 0) {
      throw new IllegalDecisionError(
        `RandomLegalController: choosePlayer requires min=${min} > 0 but no choice set provided`,
      );
    }
    void max;
    return [];
  }
}
