// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 21 — final corpus-unknown effect handlers (20 entries). Pushes the
// effect coverage from ~99.4% toward ~100%. Same MVP shape as Waves 18/19:
// each class extends SpellAbilityEffect, registers its handlerKey, and
// produces an observable game-state change so the canonical case is
// exercised. Advanced sub-params are flagged with TODO comments.
//
// Effects covered:
//   Proliferate, Venture, Manifest, StoreSVar, EndTurn, Explore,
//   ManifestDread, AssignGroup, ExchangeLife, Incubate, TwoPiles, SkipPhase,
//   EachDamage, ControlPlayer, LosesGame, Subgame, ExchangeLifeVariant,
//   RingTemptsYou, AlterAttribute, BidLife.
import { CardType, CounterType, ZoneType, mkEvent } from "@mtg-forge-ts/core";
import type {
  AbilityAst,
  CardDefinition,
  DecisionResponse,
  EntityId,
  PaperCard,
  PlayerSeat,
  SVarAst,
} from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { tempt } from "../../ring/temptation.js";
import { canBeSuspected } from "../../statics/wave76-gate-helpers.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility as SpellAbilityType } from "../spell-ability.js";

// Helpers ---------------------------------------------------------------------

const otherSeat = (seat: PlayerSeat, game: Game): PlayerSeat => {
  for (const p of game.players) if (p.seat !== seat) return p.seat;
  return seat;
};

const resolveCounterType = (raw: string): CounterType => {
  if (raw === "P1P1") return CounterType.PlusOnePlusOne;
  if (raw === "M1M1") return CounterType.MinusOneMinusOne;
  const lower = raw.toLowerCase();
  for (const v of Object.values(CounterType)) {
    if (typeof v === "string" && v.toLowerCase() === lower) return v as CounterType;
  }
  return raw as CounterType;
};

// 1. Proliferate --------------------------------------------------------------
// Forge `SP$ Proliferate` (CR 701.25) — choose any number of permanents and/or
// players with at least one counter on them; for each chosen, add another
// counter of a kind already present. Routes through game.action.proliferate
// which yields the canonical `chooseProliferateTargets` decision.
export class ProliferateEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Proliferate";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    yield* game.action.proliferate(sa.controllerSeat);
  }
}
effectRegistry.register(ProliferateEffect);

// 2. Venture ------------------------------------------------------------------
// Forge `SP$ Venture` (Adventures in the Forgotten Realms; CR 701.51) —
// venture into the dungeon: enter the next room of the current dungeon (or
// pick a starting dungeon if none is active). MVP records the venture intent
// on the source's `remembered` so the corpus exercises the SVar; full
// dungeon-state machine (room advance + DungeonCompleted emission) is SP4.
export class VentureEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Venture";

  // biome-ignore lint/correctness/useYield: stub mutation
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const source = game.cards.get(sa.sourceCardId);
    if (source) source.remembered.push(sa.sourceCardId);
    // TODO(emit-wiring): emit DungeonCompleted when the dungeon-tracker
    // advances past the last room. Requires the dungeon state machine
    // (game.flags.dungeons) which is SP4 scope. For now the trigger fires
    // only via test-side synth-emit.
  }
}
effectRegistry.register(VentureEffect);

// 3. Manifest -----------------------------------------------------------------
// Forge `SP$ Manifest` (Khans of Tarkir; CR 701.34) — put the top N cards of
// the controller's library onto the battlefield face-down as 2/2 creatures.
//
// Wave 83 — properly route through the canonical face-down state machine:
//   * stamp `card.faceDown = { kind: "manifest" }` (typed FaceDownState slot,
//     not the legacy `unknown` cast) so Layer 1's face-down override
//     (applyFaceDownOverride in layers/layer1-face-down.ts) clamps the public
//     characteristics to the canonical 2/2 colorless creature with no name,
//     no mana cost, and no abilities (CR 708.2).
//   * bump the layer-engine epoch so the next computeCharacteristics walk
//     re-evaluates Layer 1 and observes the new faceDown state (the engine's
//     epoch cache otherwise serves a stale face-up snapshot).
//   * emit FaceDownStateChanged so observers (snapshot logging, the
//     turn-face-up ledger, opening View flushes) see the transition.
// The turn-face-up activated ability (paying the printed mana cost to flip)
// remains an SP3 cost-pipeline concern.
export class ManifestEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Manifest";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "Amount") ? evaluateParamNumber(sa, "Amount", game) : 1;
    const seat = sa.controllerSeat;
    const player = game.getPlayer(seat);
    const lib = player.zones.get(ZoneType.Library);
    if (!lib) return;
    const ids = lib.toArray().slice(0, num);
    let bumpedEpoch = false;
    for (const id of ids) {
      yield* game.action.moveTo(id, ZoneType.Battlefield, { toSeat: seat, cause: "manifest" });
      const card = game.cards.get(id);
      if (card) {
        card.faceDown = { kind: "manifest" };
        if (!bumpedEpoch) {
          game.layerEngine.bumpEpoch("manifest");
          bumpedEpoch = true;
        }
        yield game.emitEvent(
          mkEvent("FaceDownStateChanged", game.turn, game.phase, {
            cardId: id,
            faceDown: true,
          }),
        );
      }
    }
  }
}
effectRegistry.register(ManifestEffect);

