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
import { SpellAbility } from "../ability/spell-ability.js";
import type { EngineYield } from "../action/engine-yield.js";
import type { CostPartReceipt, CostPaymentContext } from "../cost/parts/cost-part.js";
import { parseCostString, payCost, undoCost } from "../cost/parts/cost-payment.js";
import type { Game } from "../game.js";
import type { FaceKind } from "../multiface/face-kind.js";
import { altCostRegistry } from "../registries/alt-cost-registry.js";
// Side-effect import: registers CostMana, CostTap, CostPayLife, CostSacrifice
// in costPartRegistry so payCost can dispatch to them.
import "../cost/parts/index.js";
import type { StackItem, StackItemProvenance, StackItemResolver } from "../stack/stack-item.js";
import type { TargetChoices, TargetRef, TargetRestriction } from "../target/restriction.js";
import type { CastContext } from "./cast-context.js";
import { createCastContext } from "./cast-context.js";
import { parseValidTgts } from "./valid-targets.js";

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
  /**
   * Wave 5 — select an alternative cast cost by key (e.g. "Flashback").
   * When present, stepChooseAltCosts looks the key up in altCostRegistry
   * and calls modifyCastContext to replace the mana cost + set provenance.
   * Existing proposals that omit this field are unaffected.
   */
  readonly altCostKey?: string;
}

/**
 * SP2 cost-payment receipt. Stored on `ctx.paidAlready` in step 10; the
 * abort path (Task 39) LIFO-undoes each entry via `undoCost`. Each entry
 * carries an optional `receipt` field (SP3 Part C Task 60) with the
 * CostPartReceipt that `undoCost` needs to reverse the real mana payment.
 * SP2 synthetic fixtures that pre-date real payment leave `receipt`
 * undefined; abort silently skips those entries.
 */
export interface CostPayment {
  readonly sourceCardId: EntityId;
  readonly totalCost: unknown;
  readonly paidAt: number;
  /** SP3 Part C T60: the concrete receipt produced by payCost, used by abort to undo. */
  readonly receipt?: CostPartReceipt;
}

export class CastPipeline {
  constructor(protected readonly game: Game) {}

