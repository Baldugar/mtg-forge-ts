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
import type { EntityId, NamedOption, PlayerSeat, ZoneType } from "@mtg-forge-ts/core";
import { IllegalDecisionError, ZoneType as Zt } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";
import type { StackItem, StackItemProvenance } from "../stack/stack-item.js";
import type { CastContext } from "./cast-context.js";
import { createCastContext } from "./cast-context.js";

/**
 * Cast-surface metadata SP2 reads off the PaperCard definition slot. The
 * real PaperCard (forge.card.CardRules) will eventually carry these
 * strongly typed; until SP3 lands the full CardDefinition, CastPipeline
 * reads the values through a narrow structural cast so step logic can be
 * written and tested independently.
 *
 * faces:
 *   undefined / length ≤ 1 → single-face card; step 2 auto-passes.
 *   length  > 1            → multi-face card; step 2 yields `chooseFace`.
 * optionalCosts:
 *   undefined / empty      → no alt-or-additional cost; step 4 auto-passes.
 *   length  > 0            → step 4 yields `chooseOptionalCosts` with the
 *                            provided NamedOptions.
 */
interface CastSurfacePaperCard {
  readonly faces?: readonly string[];
  readonly optionalCosts?: readonly NamedOption[];
}

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

  /**
   * CR 601.2a — the casting player announces the spell. Engine validates:
   *   1. the card exists in Game.cards,
   *   2. the card is actually in the claimed origin zone (prevents
   *      double-cast / wrong-zone proposals),
   *   3. the casting player is the one permitted to cast from that zone
   *      (owner for personal hidden zones + graveyard; controller for
   *      battlefield — e.g. animated-land cast from battlefield; owner for
   *      shared exile since Exile has no controller).
   * Throws IllegalDecisionError on any mismatch — run() catches and routes
   * to abort().
   */
  // biome-ignore lint/correctness/useYield: validation branch before any yield
  protected *stepPropose(ctx: CastContext): Generator<EngineYield, void, unknown> {
    const card = this.game.cards.get(ctx.sourceCardId);
    if (!card) {
      throw new IllegalDecisionError(`Cast propose: card ${ctx.sourceCardId} not found`);
    }
    if (card.zone !== ctx.originZone) {
      throw new IllegalDecisionError(
        `Cast propose: card ${ctx.sourceCardId} not in zone ${ctx.originZone} (actually in ${card.zone})`,
      );
    }
    // WHY: personal hidden zones + graveyard gate by ownership — a player
    // casts their own cards from those zones. Battlefield gates by control
    // (animated lands, Aether Vial'd tokens, etc.). Exile is shared and
    // has no controller, so the ownership gate also applies there.
    const isOwnerGated =
      card.zone === Zt.Hand ||
      card.zone === Zt.Graveyard ||
      card.zone === Zt.Library ||
      card.zone === Zt.Exile;
    const expectedSeat = isOwnerGated ? card.ownerSeat : card.controllerSeat;
    if (expectedSeat !== ctx.castingPlayer) {
      throw new IllegalDecisionError(
        `Cast propose: player ${ctx.castingPlayer} cannot cast card in zone ${card.zone} (seat ${expectedSeat})`,
      );
    }
  }

  /**
   * CR 601.2b — choose a face for Split / Modal DFC / Transform DFC /
   * Adventure cards. SP2 reads face data off the PaperCard; until SP3/
   * Milestone Q lands the full multi-face shape, cards with no `faces`
   * surface on the paper-card payload auto-pass. When a multi-face card
   * is cast, yield a `chooseFace` decision and validate the response is
   * in the offered set.
   */
  protected *stepChooseFace(ctx: CastContext): Generator<EngineYield, void, unknown> {
    const card = this.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const paper = card.paperCard as CastSurfacePaperCard;
    if (!paper.faces || paper.faces.length <= 1) return;
    const response = (yield {
      kind: "decision",
      request: {
        kind: "chooseFace",
        playerSeat: ctx.castingPlayer,
        cardId: ctx.sourceCardId,
        options: paper.faces,
      },
    }) as { readonly kind: "chooseFace"; readonly face: string };
    if (!paper.faces.includes(response.face)) {
      throw new IllegalDecisionError(`chooseFace: ${response.face} not in ${JSON.stringify(paper.faces)}`, [
        ...paper.faces,
      ]);
    }
    // WHY cast: faceChosen is the narrow string-literal union on
    // StackItemProvenance; paper.faces is a generic string[] (the
    // PaperCard layer is print-format-agnostic). Cards outside the
    // canonical face-id set are validated above by set membership.
    ctx.faceChosen = response.face as StackItemProvenance["faceChosen"];
  }

  /**
   * CR 601.2b (continued) — choose zone override when the cast's zone has
   * a post-resolution alternative destination. Flashback (graveyard →
   * exile on resolve, CR 702.33), cascade / impulse / foretell (exile →
   * exile on resolve).
   *
   * SP2 auto-derives from origin zone. Future: when multiple zone-override
   * mechanics coexist on one cast, yield a `chooseZone` decision — add
   * when the card corpus actually contains such an interaction.
   */
  // biome-ignore lint/correctness/useYield: SP2 branch has no decision point
  protected *stepChooseZoneOverride(ctx: CastContext): Generator<EngineYield, void, unknown> {
    switch (ctx.originZone) {
      case Zt.Graveyard:
        // Flashback-family: cast from graveyard, exile on resolve.
        ctx.alternativeZoneDestination = Zt.Exile;
        return;
      case Zt.Exile:
        // Cascade / impulse / foretell: cast from exile, exile on resolve.
        ctx.alternativeZoneDestination = Zt.Exile;
        return;
      default:
        // Normal cast (Hand → Stack → Graveyard on resolve): no override.
        return;
    }
  }

  /**
   * CR 601.2b (continued) — announce alternative + additional costs
   * (kicker, buyback, multikicker, overload, madness discount, etc.).
   *
   * SP2 surface: PaperCard.optionalCosts carries the menu. Each id is a
   * short string the card rules reference; step 8 (DetermineTotalCost)
   * consumes the chosen ids to compute the cost.
   */
  protected *stepChooseAltCosts(ctx: CastContext): Generator<EngineYield, void, unknown> {
    const card = this.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const paper = card.paperCard as CastSurfacePaperCard;
    if (!paper.optionalCosts || paper.optionalCosts.length === 0) return;
    const response = (yield {
      kind: "decision",
      request: {
        kind: "chooseOptionalCosts",
        sourceId: ctx.sourceCardId,
        options: paper.optionalCosts,
      },
    }) as { readonly kind: "chooseOptionalCosts"; readonly chosenIds: readonly string[] };
    for (const costId of response.chosenIds) {
      if (!paper.optionalCosts.some((c) => c.id === costId)) {
        throw new IllegalDecisionError(
          `chooseOptionalCosts: unknown id ${costId}`,
          paper.optionalCosts.map((c) => c.id),
        );
      }
    }
    ctx.additionalCostsPaid = [...response.chosenIds];
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