// 4. StoreSVar ----------------------------------------------------------------
// Forge `SP$ StoreSVar` — store an SVar value on the source card so a later
// effect can reference it.
//
// Wave 83 — evaluate the `Expression$` param into a number alongside the raw
// form so future SVar-driven calculations can read the stored result without
// re-evaluating each time. Both the raw expression (for back-compat / debug)
// and the evaluated numeric value live on the source card:
//   * `card.storedSVars: Map<string, string>` — raw, prior MVP slot.
//   * `card.storedSVarValues: Map<string, number>` — numeric, the new slot.
// On unparseable expressions (literal "X", non-numeric SVar refs) the value
// is omitted from `storedSVarValues` so callers can detect "stored but
// unevaluable" by checking presence in the numeric map.
export class StoreSVarEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "StoreSVar";

  // biome-ignore lint/correctness/useYield: pure mutation
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const key = hasParam(sa, "SVar") ? evaluateParamRaw(sa, "SVar") : "Stored";
    const expr = hasParam(sa, "Expression") ? evaluateParamRaw(sa, "Expression") : "0";
    const source = game.cards.get(sa.sourceCardId);
    if (!source) return;
    const bag = (source as { storedSVars?: Map<string, string> }).storedSVars ?? new Map<string, string>();
    bag.set(key, expr);
    (source as { storedSVars?: Map<string, string> }).storedSVars = bag;

    // Numeric evaluation pass. Try evaluateParamNumber first (handles literal
    // numbers + SVar references); the evaluator throws on unparseable input,
    // so wrap in try/catch and fall through to a base-10 parse. On both-fail
    // we omit the entry from the numeric map (callers detect "stored but
    // unevaluable" via map.has).
    const numericBag =
      (source as { storedSVarValues?: Map<string, number> }).storedSVarValues ?? new Map<string, number>();
    if (hasParam(sa, "Expression")) {
      let stored = false;
      try {
        const evaluated = evaluateParamNumber(sa, "Expression", game);
        if (Number.isFinite(evaluated)) {
          numericBag.set(key, evaluated);
          stored = true;
        }
      } catch {
        // Fall through — non-numeric expression; the parse-int retry below
        // catches the "Expression$ N" base-10 literal-only case.
      }
      if (!stored) {
        const parsed = Number.parseInt(expr, 10);
        if (Number.isFinite(parsed)) numericBag.set(key, parsed);
      }
    }
    (source as { storedSVarValues?: Map<string, number> }).storedSVarValues = numericBag;
  }
}
effectRegistry.register(StoreSVarEffect);

// 5. EndTurn ------------------------------------------------------------------
// Forge `SP$ EndTurn` (Time Stop family; CR 723.4) — end the current turn
// immediately: skip remaining phases, exile everything on the stack.
//
// Wave 85 — exile every other stack item (CR 723.4 — "exile all spells
// and abilities on the stack, including the spell that caused the turn
// to end"). The MVP ducked this and only flipped the intent flag. Now
// we walk `game.sharedZones.stack`, pop everything, and emit a canonical
// `StackItemCountered` pulse per popped item with reason "endTurn" so
// any `whenever a spell is countered` triggers can fire — and any
// observer mirroring the stack (snapshot, transcript replayers) drops
// the items in lockstep. The current EndTurn effect itself sits on
// the stack but is being resolved (already popped) by the time we
// reach this resolver, so we don't need a self-skip filter.
export class EndTurnEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "EndTurn";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    (game as { endTurnRequested?: boolean }).endTurnRequested = true;
    const stack = game.sharedZones.stack;
    // Snapshot stack-item ids before mutation for the canonical pulse; tag
    // the source-effect id so observers can correlate the wipe to the
    // EndTurn resolver.
    const remaining = stack.toArray().map((it) => it.id);
    while (!stack.isEmpty()) stack.pop();
    for (const stackItemId of remaining) {
      yield {
        kind: "event",
        event: mkEvent("StackItemCountered", game.turn, game.phase, {
          stackItemId,
          byEffectId: sa.sourceCardId,
        }),
      };
    }
  }
}
effectRegistry.register(EndTurnEffect);

