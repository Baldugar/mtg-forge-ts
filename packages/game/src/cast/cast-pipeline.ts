// SPDX-License-Identifier: GPL-3.0-or-later
// CR 601.2 — cast pipeline (10-step generator). Each step may yield a
// decision; the step body updates the CastContext based on the response.
//
// Task 35: skeleton — step methods exist as generator stubs; Tasks 36-39
// populate:
//   - Task 36 fills steps 1-4 (Propose / ChooseFace / ChooseZoneOverride /
//     ChooseAltCosts).
//   - Task 37 fills steps 5-7 (ChooseModes / DistributeX / ChooseTargets).
//   - Task 38 fills steps 8-10 (DetermineTotalCost / ActivateManaAbilities /
//     PayCosts) plus finalizeStackItem provenance population.
//   - Task 39 fills abort() + cost-unwind.
//
// run() returns the finalized StackItem on success; null on abort.
//
// WHY protected step methods + single orchestrating run(): tests (and future
// specialized cast paths — cascade, storm copies, flashback) subclass and
// override individual steps without reimplementing the dispatch.
import type { EntityId, PlayerSeat, ZoneType } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";
import type { StackItem, StackItemProvenance } from "../stack/stack-item.js";
import type { CastContext } from "./cast-context.js";
import { createCastContext } from "./cast-context.js";

export interface CastProposal {
  readonly castingPlayer: PlayerSeat;
  readonly sourceCardId: EntityId;
  readonly originZone: ZoneType;
  readonly asSpecialAction: boolean;
}

export class CastPipeline {
  constructor(protected readonly game: Game) {}

  *run(proposal: CastProposal): Generator<EngineYield, StackItem | null, unknown> {
    const ctx = createCastContext(proposal);
    try {
      yield* this.stepPropose(ctx);
      yield* this.stepChooseFace(ctx);
      yield* this.stepChooseZoneOverride(ctx);
      yield* this.stepChooseAltCosts(ctx);
      yield* this.stepChooseModes(ctx);
      yield* this.stepDistributeX(ctx);
      yield* this.stepChooseTargets(ctx);
      yield* this.stepDetermineTotalCost(ctx);
      yield* this.stepActivateManaAbilities(ctx);
      yield* this.stepPayCosts(ctx);
      return this.finalizeStackItem(ctx);
    } catch (err) {
      yield* this.abort(ctx, err);
      return null;
    }
  }

  // Step stubs — each is a generator that may yield decisions. Tasks 36-39
  // fill in. biome-ignore on each no-op stub because correctness/useYield
  // doesn't account for intentionally-empty generator bodies. Keeping the
  // stubs no-op makes the pipeline runnable end-to-end on simple inputs
  // even before full step logic lands, which lets Task 35 tests exercise
  // the dispatch contract in isolation.

  // biome-ignore lint/correctness/useYield: stub — populated by Task 36
  protected *stepPropose(_ctx: CastContext): Generator<EngineYield, void, unknown> {
    return;
  }

  // biome-ignore lint/correctness/useYield: stub — populated by Task 36
  protected *stepChooseFace(_ctx: CastContext): Generator<EngineYield, void, unknown> {
    return;
  }

  // biome-ignore lint/correctness/useYield: stub — populated by Task 36
  protected *stepChooseZoneOverride(_ctx: CastContext): Generator<EngineYield, void, unknown> {
    return;
  }

  // biome-ignore lint/correctness/useYield: stub — populated by Task 36
  protected *stepChooseAltCosts(_ctx: CastContext): Generator<EngineYield, void, unknown> {
    return;
  }

  // biome-ignore lint/correctness/useYield: stub — populated by Task 37
  protected *stepChooseModes(_ctx: CastContext): Generator<EngineYield, void, unknown> {
    return;
  }

  // biome-ignore lint/correctness/useYield: stub — populated by Task 37
  protected *stepDistributeX(_ctx: CastContext): Generator<EngineYield, void, unknown> {
    return;
  }

  // biome-ignore lint/correctness/useYield: stub — populated by Task 37
  protected *stepChooseTargets(_ctx: CastContext): Generator<EngineYield, void, unknown> {
    return;
  }

  // biome-ignore lint/correctness/useYield: stub — populated by Task 38
  protected *stepDetermineTotalCost(_ctx: CastContext): Generator<EngineYield, void, unknown> {
    return;
  }

  // biome-ignore lint/correctness/useYield: stub — populated by Task 38
  protected *stepActivateManaAbilities(_ctx: CastContext): Generator<EngineYield, void, unknown> {
    return;
  }

  // biome-ignore lint/correctness/useYield: stub — populated by Task 38
  protected *stepPayCosts(_ctx: CastContext): Generator<EngineYield, void, unknown> {
    return;
  }

  /**
   * Task 38 fills out the full StackItem shape (costPaid, modes, xValue).
   * Task 35 returns the minimal StackItem the type requires so the skeleton
   * is runnable in tests. The provenance record carries the SP2-complete
   * subset (originZone + alt/additional cost markers + face/mode/x fields)
   * — cascade/copy fields are populated by the cascade + copy subsystems
   * (Tasks 37+, SP2 Milestone P).
   */
  protected finalizeStackItem(ctx: CastContext): StackItem {
    const id = this.game.newEntityId();
    const provenance: StackItemProvenance = {
      originZone: ctx.originZone,
      altCostUsed: ctx.altCostUsed,
      additionalCostsPaid: [...ctx.additionalCostsPaid],
      ...(ctx.alternativeZoneDestination !== undefined
        ? { alternativeZoneDestination: ctx.alternativeZoneDestination }
        : {}),
      ...(ctx.faceChosen !== undefined ? { faceChosen: ctx.faceChosen } : {}),
      ...(ctx.modesChosen.length > 0 ? { modesChosen: [...ctx.modesChosen] } : {}),
      ...(ctx.xValue !== undefined ? { xValue: ctx.xValue } : {}),
    };
    return {
      id,
      sourceCardId: ctx.sourceCardId,
      controllerSeat: ctx.castingPlayer,
      kind: "spell",
      isCast: true,
      // WHY typed as unknown on StackItem: TargetChoices is the SP2 shape in
      // ../target/restriction.ts; Task 38 cements the boundary cast. Passing
      // through `ctx.targets` here (possibly undefined) preserves shape.
      targets: ctx.targets ?? null,
      modes: [...ctx.modesChosen],
      xValue: ctx.xValue ?? null,
      // WHY null: costPaid is SP3's PaidCost record; Task 38 replaces with
      // the real payload.
      costPaid: null,
      provenance,
    };
  }

  /**
   * Task 39 populates — reverses the partial side-effects accumulated in
   * ctx.paidAlready (refund mana, untap/re-tap lands, etc.). Task 35 stub
   * does nothing; caller still returns null from run().
   */
  // biome-ignore lint/correctness/useYield: stub — populated by Task 39
  protected *abort(_ctx: CastContext, _err: unknown): Generator<EngineYield, void, unknown> {
    return;
  }
}