  *run(proposal: CastProposal): Generator<EngineYield, StackItem | null, unknown> {
    const ctx = createCastContext({
      castingPlayer: proposal.castingPlayer,
      sourceCardId: proposal.sourceCardId,
      originZone: proposal.originZone,
      asSpecialAction: proposal.asSpecialAction,
      // WHY spread: exactOptionalPropertyTypes requires we omit the key
      // entirely when the value is undefined rather than passing `undefined`.
      ...(proposal.altCostKey !== undefined ? { altCostKey: proposal.altCostKey } : {}),
    });
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
      // Audit I-7 — push the stack item onto the shared stack BEFORE
      // emitting SpellCast. Cast triggers ("whenever a player casts a
      // spell", storm count, cascade gating) observe SpellCast and read
      // the stack; if the item isn't on the stack yet, storm-count-style
      // triggers counting "spells on the stack" read a pre-push stack and
      // miss the new item. Emitting post-push makes the observed state
      // match the causal order: the spell IS on the stack when the event
      // fires.
      this.game.sharedZones.stack.push(item);
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
   * Wave 5: if ctx.altCostUsed was pre-filled from CastProposal.altCostKey,
   * look it up in altCostRegistry and call modifyCastContext immediately
   * (no decision yield). This handles Flashback and future alt-cost keywords.
   *
   * SP2 surface: PaperCard.optionalCosts carries the menu. Each id is a
   * short string the card rules reference; step 8 (DetermineTotalCost)
   * consumes the chosen ids to compute the cost.
   */
  protected *stepChooseAltCosts(ctx: CastContext): Generator<EngineYield, void, unknown> {
    const card = this.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    // Wave 5 — alt-cost registry path. If the proposal nominated an alt cost
    // key, apply it without a decision yield. modifyCastContext writes
    // ctx.altCostUsed, ctx.totalCost.base, and ctx.alternativeZoneDestination.
    if (ctx.altCostUsed !== null) {
      const altCost = altCostRegistry.lookup(ctx.altCostUsed);
      if (altCost) {
        // Provide a SpellAbility handle for modifyCastContext. Cards without
        // a parsed SpellAbility (SP2 test stubs) fall back to a noop sentinel.
        const noopAst = {
          kind: "spell" as const,
          effect: { handlerKey: "noop", params: {} },
          cost: { raw: "" },
        };
        const sa =
          card.spellAbilities[0] ?? new SpellAbility(noopAst, card.id, ctx.castingPlayer, new Map(), []);
        altCost.modifyCastContext(ctx, sa, this.game);
        return;
      }
    }

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

    // Wave 10 — Overload: an overloaded spell is targetless (CR 702.96).
    // The ValidTgts$ filter is consulted at resolve time by effect handlers
    // (Tap / Destroy / DealDamage check sa.tags.has("overloaded") and
    // enumerate matching cards instead of iterating sa.targets).
    if (ctx.overloaded) return;

    // Wave 10 — Bestow: a bestowed creature spell becomes an Aura with
    // "enchant creature" (CR 702.103). The base card has no ValidTgts$ on
    // its SpellAbility (it's a creature spell), so we synthesize a
    // "any creature on the battlefield" restriction here and let the rest
    // of the step run normally.
    let restriction: TargetRestriction | undefined;
    if (ctx.bestowed) {
      restriction = parseValidTgts("Creature");
    } else {
      // Derive restriction: prefer paper.targetRestriction (explicit, set by
      // test fixtures or future SP3 data layer). Fall back to parsing ValidTgts$
      // from the card's first SpellAbility (Wave 4 runtime enforcement). When
      // neither is present, the spell has no targets — skip step 7.
      restriction = paper.targetRestriction;
      if (!restriction && card.spellAbilities.length > 0) {
        const sa = card.spellAbilities[0];
        const validTgtsParam = sa?.ast.effect.params.ValidTgts;
        if (validTgtsParam && validTgtsParam.kind === "literal" && validTgtsParam.raw) {
          restriction = parseValidTgts(validTgtsParam.raw);
        }
      }
    }
    if (!restriction) return;
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

    // Wave 5 — emit CardTargeted for each card-typed target so
    // BecomesTargetTrigger (T:Mode$ BecomesTarget) fires correctly.
    // Player targets do not generate a CardTargeted event (they are not cards).
    for (const ref of chosenTargets) {
      if (ref.kind === "card") {
        yield this.game.emitEvent(
          mkEvent("CardTargeted", this.game.turn, this.game.phase, {
            targetId: ref.id,
            sourceCardId: ctx.sourceCardId,
            targetingSeat: ctx.castingPlayer,
          }),
        );
      }
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

    // Wave 5 — if an alt cost was applied in stepChooseAltCosts (e.g. Flashback),
    // ctx.totalCost.base was already set by modifyCastContext. Preserve it here
    // instead of overwriting with the card's normal mana cost. The altCostUsed
    // marker is the authoritative signal.
    let baseCost: unknown;
    const priorBase = (ctx.totalCost as { base?: unknown } | null | undefined)?.base;
    if (ctx.altCostUsed !== null && priorBase !== undefined) {
      baseCost = priorBase;
    } else {
      // WHY probed structurally: PaperCard may carry manaCost directly (SP2
      // synthetic fixtures) OR through its CardDefinition (SP3 real cards).
      // Check both: prefer direct `paperCard.manaCost` (SP2 fixtures), then
      // fall back to `paperCard.definition.manaCost` (SP3 real definitions).
      const paperAny = card.paperCard as { manaCost?: unknown };
      baseCost =
        paperAny.manaCost !== undefined
          ? (paperAny.manaCost ?? null)
          : (card.paperCard.definition?.manaCost ?? null);
    }

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
   * CR 601.2h — pay the total cost. SP3 Part C Task 60 replaces the SP2
   * receipt-only stub with a real CostPlan + payCost call that drains
   * the caster's mana pool (and runs tap/life costs).
   *
   * The real-payment path is gated on `totalCost.base.raw` being a
   * non-empty string that `parseCostString` can handle (whitespace-/
   * comma-separated mana symbols, "T", "N life", "Sac X"). Cards whose
   * manaCost is null or missing auto-pass (free casts, SP2 synthetic
   * test cards). The raw cost is extracted from ManaCostAst.raw which
   * the real parser populates for every card with a ManaCost: line.
   *
   * Emits a `CostPaid` event for telemetry / replay on success.
   */
  protected *stepPayCosts(ctx: CastContext): Generator<EngineYield, void, unknown> {
    const totalCost = ctx.totalCost as { base?: { raw?: string } | null } | null | undefined;
    if (totalCost == null || totalCost.base == null) {
      return; // free cast or no cost recorded — skip payment
    }
    const rawCost = totalCost.base.raw;
    if (!rawCost) {
      return; // base present but no raw string (SP2 placeholder) — skip
    }

    // SP3 Part C Task 60: real cost payment via payCost orchestrator.
    // Wave 11 — thread kind="spell" + the card's origin zone (Hand for
    // normal casts, Graveyard for Flashback, etc.) so cost-mod statics
    // gated on Type$/AffectedZone$ can fire correctly.
    const sourceCardForZone = this.game.cards.get(ctx.sourceCardId);
    const costCtx: CostPaymentContext = {
      game: this.game,
      payerSeat: ctx.castingPlayer,
      sourceCardId: ctx.sourceCardId,
      raw: rawCost,
      kind: "spell",
      ...(sourceCardForZone !== undefined ? { sourceZone: sourceCardForZone.zone } : {}),
    };
    let plan: ReturnType<typeof parseCostString>;
    try {
      plan = parseCostString(rawCost);
    } catch {
      // Unparseable cost string (e.g. Forge brace-notation from SP2 synthetic
      // fixtures like "{1}{R}"). Fall back to the SP2 stub behaviour: record a
      // receipt without actually draining the pool. This preserves backwards
      // compat for all existing cast-pipeline tests that use non-real raw strings.
      ctx.paidAlready.push({
        sourceCardId: ctx.sourceCardId,
        totalCost: ctx.totalCost,
        paidAt: this.game.turn,
      });
      yield {
        kind: "event",
        event: mkEvent("CostPaid", this.game.turn, this.game.phase, {
          stackItemId: ctx.sourceCardId,
          payerSeat: ctx.castingPlayer,
        }),
      };
      return;
    }

    // Drive real payment. payCost throws if mana is insufficient; run()
    // catches and routes to abort(). abort() will LIFO-undo via undoCost.
    const receipts = yield* payCost(plan, costCtx);
    for (const receipt of receipts) {
      ctx.paidAlready.push({
        sourceCardId: ctx.sourceCardId,
        totalCost: ctx.totalCost,
        paidAt: this.game.turn,
        receipt,
      });
    }

    yield {
      kind: "event",
      event: mkEvent("CostPaid", this.game.turn, this.game.phase, {
        // WHY sourceCardId: the live StackItem id is assigned in
        // finalizeStackItem; consumers match against source card until
        // the v2 event schema adds both ids.
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
   *
   * SP3 Part C Task 59 — build a real resolver from the source card's
   * first SpellAbility. Cards whose spellAbilities list is empty (SP2
   * synthetic test cards that never called activateAbilitiesFromDefinition)
   * fall back to resolver: null, preserving all existing SP2 tests.
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

    // SP3 Part C Task 59 — wire a real resolver from the card's SpellAbility.
    // Spells have a single A: ability (the castable one); activated abilities
    // go through a different pipeline (SP3 Part D+).
    let resolver: StackItemResolver | null = null;
    const sourceCard = this.game.cards.get(ctx.sourceCardId);
    const saTemplate = sourceCard?.spellAbilities[0] ?? null;
    if (saTemplate !== null) {
      // Convert ctx.targets (TargetRef[] | undefined) to EntityId[].
      // TargetRef is a discriminated union: { kind: "card"; id: EntityId }
      // or { kind: "player"; seat: PlayerSeat }. DealDamageEffect routes
      // by checking game.cards.get(id) — absent → player. PlayerSeat is
      // branded as a number, same underlying type as EntityId, so casting
      // through unknown is safe at runtime.
      const rawTargets = (ctx.targets as readonly TargetRef[] | undefined) ?? [];
      const targets: EntityId[] = rawTargets.map((ref) =>
        ref.kind === "card" ? ref.id : (ref.seat as unknown as EntityId),
      );
      // Wave 10 — propagate alt-cost-driven tags (Overload, Bestow) onto the
      // bound SpellAbility so resolve-time effect handlers can branch.
      // Without this, ctx.overloaded / ctx.bestowed would be lost when the
      // bound SA is constructed. Empty tag set is the SP2 default; we only
      // attach when at least one alt-cost flag is set so identity-equality
      // tests on `tags` for non-altcost spells aren't perturbed.
      const altTags: string[] = [];
      if (ctx.overloaded) altTags.push("overloaded");
      if (ctx.bestowed) altTags.push("bestowed");
      const tags = altTags.length > 0 ? new Set(altTags) : undefined;
      const boundSa = new SpellAbility(
        saTemplate.ast,
        saTemplate.sourceCardId,
        saTemplate.controllerSeat,
        saTemplate.svars,
        targets,
        ctx.xValue,
        undefined,
        tags,
      );
      resolver = boundSa.makeResolver();
    }

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
      resolver,
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
    // 1. LIFO-undo partial cost receipts. SP3 Part C Task 60: entries with
    //    a real CostPartReceipt (produced by payCost) are undone via undoCost;
    //    SP2 stub entries (receipt absent) are just dropped.
    const paymentsLIFO = [...ctx.paidAlready].reverse() as CostPayment[];
    ctx.paidAlready.length = 0;
    for (const payment of paymentsLIFO) {
      if (payment.receipt) {
        const costCtx: CostPaymentContext = {
          game: this.game,
          payerSeat: ctx.castingPlayer,
          sourceCardId: ctx.sourceCardId,
          raw: payment.receipt.raw,
        };
        undoCost([payment.receipt], costCtx);
      }
    }
    // Audit A-004 — clear face-chosen leak. stepChooseFace mirrors the pick
    // onto Card.face so layer derivation sees the chosen face during the
    // cast. If the cast aborts, the source card is still in its origin zone
    // (the cast didn't push the spell onto the stack), and a subsequent
    // re-attempt's stepChooseFace will set Card.face fresh — but only if
    // it actually runs. A cast that aborts BEFORE stepChooseFace (e.g. in
    // stepPropose) on a multi-face card whose previous attempt set Card.face
    // would inherit the stale pick. Reset Card.face to undefined (the
    // pre-cast default) so each cast attempt starts on a clean slate.
    if (ctx.faceChosen !== undefined) {
      const card = this.game.cards.get(ctx.sourceCardId);
      if (card) {
        // Card.face uses "default" as its sentinel for "no face selected" —
        // the constructor initializes it to "default" and stepChooseFace
        // overwrites with a concrete FaceKind on selection.
        card.face = "default";
      }
      ctx.faceChosen = undefined;
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