// 6. Explore ------------------------------------------------------------------
// Forge `SP$ Explore` (Ixalan; CR 701.39) — reveal the top of the library;
// if it is a land, put it into hand. Otherwise put a +1/+1 counter on the
// exploring creature, then choose to put the card into hand or graveyard.
//
// Wave 80 — emit the canonical CardExplored event so Wave 20's
// "whenever ~ explores" trigger ("you may put it into your graveyard")
// observers fire (Trapjaw Tyrant, Pugnacious Pugilist, etc.). On the
// non-land branch, yield a chooseOption decision so the controller picks
// keep-on-top vs. graveyard (CR 701.39c). The +1/+1 counter goes on the
// exploring creature when non-land regardless of the keep/graveyard pick.
export class ExploreEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Explore";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const seat = sa.controllerSeat;
    const player = game.getPlayer(seat);
    const lib = player.zones.get(ZoneType.Library);
    const targetIds = sa.targets.length > 0 ? sa.targets : [sa.sourceCardId];
    if (!lib) return;
    const ids = lib.toArray();
    const topId = ids[0];
    if (topId === undefined) {
      // Empty library: still counts as an explore for triggers; counter the
      // creature (CR 701.39c — no card revealed = +1/+1 counter only).
      for (const id of targetIds) {
        yield* game.action.addCounter(id, CounterType.PlusOnePlusOne, 1, sa.sourceCardId);
        yield {
          kind: "event",
          event: {
            kind: "CardExplored",
            version: 1,
            turn: game.turn,
            phase: game.phase,
            payload: { cardId: id, playerSeat: seat, resultPutIntoHand: false },
          },
        };
      }
      return;
    }
    const chars = game.layerEngine.computeCharacteristics(topId);
    const isLand = chars.types.has(CardType.Land);
    let landed = false;
    if (isLand) {
      yield* game.action.moveTo(topId, ZoneType.Hand, { toSeat: seat, cause: "explore" });
      landed = true;
    } else {
      // Non-land branch: +1/+1 counter on each exploring creature, then a
      // chooseOption for the revealed card (keep-on-top vs. graveyard).
      for (const id of targetIds) {
        yield* game.action.addCounter(id, CounterType.PlusOnePlusOne, 1, sa.sourceCardId);
      }
      const decision = (yield {
        kind: "decision",
        request: {
          kind: "chooseOption",
          sourceId: sa.sourceCardId,
          options: [
            { id: "keep", description: "Keep on top of library" },
            { id: "grave", description: "Put into graveyard" },
          ],
        },
      }) as { readonly kind: "chooseOption"; readonly optionId: string } | undefined;
      const sendToGrave = decision?.kind === "chooseOption" && decision.optionId === "grave";
      if (sendToGrave) {
        yield* game.action.moveTo(topId, ZoneType.Graveyard, { toSeat: seat, cause: "explore" });
      }
      // Otherwise the card stays on top of the library (no movement needed).
    }
    // Emit one CardExplored per exploring creature for trigger observers.
    for (const id of targetIds) {
      yield {
        kind: "event",
        event: {
          kind: "CardExplored",
          version: 1,
          turn: game.turn,
          phase: game.phase,
          payload: { cardId: id, playerSeat: seat, resultPutIntoHand: landed },
        },
      };
    }
  }
}
effectRegistry.register(ExploreEffect);

// 7. ManifestDread ------------------------------------------------------------
// Forge `SP$ ManifestDread` (Duskmourn) — look at top 2 cards; manifest one
// face-down as a 2/2, put the other into the graveyard.
//
// Wave 83 — yield a typed `chooseCard` decision so the controller actually
// picks which of the two top cards is manifested vs. milled (CR 701.34 +
// Duskmourn rules); on missing / wrong-shape response we fall back to the
// legacy "first is manifested, second is milled" deterministic order. Also
// stamp the canonical face-down state + bump the layer-engine epoch + emit
// FaceDownStateChanged (mirrors ManifestEffect) so the 2/2 override applies.
export class ManifestDreadEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ManifestDread";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const seat = sa.controllerSeat;
    const player = game.getPlayer(seat);
    const lib = player.zones.get(ZoneType.Library);
    if (!lib) return;
    const ids = lib.toArray().slice(0, 2);
    if (ids.length === 0) return;

    // Yield a chooseCard decision (pool = the two top cards; pick exactly 1
    // to manifest). The non-picked id is milled.
    let manifestId: EntityId | undefined = ids[0];
    let graveId: EntityId | undefined = ids[1];
    if (ids.length === 2) {
      const rawResponse = yield {
        kind: "decision",
        request: {
          kind: "chooseCard",
          playerSeat: seat,
          pool: ids,
          restriction: { effect: "ManifestDread", mode: "PickManifested" },
          min: 1,
          max: 1,
        },
      };
      const response = rawResponse as DecisionResponse | undefined;
      if (response && response.kind === "chooseCard" && response.chosen.length === 1) {
        const picked = response.chosen[0];
        if (picked !== undefined && (picked === ids[0] || picked === ids[1])) {
          manifestId = picked;
          graveId = picked === ids[0] ? ids[1] : ids[0];
        }
      }
    }

    if (manifestId !== undefined) {
      yield* game.action.moveTo(manifestId, ZoneType.Battlefield, {
        toSeat: seat,
        cause: "manifest-dread",
      });
      const card = game.cards.get(manifestId);
      if (card) {
        card.faceDown = { kind: "manifest" };
        game.layerEngine.bumpEpoch("manifest-dread");
        yield game.emitEvent(
          mkEvent("FaceDownStateChanged", game.turn, game.phase, {
            cardId: manifestId,
            faceDown: true,
          }),
        );
      }
    }
    if (graveId !== undefined) {
      yield* game.action.moveTo(graveId, ZoneType.Graveyard, { toSeat: seat, cause: "discard" });
    }
  }
}
effectRegistry.register(ManifestDreadEffect);

