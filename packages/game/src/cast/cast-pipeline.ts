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
import type { EntityId, ModeOption, NamedOption, PlayerSeat, ZoneType } from "@mtg-forge-ts/core";
import { IllegalDecisionError, ZoneType as Zt, mkEvent } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";
import type { FaceKind } from "../multiface/face-kind.js";
import type { StackItem, StackItemProvenance } from "../stack/stack-item.js";
import type { TargetChoices, TargetRef, TargetRestriction } from "../target/restriction.js";
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
 *   undefined                → single-face card; step 2 auto-passes.
 *   Record with ≥2 keys      → multi-face card. For split (L/R) and
 *                              modal-DFC (front/back with isModalDfc)
 *                              step 2 yields `chooseFace`. Transform
 *                              DFCs (front/back without the MDFC flag)
 *                              skip the decision — the default front
 *                              face is cast and later transform() flips.
 * optionalCosts:
 *   undefined / empty      → no alt-or-additional cost; step 4 auto-passes.
 *   length  > 0            → step 4 yields `chooseOptionalCosts` with the
 *                            provided NamedOptions.
 */
interface CastSurfacePaperCard {
  readonly faces?: Readonly<Record<string, { readonly name: string }>>;
  readonly isModalDfc?: boolean;
  readonly optionalCosts?: readonly NamedOption[];
  /**
   * Modal-spell options. When present with a non-empty list, step 5 yields
   * `chooseModes` and the casting player picks between `min` and `max`
   * distinct ids. CR 700.2 forbids picking the same mode twice unless the
   * card says "any number"; SP2 enforces strict uniqueness — a future
   * `allowDuplicate` flag on the modes record can relax it for cards that
   * genuinely admit repeats (Fiery Confluence, "any number" Charms).
   */
  readonly modes?: {
    readonly options: readonly ModeOption[];
    readonly min: number;
    readonly max: number;
  };
  /**
   * True when the spell's cost contains an `X` variable (Fireball, Banefire,
   * Finale of Promise). Step 5 yields a second decision — `chooseNumber` —
   * after the modal pick, letting the caster announce X. SP3's
   * ManaCostSolver caps the `max` against the caster's actual mana pool;
   * SP2 accepts any non-negative integer and defers mana-affordability
   * gating to the cost resolver.
   */
  readonly hasX?: boolean;
  /**
   * True when the spell divides an amount among its chosen targets
   * ("X damage divided among any number of target creatures", "distribute
   * X +1/+1 counters"). The actual target-indexed split is collected by
   * step 7 (ChooseTargets) so divisions are keyed against the same target
   * list; step 6 only verifies there's an amount to distribute.
   */
  readonly distributesX?: boolean;
  /**
   * Fallback distribution amount for distributesX spells that don't use
   * the X mechanic (e.g. "Distribute 3 +1/+1 counters among target
   * creatures"). When present and `xValue` is undefined at step 6, the
   * pipeline stamps this into `ctx.xValue` so step 7 has an amount.
   */
  readonly distributeAmount?: number;
  /**
   * Target restriction rule. Absent → spell has no targets (step 7 auto-
   * passes). Present → step 7 enumerates the eligible set via
   * TargetSystem and yields `chooseCastTargets`.
   */
  readonly targetRestriction?: TargetRestriction;
}

export interface CastProposal {
  readonly castingPlayer: PlayerSeat;
  readonly sourceCardId: EntityId;
  readonly originZone: ZoneType;
  readonly asSpecialAction: boolean;
}

/**
 * SP2 cost-payment receipt. Stored on `ctx.paidAlready` in step 10; the
 * abort path (Task 39) drops the list LIFO. SP3's CostPayment will carry
 * an `undo(game)` hook each entry exposes for real mana-pool / tap-state
 * unwinding.
 */