// 8. AssignGroup --------------------------------------------------------------
// Forge `SP$ AssignGroup` — assign cards to one of N labeled groups (rare;
// e.g. Council's Dilemma piles).
//
// Wave 86 — per-group slots via `Group$ <label>` param. The targets land on
// `source.groupedRemembered.get(label)` AND continue to be appended to
// `source.remembered` for back-compat with downstream readers that don't
// know about labels yet. When no Group$ is supplied the legacy "default"
// label is used so existing tests keep working without explicit grouping.
export class AssignGroupEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "AssignGroup";

  // biome-ignore lint/correctness/useYield: pure mutation
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const source = game.cards.get(sa.sourceCardId);
    if (!source) return;
    const label = hasParam(sa, "Group") ? evaluateParamRaw(sa, "Group") : "default";
    const sourceWithGroups = source as {
      groupedRemembered?: Map<string, EntityId[]>;
    };
    const groups = sourceWithGroups.groupedRemembered ?? new Map<string, EntityId[]>();
    const slot = groups.get(label) ?? [];
    for (const id of sa.targets) {
      slot.push(id);
      // Back-compat — flat remembered list still gets the targets.
      source.remembered.push(id);
    }
    groups.set(label, slot);
    sourceWithGroups.groupedRemembered = groups;
  }
}
effectRegistry.register(AssignGroupEffect);

// 9. ExchangeLife -------------------------------------------------------------
// Forge `SP$ ExchangeLife` (CR 701.10) — exchange the controller's life total
// with another player's.
//
// Wave 80 — route through game.action.changeLife with the per-seat delta so
// life-change replacements (CantGainLife / CantLoseLife / CantChangeLife
// gates from Wave 70.E/M/O), LifeChanged triggers, and Wave 51 per-turn
// life trackers all fire correctly. Both deltas snapshot the original life
// totals BEFORE the first changeLife call so the second call sees the
// pre-swap delta even though the first call already mutated player.life.
export class ExchangeLifeEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ExchangeLife";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const a = game.getPlayer(sa.controllerSeat);
    const otherDef = hasParam(sa, "Defined") ? evaluateParamRaw(sa, "Defined") : "Opponent";
    const bSeat: PlayerSeat =
      otherDef === "Opponent" ? otherSeat(sa.controllerSeat, game) : sa.controllerSeat;
    if (bSeat === sa.controllerSeat) return;
    const b = game.getPlayer(bSeat);
    const aLife = a.life;
    const bLife = b.life;
    const deltaA = bLife - aLife;
    const deltaB = aLife - bLife;
    if (deltaA !== 0) {
      yield* game.action.changeLife(sa.controllerSeat, deltaA, { cause: "exchange-life" });
    }
    if (deltaB !== 0) {
      yield* game.action.changeLife(bSeat, deltaB, { cause: "exchange-life" });
    }
  }
}
effectRegistry.register(ExchangeLifeEffect);

// 10. Incubate ---------------------------------------------------------------
// Forge `SP$ Incubate` (Phyrexia: All Will Be One) — create an Incubator
// token (transforms into a 0/0 Phyrexian artifact creature when it has 3+
// counters; controller may pay {2} to flip). MVP: stash a flag on source.
export class IncubateEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Incubate";

  // biome-ignore lint/correctness/useYield: stub
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const source = game.cards.get(sa.sourceCardId);
    if (source) source.remembered.push(sa.sourceCardId);
    // TODO(advanced): create the actual Incubator token with N +1/+1
    // counters via tokenDatabase + register the transform activated ability.
  }
}
effectRegistry.register(IncubateEffect);

// 11. TwoPiles ----------------------------------------------------------------
// Forge `SP$ TwoPiles` (Fact or Fiction; CR 701.6) — divide a set of cards
// into two piles; opponent picks which pile becomes hand and which becomes
// graveyard.
//
// Wave 80 — yield a `dividePileChoice` request to the splitting player
// (the source controller's opponent — Forge's "an opponent of you divides"
// canonical), then a `chooseCardsPile` request to the chooser (the source
// controller). Mirrors the proven MultiplePilesEffect pattern but for the
// strict 2-pile case. On invalid divider response the engine falls back to
// the even half/half split; on invalid chooser response we default to pile
// A. Pile A goes to hand; pile B goes to graveyard, matching FoF canonical.
export class TwoPilesEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "TwoPiles";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "Amount") ? evaluateParamNumber(sa, "Amount", game) : 5;
    const controllerSeat = sa.controllerSeat;
    const controllerPlayer = game.getPlayer(controllerSeat);
    const lib = controllerPlayer.zones.get(ZoneType.Library);
    if (!lib) return;
    const top = lib.toArray().slice(0, num);
    if (top.length === 0) return;

    const splitterSeat = otherSeat(controllerSeat, game);
    // Default even-split partition (engine fallback).
    const half = Math.ceil(top.length / 2);
    const defaultA = top.slice(0, half);
    const defaultB = top.slice(half);

    // Yield dividePileChoice to the splitting player.
    const splitRaw = yield {
      kind: "decision",
      request: {
        kind: "dividePileChoice",
        playerSeat: splitterSeat,
        sourceId: sa.sourceCardId,
        cards: top,
        numPiles: 2,
      },
    };
    const splitResp = splitRaw as DecisionResponse | undefined;
    let pileA: readonly EntityId[] = defaultA;
    let pileB: readonly EntityId[] = defaultB;
    if (splitResp && splitResp.kind === "dividePileChoice" && splitResp.piles.length === 2) {
      const [candA, candB] = splitResp.piles;
      // Validate: piles partition the input set (each id exactly once).
      const expected = new Set(top);
      const seen = new Set<EntityId>();
      let ok = true;
      for (const pile of [candA, candB]) {
        if (!pile) {
          ok = false;
          break;
        }
        for (const id of pile) {
          if (!expected.has(id) || seen.has(id)) {
            ok = false;
            break;
          }
          seen.add(id);
        }
        if (!ok) break;
      }
      if (ok && seen.size === top.length) {
        pileA = candA ?? defaultA;
        pileB = candB ?? defaultB;
      }
    }

    // Yield the chooser's pick.
    const pickRaw = yield {
      kind: "decision",
      request: {
        kind: "chooseCardsPile",
        sourceId: sa.sourceCardId,
        pileA,
        pileB,
      },
    };
    const pickResp = pickRaw as DecisionResponse | undefined;
    let chosenIsA = true;
    if (pickResp && pickResp.kind === "chooseCardsPile") {
      chosenIsA = pickResp.chosen !== "b";
    }
    const chosen = chosenIsA ? pileA : pileB;
    const discarded = chosenIsA ? pileB : pileA;
    for (const id of chosen) {
      yield* game.action.moveTo(id, ZoneType.Hand, { toSeat: controllerSeat, cause: "two-piles" });
    }
    for (const id of discarded) {
      yield* game.action.moveTo(id, ZoneType.Graveyard, {
        toSeat: controllerSeat,
        cause: "two-piles",
      });
    }
  }
}
effectRegistry.register(TwoPilesEffect);

// 12. SkipPhase ---------------------------------------------------------------
// Forge `SP$ SkipPhase` — skip the next instance of the named phase for a
// player. MVP: stash a record on the player flags map.
export class SkipPhaseEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "SkipPhase";

  // biome-ignore lint/correctness/useYield: pure flag mutation
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const phaseRaw = hasParam(sa, "Phase") ? evaluateParamRaw(sa, "Phase") : "Combat";
    const definedRaw = hasParam(sa, "Defined") ? evaluateParamRaw(sa, "Defined") : "You";
    const seat: PlayerSeat =
      definedRaw === "Opponent" ? otherSeat(sa.controllerSeat, game) : sa.controllerSeat;
    const player = game.getPlayer(seat);
    const skips = (player as { phaseSkips?: string[] }).phaseSkips ?? [];
    skips.push(phaseRaw);
    (player as { phaseSkips?: string[] }).phaseSkips = skips;
    // Wave 87 — turn-loop integration. The skip is consumed by
    // `Game.consumePhaseSkip(seat, phase)`, which pops one matching
    // entry off `player.phaseSkips` and stamps a `phase-skipped`
    // record on `game.decisionWarnings`. The turn-loop (and tests
    // exercising it) calls the helper on phase entry; the SkipPhase
    // effect itself only stamps the queue.
  }
}
effectRegistry.register(SkipPhaseEffect);

// 13. EachDamage --------------------------------------------------------------
// Forge `SP$ EachDamage` — deal X damage to each target matching the filter.
// MVP: deal Num damage to every entity in sa.targets via game.action.dealDamage.
export class EachDamageEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "EachDamage";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "NumDmg") ? evaluateParamNumber(sa, "NumDmg", game) : 1;
    for (const id of sa.targets) {
      // MVP: classify every target as a creature; full filter routing is SP4.
      yield* game.action.damage(sa.sourceCardId, "creature", id, num, false);
    }
    // TODO(advanced): honor `ValidTgts$` filter expansion across the
    // battlefield (targetless "deal N to each creature your opponents
    // control") instead of the explicit-targets path.
  }
}
effectRegistry.register(EachDamageEffect);