export interface CostPayment {
  readonly sourceCardId: EntityId;
  readonly totalCost: unknown;
  readonly paidAt: number;
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
      const item = this.finalizeStackItem(ctx);
      // SP2 Task 78 (fix 3) — emit the canonical SpellCast event after
      // finalizing the stack item. Routes through game.emitEvent so cast
      // triggers ("whenever a player casts a spell", storm count,
      // cascade gating) observe the event. Prior SP2 shape never emitted
      // SpellCast — only SpellPutOnStack from GameAction.putOnStack, but
      // the pipeline doesn't call putOnStack (the caller does), leaving
      // cast triggers unable to fire.
      yield this.game.emitEvent(
        mkEvent("SpellCast", this.game.turn, this.game.phase, {
          stackItemId: item.id,
          cardId: ctx.sourceCardId,
          controllerSeat: ctx.castingPlayer,
          ...(ctx.xValue !== undefined ? { xValue: ctx.xValue } : {}),
        }),
      );
      return item;
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
   * CR 601.2b — choose a face for Split / Modal DFC / Adventure cards.
   * SP2 reads face data off the PaperCard.faces Record (Task 58).
   *
   * Decision yielded for:
   *   • Split cards (faces has both "L" and "R") — CR 708; pick a half.
   *   • Modal DFCs (front/back faces + `isModalDfc: true`) — CR 712.6.
   *   • Adventure cards (faces has "adventure") — CR 715; pick creature
   *     or adventure half.
   *
   * No decision for:
   *   • Single-face cards (faces undefined or ≤ 1 entry).
   *   • Transform DFCs (front/back only, no MDFC flag) — the cast puts
   *     the default (front) face on the stack; later transform() flips.
   *   • Flip cards (faces has "flipped") — cast enters untransformed;
   *     flip() toggles when the ability resolves.
   *
   * On success the chosen face id is written to ctx.faceChosen AND
   * mirrored onto Card.face so layer derivation (base-characteristics)
   * picks the right face once the stack push lands.
   */
  protected *stepChooseFace(ctx: CastContext): Generator<EngineYield, void, unknown> {
    const card = this.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const paper = card.paperCard as CastSurfacePaperCard;
    const faces = paper.faces;
    if (faces === undefined) return;
    const faceKeys = Object.keys(faces);
    if (faceKeys.length <= 1) return;
    // Decide whether this card actually needs the decision. Split cards,
    // MDFCs, and adventure cards do; transform DFCs + flip cards don't.
    const hasL = "L" in faces;
    const hasR = "R" in faces;
    const isSplit = hasL && hasR;
    const hasFront = "front" in faces;
    const hasBack = "back" in faces;
    const isModalDfc = paper.isModalDfc === true && hasFront && hasBack;
    const hasAdventure = "adventure" in faces;
    if (!isSplit && !isModalDfc && !hasAdventure) {
      // Transform DFC / flip card — cast enters on the default face.
      return;
    }
    const options: readonly string[] = isSplit
      ? ["L", "R"]
      : isModalDfc
        ? ["front", "back"]
        : // Adventure: creature half is the default "front"; adventure id
          // is the instant/sorcery side.
          hasFront
          ? ["front", "adventure"]
          : ["adventure"];
    const response = (yield {
      kind: "decision",
      request: {
        kind: "chooseFace",
        playerSeat: ctx.castingPlayer,
        cardId: ctx.sourceCardId,
        options,
      },
    }) as { readonly kind: "chooseFace"; readonly face: string };
    if (!options.includes(response.face)) {
      throw new IllegalDecisionError(`chooseFace: ${response.face} not in ${JSON.stringify(options)}`, [
        ...options,
      ]);
    }
    // WHY cast: faceChosen is the narrow string-literal union on
    // StackItemProvenance; the structural `options` list is a generic
    // string[]. Cards outside the canonical face-id set are validated
    // above by membership.
    ctx.faceChosen = response.face as StackItemProvenance["faceChosen"];
    // Mirror onto Card.face so deriveBaseCharacteristics (and every
    // layer-dependent read that runs between here and the stack push)
    // sees the chosen face. finalizeStackItem builds the StackItem
    // with the provenance; Card.face on the source persists until the
    // stack item resolves.
    card.face = response.face as FaceKind;
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

  /**
   * CR 601.2b — modal spells: "choose one/two/three" / announcement of X.
   *
   * 5a. Modal pick: if the paper card publishes a `modes` record with a
   *     non-empty option list, yield `chooseModes` and validate the reply
   *     (count in [min,max], every id is offered, no duplicates per
   *     CR 700.2). Records the picks in `ctx.modesChosen`.
   *
   * 5b. X announcement: if the spell has `hasX`, yield `chooseNumber` and
   *     accept any non-negative integer. Mana affordability is SP3's
   *     ManaCostSolver — SP2 only gates on "non-negative integer".
   *
   * Cards without either feature auto-pass this step.
   */
  protected *stepChooseModes(ctx: CastContext): Generator<EngineYield, void, unknown> {
    const card = this.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const paper = card.paperCard as CastSurfacePaperCard;

    // 5a: modal pick.
    if (paper.modes && paper.modes.options.length > 0) {
      const modes = paper.modes;
      const response = (yield {
        kind: "decision",
        request: {
          kind: "chooseModes",
          sourceId: ctx.sourceCardId,
          modes: modes.options,
          min: modes.min,
          max: modes.max,
        },
      }) as { readonly kind: "chooseModes"; readonly modeIds: readonly string[] };
      if (response.modeIds.length < modes.min || response.modeIds.length > modes.max) {
        throw new IllegalDecisionError(
          `chooseModes: count ${response.modeIds.length} not in [${modes.min}, ${modes.max}]`,
          modes.options.map((o) => o.id),
        );
      }
      const validIds = new Set(modes.options.map((o) => o.id));
      const seen = new Set<string>();
      for (const m of response.modeIds) {
        if (!validIds.has(m)) {
          throw new IllegalDecisionError(
            `chooseModes: unknown id ${m}`,
            modes.options.map((o) => o.id),
          );
        }
        // CR 700.2 — no duplicates unless the card says "any number".
        if (seen.has(m)) {
          throw new IllegalDecisionError(
            `chooseModes: duplicate id ${m}`,
            modes.options.map((o) => o.id),
          );
        }
        seen.add(m);
      }
      ctx.modesChosen = [...response.modeIds];
    }

    // 5b: X announcement.
    if (paper.hasX === true) {
      const response = (yield {
        kind: "decision",
        request: {
          kind: "chooseNumber",
          sourceId: ctx.sourceCardId,
          min: 0,
          // WHY MAX_SAFE_INTEGER: SP3's ManaCostSolver is the authority on
          // the caster's affordable max — SP2 just validates the shape.
          // Using MAX_SAFE_INTEGER avoids any off-by-one surprises on the
          // boundary where a card like Rolling Thunder accepts X up to the
          // caster's pool.
          max: Number.MAX_SAFE_INTEGER,
        },
      }) as { readonly kind: "chooseNumber"; readonly chosen: number };
      if (!Number.isInteger(response.chosen) || response.chosen < 0) {
        throw new IllegalDecisionError(`chooseNumber (xValue): invalid ${response.chosen}`);
      }
      ctx.xValue = response.chosen;
    }
  }

  /**
   * CR 601.2d — "divide X damage among any number of targets" / "put X +1/+1
   * counters distributed among target creatures". The actual target-indexed
   * division is collected by step 7 (ChooseTargets) because divisions are
   * keyed against the same target list; step 6 only:
   *   - returns early if the card doesn't distribute,
   *   - when the card distributes without an announced X, falls back to a
   *     fixed `distributeAmount` and stamps it into ctx.xValue so step 7
   *     has a concrete total to divide,
   *   - initializes ctx.distributions to the empty record so step 7 sees
   *     "distribution required" rather than "undefined distributions".
   */
  // biome-ignore lint/correctness/useYield: step defers all decisions to step 7
  protected *stepDistributeX(ctx: CastContext): Generator<EngineYield, void, unknown> {
    const card = this.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const paper = card.paperCard as CastSurfacePaperCard;
    if (paper.distributesX !== true) return;
    if (ctx.xValue === undefined) {
      const fixedAmount = paper.distributeAmount;
      if (fixedAmount === undefined) {
        throw new IllegalDecisionError(
          "distributeX: no amount to distribute (no X announced, no fixed amount)",
        );
      }
      ctx.xValue = fixedAmount;
    }
    // Signal to step 7 that divisions are required; the actual map is
    // filled from the chooseCastTargets response.
    ctx.distributions = {};
  }

  /**
   * CR 601.2c — choose the spell's targets. The card publishes a
   * TargetRestriction (set of zone/type/controller filters + count bounds);
   * TargetSystem enumerates the eligible set, the engine yields a
   * `chooseCastTargets` decision, and the response is re-validated against
   * the same TargetSystem contract (CR 601.2c "legal targets at cast").
   *
   * When the restriction carries `divideX`, the response must include
   * a `divisions` map whose sum matches `divideX.amount`; validateAtCast
   * enforces that rule.
   */
  protected *stepChooseTargets(ctx: CastContext): Generator<EngineYield, void, unknown> {
    const card = this.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    const paper = card.paperCard as CastSurfacePaperCard;
    if (!paper.targetRestriction) return;
    const restriction = paper.targetRestriction;
    const enumerationCtx = {
      sourceId: ctx.sourceCardId,
      sourceControllerSeat: ctx.castingPlayer,
    };
    const eligible = this.game.targetSystem.enumerate(enumerationCtx, restriction);
    const response = (yield {
      kind: "decision",
      request: {
        kind: "chooseCastTargets",
        playerSeat: ctx.castingPlayer,
        sourceId: ctx.sourceCardId,
        // WHY typed through unknown: TargetRef lives in ../target/restriction;
        // decisions core-package can't reach that without a cycle. Consumers
        // narrow via TargetRef on the game side.
        legalTargets: eligible as readonly unknown[],
        min: restriction.minTargets,
        max: restriction.maxTargets,
        ...(restriction.divideX !== undefined ? { divideX: restriction.divideX } : {}),
      },
    }) as {
      readonly kind: "chooseCastTargets";
      readonly targets: readonly unknown[];
      readonly divisions?: Readonly<Record<number, number>>;
    };
    const chosenTargets = response.targets as readonly TargetRef[];
    const choices: TargetChoices =
      response.divisions !== undefined
        ? { targets: chosenTargets, divisions: { ...response.divisions } }
        : { targets: chosenTargets };
    if (!this.game.targetSystem.validateAtCast(choices, enumerationCtx, restriction)) {
      throw new IllegalDecisionError(`chooseCastTargets: invalid selection for card ${ctx.sourceCardId}`);
    }
    ctx.targets = choices.targets;
    if (choices.divisions !== undefined) {
      ctx.distributions = { ...choices.divisions };
    }
  }

  /**
   * CR 601.2f — determine the total cost. Start with the card's base mana
   * cost (SP3's ManaCost — typed through `unknown` here until SP3 lands
   * the full AST), add every cost-modifying static (Milestone F's
   * `byCategory("costModification")`), and thread the additional costs
   * announced in step 4 + the alt-cost id + the X announcement.
   *
   * SP2 records the raw inputs as an opaque object on ctx.totalCost; SP3's
   * ManaCostSolver (Milestone J) consumes the record and produces the
   * resolved PaidCost that step 10 actually deducts. No decision is
   * yielded — the cost is derived, not player-selected.
   */
  protected *stepDetermineTotalCost(ctx: CastContext): Generator<EngineYield, void, unknown> {
    const card = this.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    // WHY probed structurally: PaperCard carries ManaCost on its definition
    // slot (SP3 lands the full CardDefinition); until then, the cast surface
    // exposes manaCost on the paper record directly.
    const baseCost = (card.paperCard as { manaCost?: unknown }).manaCost ?? null;
    const costMods = this.game.staticEffectRegistry.byCategory("costModification");
    ctx.totalCost = {
      base: baseCost,
      modIds: costMods.map((s) => s.id),
      additionalCostIds: [...ctx.additionalCostsPaid],
      altCostUsed: ctx.altCostUsed,
      xValue: ctx.xValue,
    };
  }

  /**
   * CR 601.2g — between cost determination and payment, the active player
   * gets a window to activate legal mana abilities. A proper orchestrator
   * emits per-activation priority bundles; SP2 collapses the window to a
   * single `activateManaAbilities` decision the caster acks when done
   * producing mana. Milestone J (priority orchestrator) replaces this with
   * the full per-activation loop.
   *
   * Skipped when the total cost has no base mana cost — there's nothing
   * for a mana ability to pay for, so the window would be a no-op and
   * yielding a decision would add controller round-trips for cards that
   * can't use them (tokens in SP2 tests, free-cast cards). SP3's real
   * cost solver will gate this more precisely (an X=0 cast with no mana
   * symbols still technically opens the window but collapses trivially).
   */
  protected *stepActivateManaAbilities(ctx: CastContext): Generator<EngineYield, void, unknown> {
    const totalCost = ctx.totalCost as { base?: unknown } | null | undefined;
    if (totalCost == null || totalCost.base == null) {
      return;
    }
    const response = (yield {
      kind: "decision",
      request: {
        kind: "activateManaAbilities",
        playerSeat: ctx.castingPlayer,
        forStackItem: ctx.sourceCardId,
      },
    }) as { readonly kind: "activateManaAbilities"; readonly done: true };
    if (response.done !== true) {
      throw new IllegalDecisionError("activateManaAbilities: response.done must be true");
    }
  }

  /**
   * CR 601.2h — pay the total cost. Without the SP3 ManaCostSolver +
   * mana pool, SP2 records a CostPayment stub on ctx.paidAlready so
   * abort() (Task 39) can unwind. The real mana pool deduction and
   * tap-mana-ability side effects land with SP3; at that point, each
   * entry on paidAlready carries an `undo(game)` the abort path calls.
   *
   * Emits a `CostPaid` event for telemetry / replay. The stackItemId on
   * the payload is the SOURCE card id because the StackItem itself is
   * minted later in finalizeStackItem; consumers reading CostPaid match
   * against sourceCardId, not the yet-to-be-created stack id. SP3 swaps
   * this for the post-finalize emission order once the cost solver is
   * live.
   */
  protected *stepPayCosts(ctx: CastContext): Generator<EngineYield, void, unknown> {
    const totalCost = ctx.totalCost as { base?: unknown } | null | undefined;
    // WHY skip: SP2's payment is a receipt-only stub. For cards without a
    // base mana cost (the samplePaper fixture used across SP2 tests, free
    // cast-from-command-zone effects), recording a null-cost payment is
    // noise — consumers reading CostPaid would see ghost events on every
    // cast. SP3's real cost solver always runs and emits the event with a
    // concrete cost payload.
    if (totalCost == null || totalCost.base == null) {
      return;
    }
    const payment: CostPayment = {
      sourceCardId: ctx.sourceCardId,
      totalCost: ctx.totalCost,
      paidAt: this.game.turn,
    };
    ctx.paidAlready.push(payment);
    yield {
      kind: "event",
      event: mkEvent("CostPaid", this.game.turn, this.game.phase, {
        // WHY sourceCardId here: the live StackItem id is assigned in
        // finalizeStackItem; consumers match against the source card until
        // the v2 event adds both ids.
        stackItemId: ctx.sourceCardId,
        payerSeat: ctx.castingPlayer,
      }),
    };
  }

  /**
   * Build the finalized StackItem from the accumulated CastContext. The
   * provenance record carries the SP2-complete subset (originZone +
   * alt/additional cost markers + face/mode/x fields); cascade/copy
   * provenance lands with Milestone P.
   *
   * costPaid carries the entire paidAlready list — SP2 stubs it as a
   * list of CostPayment records; SP3's PaidCost (produced by the
   * ManaCostSolver) replaces the stub once the cost engine is live.
   * Consumers in SP2 should treat costPaid as opaque.
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
      // WHY the list: SP2 stamps each step-10 payment receipt here so
      // SP3's resolver can introspect what was actually paid. Empty list
      // means "cost payment not recorded" — callers should not infer the
      // spell was free.
      costPaid: [...ctx.paidAlready],
      provenance,
    };
  }

  /**
   * SP2 §9.abort — cast aborted mid-pipeline. Reverses the partial
   * side-effects accumulated across steps 1-10. Invoked by run()'s catch
   * block; run() then returns null (caller interprets that as
   * IllegalCast).
   *
   * Order of operations:
   *   1. LIFO-drop the `paidAlready` receipts (SP3's CostPayment will
   *      expose an `undo(game)` we'll call here — in SP2 the payments are
   *      opaque stubs the mana pool never actually saw, so dropping them
   *      is sufficient for replay determinism).
   *   2. Emit `CastAborted` so observers (GameLog, AI feature extractor,
   *      replay checker) can see the cast concluded unsuccessfully and
   *      why. The event payload is `{ cardId, playerSeat, reason }` per
   *      Milestone B's event taxonomy.
   *   3. run() returns null unconditionally — the caller never sees a
   *      partially-constructed StackItem.
   *
   * Reason extraction mirrors TriggerRegistry.abort + ReplacementRegistry
   * conventions: Error → Error.message, else String(err) — preserves
   * stack-trace context for thrown Errors without leaking internal
   * Error constructor names.
   */
  protected *abort(ctx: CastContext, err: unknown): Generator<EngineYield, void, unknown> {
    const reason = err instanceof Error ? err.message : String(err);
    // 1. Drop partial cost receipts. Done LIFO so SP3 can swap in undo()
    //    without changing the ordering guarantee.
    while (ctx.paidAlready.length > 0) {
      ctx.paidAlready.pop();
    }
    // 2. Emit the abort event.
    yield {
      kind: "event",
      event: mkEvent("CastAborted", this.game.turn, this.game.phase, {
        cardId: ctx.sourceCardId,
        playerSeat: ctx.castingPlayer,
        reason,
      }),
    };
  }
}