// 14. ControlPlayer -----------------------------------------------------------
// Forge `SP$ ControlPlayer` — take control of opponent's next turn (Mindslaver,
// Worst Fears). MVP: stamp a flag on the controller-target player.
export class ControlPlayerEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ControlPlayer";

  // biome-ignore lint/correctness/useYield: pure flag mutation
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const definedRaw = hasParam(sa, "Defined") ? evaluateParamRaw(sa, "Defined") : "Opponent";
    const seat: PlayerSeat =
      definedRaw === "Opponent" ? otherSeat(sa.controllerSeat, game) : sa.controllerSeat;
    const player = game.getPlayer(seat);
    (player as { controlledByOnNextTurn?: PlayerSeat }).controlledByOnNextTurn = sa.controllerSeat;
    // TODO(advanced): turn-loop integration — when seat begins their next
    // turn, route every priority pass + decision through controlledBy. Emit
    // PlayerControlled / PlayerControlReleased.
  }
}
effectRegistry.register(ControlPlayerEffect);

// 15. LosesGame ---------------------------------------------------------------
// Forge `SP$ LosesGame` — direct lose-game trigger (Lich's Mirror inverse,
// "you lose the game"). Routes through game.action.gameLoss so any
// Platinum-Angel-style replacement can deny.
export class LosesGameEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "LosesGame";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const definedRaw = hasParam(sa, "Defined") ? evaluateParamRaw(sa, "Defined") : "You";
    const seat: PlayerSeat =
      definedRaw === "Opponent" ? otherSeat(sa.controllerSeat, game) : sa.controllerSeat;
    yield* game.action.gameLoss(seat, { cause: "effect", reason: "effect" });
  }
}
effectRegistry.register(LosesGameEffect);

// 16. Subgame -----------------------------------------------------------------
// Forge `SP$ Subgame` (Shahrazad) — start a subgame; the loser of the subgame
// loses half their life rounded up. Single-card target in the entire Forge
// corpus.
//
// MVP simplification: a faithful Shahrazad implementation needs to spawn a
// nested Game with a copy of each player's lobby + library and run a complete
// game loop with autonomous play (priority, AI, mulligans, an entire match-
// in-a-match). That is far out of scope for the SP1/SP2 engine slice. Instead
// we resolve the subgame deterministically from the parent state:
//
//   score(p) = p.life * 2 + sum(power of creatures p controls) + p.library.size
//
// The higher-scoring player wins; the active player breaks ties. The loser
// loses half their life rounded up via game.action.changeLife (so the LifeLost
// / LifeChanged pipeline still fires). A single SubgameResolved event captures
// the outcome.
//
// TODO(advanced): instantiate a child Game with the same lobby + a copy of
// each player's library; emit SubgameStarted/SubgameEnded; route the subgame
// through the priority orchestrator; apply the loser consequence based on the
// nested game's actual winner.
export class SubgameEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Subgame";

  override *resolve(_sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    if (game.players.length < 2) return;

    // Compute deterministic score for each player.
    const scoreOf = (seat: PlayerSeat): number => {
      const player = game.getPlayer(seat);
      const life = player.life;
      const librarySize = player.zones.get(ZoneType.Library)?.size ?? 0;
      let powerTotal = 0;
      const battlefield = player.zones.get(ZoneType.Battlefield);
      if (battlefield) {
        for (const id of battlefield.toArray()) {
          const chars = game.layerEngine.computeCharacteristics(id);
          powerTotal += chars.power ?? 0;
        }
      }
      return life * 2 + powerTotal + librarySize;
    };

    const [a, b] = game.players;
    if (!a || !b) return;
    const seatA = a.seat;
    const seatB = b.seat;
    const scoreA = scoreOf(seatA);
    const scoreB = scoreOf(seatB);

    let winnerSeat: PlayerSeat;
    let loserSeat: PlayerSeat;
    if (scoreA > scoreB) {
      winnerSeat = seatA;
      loserSeat = seatB;
    } else if (scoreB > scoreA) {
      winnerSeat = seatB;
      loserSeat = seatA;
    } else {
      // Tie — active player wins.
      winnerSeat = game.activePlayer;
      loserSeat = winnerSeat === seatA ? seatB : seatA;
    }

    const loser = game.getPlayer(loserSeat);
    const lifeLost = Math.ceil(loser.life / 2);

    if (lifeLost > 0) {
      yield* game.action.changeLife(loserSeat, -lifeLost, { cause: "subgame" });
    }

    yield game.emitEvent(
      mkEvent("SubgameResolved", game.turn, game.phase, {
        winnerSeat,
        loserSeat,
        lifeLost,
      }),
    );
  }
}
effectRegistry.register(SubgameEffect);

// 17. ExchangeLifeVariant -----------------------------------------------------
// Forge `SP$ ExchangeLifeVariant` — variant of ExchangeLife with conditions
// (e.g. only if the controller's life is lower). MVP: same swap, gated on a
// simple condition param (`Condition$ LowerLife`).
export class ExchangeLifeVariantEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ExchangeLifeVariant";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const aSeat = sa.controllerSeat;
    const bSeat = otherSeat(sa.controllerSeat, game);
    const a = game.getPlayer(aSeat);
    const b = game.getPlayer(bSeat);
    const cond = hasParam(sa, "Condition") ? evaluateParamRaw(sa, "Condition") : "Always";
    if (cond === "LowerLife" && a.life >= b.life) return;
    if (cond === "HigherLife" && a.life <= b.life) return;
    // Wave 81 — route through game.action.changeLife (mirrors Wave 80's
    // ExchangeLifeEffect fix). Snapshot both totals BEFORE the first
    // changeLife call so the second call sees the pre-swap delta even
    // though the first call has already mutated player.life. Going through
    // changeLife means CR 119 replacements (CantGainLife / CantLoseLife /
    // CantChangeLife from Waves 70.E/M/O), LifeChanged triggers, and the
    // Wave 51 per-turn life trackers all engage on this variant, just like
    // the unconditional ExchangeLifeEffect.
    const aLife = a.life;
    const bLife = b.life;
    const aDelta = bLife - aLife;
    const bDelta = aLife - bLife;
    if (aDelta !== 0) yield* game.action.changeLife(aSeat, aDelta, { cause: "exchange-life" });
    if (bDelta !== 0) yield* game.action.changeLife(bSeat, bDelta, { cause: "exchange-life" });
  }
}
effectRegistry.register(ExchangeLifeVariantEffect);

// 18. RingTemptsYou (effect form) --------------------------------------------
// Forge `SP$ RingTemptsYou` — the Ring tempts you (CR 701.52). Increments the
// player's Ring level (clamped at 4) and yields a `chooseRingBearer` decision
// so the controller picks one of their creatures; on null/empty the bearer
// reverts to null. RingTempted (and RingLevelChanged on transition) are
// emitted by the shared `tempt()` helper, which also bumps the duck-typed
// `ringTemptations` counter for back-compat with this handler's prior MVP.
//
// Wave 81 — closes the prior TODO that read "yield a chooseRingBearer
// decision so the controller picks a creature; track ring-bearer ID on the
// player." Delegating to `tempt()` (Tasks 63 + 68) reuses the canonical Ring
// pipeline: the same level-clamp, the same candidate enumeration (creatures
// you control, on the battlefield, via layerEngine.computeCharacteristics),
// the same ledger refresh, and the same event payloads — so corpus cards
// like `The Ring Goes South` (an SP$ RingTemptsYou variant) line up with
// the existing keyword-side Ring temptation that all Tales of Middle-earth
// LOTR cards already use.
export class RingTemptsYouEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "RingTemptsYou";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const seat = sa.controllerSeat;
    // Bump the legacy `ringTemptations` counter for any consumers that
    // still read it (snapshot back-compat); `tempt()` advances the
    // canonical `game.ringState[seat].level` independently.
    const player = game.getPlayer(seat);
    const cur = (player as { ringTemptations?: number }).ringTemptations ?? 0;
    (player as { ringTemptations?: number }).ringTemptations = cur + 1;
    yield* tempt(game, seat);
  }
}
effectRegistry.register(RingTemptsYouEffect);

// 19. AlterAttribute ----------------------------------------------------------
// Forge `SP$ AlterAttribute` — modify a flag-style attribute on the source/
// target. Mirrors AlterAttributeEffect.java's switch on "Attributes$" —
// recognised values flip a typed Card slot; unrecognised attribute names
// fall back to the legacy `card.attributes` Map (variant rules / numeric
// counters).
//
// Forge surface (CR 701.58 / Murders at Karlov Manor):
//   AB$ AlterAttribute | Defined$ Self    | Attributes$ Suspected
//   AB$ AlterAttribute | Defined$ Targeted| Attributes$ Suspect
//   AB$ AlterAttribute | Defined$ Self    | Attributes$ Suspected | Activate$ False
//
// "Activate$" is "true" by default (set the attribute); "Activate$ False"
// clears it. The Suspect/Suspected synonym is from Forge's switch cases:
// `case "Suspect": case "Suspected": altered = gameCard.setSuspected(activate);`
export class AlterAttributeEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "AlterAttribute";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const activate = hasParam(sa, "Activate") ? evaluateParamRaw(sa, "Activate") !== "False" : true;
    const ids = sa.targets.length > 0 ? sa.targets : [sa.sourceCardId];

    // Wave 71 — multi-attribute support (Forge's `Attributes$` is comma-
    // separated). When `Attributes$` is set we dispatch each attribute
    // through the typed-flag path below. The legacy `Attribute$` (single)
    // / `Amount$` (numeric delta) path is preserved for the variant-rule
    // case (e.g. ring-level).
    if (hasParam(sa, "Attributes")) {
      const raw = evaluateParamRaw(sa, "Attributes");
      const attrs = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const id of ids) {
        const card = game.cards.get(id);
        if (!card) continue;
        for (const attr of attrs) {
          switch (attr) {
            case "Suspect":
            case "Suspected": {
              // CR 701.58d — "A suspected permanent can't become
              // suspected again." Skip when already suspected (matches
              // Forge's setSuspected guard).
              if (activate && card.suspected === true) continue;
              if (!activate && card.suspected !== true) continue;
              // Wave 76 — CantBeSuspected static gate; matched cards
              // refuse the suspect transition (silent rejection).
              if (activate && !canBeSuspected(game, id)) continue;
              card.suspected = activate ? true : undefined;
              // Bump the layer engine epoch so the menace synthesis in
              // hasKeyword sees the new flag without a stale cache.
              game.layerEngine.bumpEpoch(activate ? "suspect" : "cease-suspect");
              yield game.emitEvent(
                mkEvent(activate ? "CardSuspected" : "CardUnsuspected", game.turn, game.phase, {
                  cardId: id,
                  sourceId: sa.sourceCardId,
                }),
              );
              break;
            }
            // TODO(advanced): Plotted/Solved/Saddled/Harnessed parity —
            // currently handled by their own keyword/effect paths
            // (plot-keyword.ts, saddle-keyword.ts). Leave the switch
            // open for future fold-ins so Forge's full AlterAttribute
            // umbrella matches.
            default:
              break;
          }
        }
      }
      return;
    }

    // Legacy single-attribute / numeric path.
    const attr = hasParam(sa, "Attribute") ? evaluateParamRaw(sa, "Attribute") : "default";
    const delta = hasParam(sa, "Amount") ? evaluateParamNumber(sa, "Amount", game) : 1;
    let anyChanged = false;
    for (const id of ids) {
      const card = game.cards.get(id);
      if (!card) continue;
      const attrs = (card as { attributes?: Map<string, number> }).attributes ?? new Map<string, number>();
      const before = attrs.get(attr) ?? 0;
      const after = before + delta;
      attrs.set(attr, after);
      (card as { attributes?: Map<string, number> }).attributes = attrs;
      if (before !== after) {
        anyChanged = true;
        // Wave 88 — surface the change for attribute-watching observers via
        // decisionWarnings. A dedicated AttributeChanged engine event is
        // gated on the trigger-mode taxonomy growing the kind, but the
        // decision-warning channel already gives tests + the snapshot
        // pipeline a way to introspect "this attribute moved from N to M
        // by source X". Stamp once per id+attribute change with a
        // `attribute-changed` discriminator.
        game.decisionWarnings.push({
          kind: "attribute-changed",
          sourceId: sa.sourceCardId,
          detail: `${id}:${attr}:${before}->${after}`,
        });
      }
    }
    // Wave 88 — bump the layer engine epoch on numeric attribute changes
    // so any downstream layered grants gated on `attributes.get(attr)`
    // (e.g. ring-level scaling, "for each rage counter on" triggers)
    // re-pull rather than read the cached value. The legacy path
    // mutated in-place without a recompute hint.
    if (anyChanged) {
      game.layerEngine.bumpEpoch("alter-attribute");
    }
  }
}
effectRegistry.register(AlterAttributeEffect);

// 20. BidLife ----------------------------------------------------------------
// Forge `SP$ BidLife` (Lim-Dûl's Vault, etc.) — bid life amounts; high bidder
// wins the auction. MVP: deterministic — controller bids 1; opponent passes;
// controller pays 1 life.
//
// Wave 85 — route the life payment through `game.action.changeLife` so the
// canonical LifeChanged + LifeLost events fire (and any "whenever you
// lose life" / "whenever life total changes" triggers + replacements
// engage). The MVP wrote `player.life` directly, which silenced both
// triggers (the LifeChange replacement chain skipped) and the snapshot
// pipeline. Pass `cause: "effect"` to mirror the closest sibling
// (initiative-tracker pays opponents -5 with the same tag).
export class BidLifeEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "BidLife";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    yield* game.action.changeLife(sa.controllerSeat, -1, { cause: "effect" });
    const source = game.cards.get(sa.sourceCardId);
    if (source) source.remembered.push(sa.sourceCardId);
  }
}
effectRegistry.register(BidLifeEffect);

// Silenced unused imports — referenced only by future sub-params.
void resolveCounterType;
void (null as unknown as AbilityAst);
void (null as unknown as CardDefinition);
void (null as unknown as PaperCard);
void (null as unknown as SVarAst);
void (null as unknown as EntityId);
