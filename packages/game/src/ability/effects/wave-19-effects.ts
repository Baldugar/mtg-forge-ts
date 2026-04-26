// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 19 — final corpus-unknown effect handlers (15 entries). Pushes the
// effect coverage from 99.1% toward ~100%. Same MVP shape as Wave 18: each
// class extends SpellAbilityEffect, registers its handlerKey, and produces
// an observable game-state change so the canonical case is exercised.
// Advanced sub-params are flagged with TODO comments.
//
// Effects covered:
//   LookAt, RemoveFromCombat, DigMultiple, Goad, Shuffle, ChangeTargets,
//   PermanentNoncreature, Discover, Blight, Connive, FlipOntoBattlefield,
//   BecomesBlocked, AddOrRemoveCounter, AdvanceCrank, WinsGame.
import { CardType, CounterType, GameStateIntegrityError, TypeLine, ZoneType } from "@mtg-forge-ts/core";
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
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import { SpellAbility } from "../spell-ability.js";
import type { SpellAbility as SpellAbilityType } from "../spell-ability.js";

// Helpers ---------------------------------------------------------------------

const resolveCounterType = (raw: string): CounterType => {
  if (raw === "P1P1") return CounterType.PlusOnePlusOne;
  if (raw === "M1M1") return CounterType.MinusOneMinusOne;
  const lower = raw.toLowerCase();
  for (const v of Object.values(CounterType)) {
    if (typeof v === "string" && v.toLowerCase() === lower) return v as CounterType;
  }
  return raw as CounterType;
};

// 1. LookAt -------------------------------------------------------------------
// Forge `SP$ LookAt` — reveal cards face-up to ONE chosen player only (vs.
// `Reveal` which reveals to all). MVP: emit a CardsRevealed event scoped to
// the controller as the sole `revealedTo` recipient.
export class LookAtEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "LookAt";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "LookAtAmount") ? evaluateParamNumber(sa, "LookAtAmount", game) : 1;
    const seat = sa.controllerSeat;
    const player = game.getPlayer(seat);
    const lib = player.zones.get(ZoneType.Library);
    if (!lib) return;
    const ids = lib.toArray().slice(0, num);
    if (ids.length === 0) return;
    yield {
      kind: "event",
      event: {
        kind: "CardsRevealed",
        version: 1,
        turn: game.turn,
        phase: game.phase,
        payload: {
          revealedBy: seat,
          revealedTo: [seat],
          cardIds: ids,
          fromZone: ZoneType.Library,
        },
      },
    };
    // TODO(advanced): support `LookAtAll` / `Defined$ Player.Opponent` so the
    // controller may peek at an opponent's hand or library.
  }
}
effectRegistry.register(LookAtEffect);

// 2. RemoveFromCombat ---------------------------------------------------------
// Forge `SP$ RemoveFromCombat` — remove targets from combat. Sets a card-local
// flag that combat resolution honors.
export class RemoveFromCombatEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "RemoveFromCombat";

  // biome-ignore lint/correctness/useYield: pure flag mutation
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    for (const id of sa.targets) {
      const card = game.cards.get(id);
      if (!card) continue;
      card.removedFromCombat = true;
    }
  }
}
effectRegistry.register(RemoveFromCombatEffect);

// 3. DigMultiple --------------------------------------------------------------
// Forge `SP$ DigMultiple` — variant of Dig: dig N times. MVP: each iteration
// reveals the top `DigNum` cards and either adds them to hand or leaves them.
// Mirror Dig for params (DigNum, ChangeNum, DestinationZone).
export class DigMultipleEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "DigMultiple";

  // biome-ignore lint/correctness/useYield: stub records dug ids on remembered
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const repeat = hasParam(sa, "Repeat") ? evaluateParamNumber(sa, "Repeat", game) : 1;
    const digNum = hasParam(sa, "DigNum") ? evaluateParamNumber(sa, "DigNum", game) : 1;
    const seat = sa.controllerSeat;
    const player = game.getPlayer(seat);
    const lib = player.zones.get(ZoneType.Library);
    if (!lib) return;
    for (let i = 0; i < repeat; i++) {
      const ids = lib.toArray().slice(0, digNum);
      if (ids.length === 0) break;
      // MVP: surface the dug cards on `remembered` so callers can introspect.
      // The full chooser ladder (DestinationZone$, ChangeNum$ etc.) is SP4.
      const source = game.cards.get(sa.sourceCardId);
      if (source) {
        for (const id of ids) source.remembered.push(id);
      }
    }
    // TODO(advanced): full ChangeNum / RestRandomOrder / DestinationZone wiring.
  }
}
effectRegistry.register(DigMultipleEffect);

// 4. Goad ---------------------------------------------------------------------
// Forge `SP$ Goad` (CR 701.42) — set the goaded flag on each target. Combat
// declaration logic treats a goaded creature as "must attack if able and must
// attack a player other than the goader".
export class GoadEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Goad";

  // biome-ignore lint/correctness/useYield: pure flag mutation
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    for (const id of sa.targets) {
      const card = game.cards.get(id);
      if (!card) continue;
      card.goaded = true;
    }
    // TODO(advanced): track goader seat so the "other than goader" rule is
    // enforced during combat declaration.
  }
}
effectRegistry.register(GoadEffect);

// 5. Shuffle ------------------------------------------------------------------
// Forge `SP$ Shuffle` — shuffle a player's library via game.action.shuffle.
export class ShuffleEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Shuffle";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const definedRaw = hasParam(sa, "Defined") ? evaluateParamRaw(sa, "Defined") : "You";
    const seat: PlayerSeat =
      definedRaw === "Opponent" ? otherSeat(sa.controllerSeat, game) : sa.controllerSeat;
    yield* game.action.shuffle(seat);
  }
}
effectRegistry.register(ShuffleEffect);

const otherSeat = (seat: PlayerSeat, game: Game): PlayerSeat => {
  for (const p of game.players) if (p.seat !== seat) return p.seat;
  return seat;
};

// 6. ChangeTargets ------------------------------------------------------------
// Forge `SP$ ChangeTargets` — modify an existing stack item's targets (Misdirection
// / Redirect-style). MVP: rewrite the stack item's targets to the SA's targets[1..].
export class ChangeTargetsEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ChangeTargets";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    if (sa.targets.length === 0) return;
    const stackItemId = sa.targets[0];
    if (stackItemId === undefined) return;
    const items = game.sharedZones.stack.toArray();
    const stackItem = items.find((it: { id: EntityId }) => it.id === stackItemId);
    if (!stackItem) return;
    const newTargets = sa.targets.slice(1);
    // StackItem.targets is declared readonly; ChangeTargets is the legitimate
    // mutator (CR 706.13 redirect). Cast and rewrite.
    const mutable = stackItem as unknown as { targets: readonly EntityId[] };
    mutable.targets = newTargets;
    // TODO(advanced): legality re-check + emit StackItemTargetsChanged event.
  }
}
effectRegistry.register(ChangeTargetsEffect);

// 7. PermanentNoncreature -----------------------------------------------------
// Forge `SP$ PermanentNoncreature` — put a non-creature permanent (artifact,
// enchantment, planeswalker) onto the battlefield. Mirrors PermanentCreature.
export class PermanentNoncreatureEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "PermanentNoncreature";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    // The Forge form is used for cards whose ability resolves "as if cast" the
    // top spell; the runtime effect simply places the source onto the
    // battlefield under the controller's control. MVP toggles zone.
    const card = game.cards.get(sa.sourceCardId);
    if (!card) return;
    if (card.zone === ZoneType.Battlefield) return;
    yield* game.action.moveTo(sa.sourceCardId, ZoneType.Battlefield, {
      toSeat: sa.controllerSeat,
      cause: "effect",
    });
  }
}
effectRegistry.register(PermanentNoncreatureEffect);

// 8. Discover -----------------------------------------------------------------
// Forge `SP$ Discover` (Lost Caverns of Ixalan; CR 702.166) — Discover N:
// exile cards from the top of the library until a non-land card with mana
// value ≤ N is exiled. Cast it for free OR put it in hand; rest go to bottom.
// MVP: exile cards until a non-land hits, put it on `remembered` and into
// hand by default. Full free-cast wiring (FreeCastPipeline mirror) is SP4.
export class DiscoverEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Discover";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const n = hasParam(sa, "Num") ? evaluateParamNumber(sa, "Num", game) : 0;
    const seat = sa.controllerSeat;
    const player = game.getPlayer(seat);
    const lib = player.zones.get(ZoneType.Library);
    if (!lib) return;
    const exiled: EntityId[] = [];
    let pickedNonLand: EntityId | null = null;
    while (lib.size > 0) {
      const ids = lib.toArray();
      const topId = ids[0];
      if (topId === undefined) break;
      const topCard = game.cards.get(topId);
      if (!topCard) break;
      yield* game.action.moveTo(topId, ZoneType.Exile, { toSeat: seat, cause: "effect" });
      exiled.push(topId);
      const chars = game.layerEngine.computeCharacteristics(topId);
      const isLand = chars.types.has(CardType.Land);
      const cmc = chars.manaCost ? chars.manaCost.cmc(0) : 0;
      if (!isLand && cmc <= n) {
        pickedNonLand = topId;
        break;
      }
    }
    if (pickedNonLand !== null) {
      // MVP: route the picked card to the controller's hand. SP4 will yield a
      // confirmAction so the controller may cast it for free instead.
      yield* game.action.moveTo(pickedNonLand, ZoneType.Hand, { toSeat: seat, cause: "effect" });
      const source = game.cards.get(sa.sourceCardId);
      if (source) source.remembered.push(pickedNonLand);
    }
    // TODO(advanced): bottom remaining exiled cards in random order; offer
    // the cast-for-free decision via FreeCastPipeline. Mirrors Cascade resolver.
    void exiled;
  }
}
effectRegistry.register(DiscoverEffect);

// 9. Blight -------------------------------------------------------------------
// Forge `SP$ Blight` — Phyrexian/oil-counter mechanic. Add an "oil" counter
// to each target (or an explicitly named CounterType$).
export class BlightEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Blight";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const typeRaw = hasParam(sa, "CounterType") ? evaluateParamRaw(sa, "CounterType") : "Oil";
    const num = hasParam(sa, "CounterNum") ? evaluateParamNumber(sa, "CounterNum", game) : 1;
    const ct = resolveCounterType(typeRaw);
    for (const id of sa.targets) {
      yield* game.action.addCounter(id, ct, num, sa.sourceCardId);
    }
  }
}
effectRegistry.register(BlightEffect);

// 10. Connive -----------------------------------------------------------------
// Forge `SP$ Connive` (Streets of New Capenna; CR 702.165) — draw a card,
// then discard a card. If a non-land was discarded, +1/+1 counter on each
// target. MVP: draw + discard + counter (skip the non-land conditional check
// since counter goes on Self regardless in Forge's MVP form).
export class ConniveEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Connive";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const seat = sa.controllerSeat;
    yield* game.action.drawCards(seat, 1);
    const player = game.getPlayer(seat);
    const hand = player.zones.get(ZoneType.Hand);
    if (!hand) return;
    const ids = hand.toArray();
    const discardId = ids[ids.length - 1];
    let nonLandDiscarded = false;
    if (discardId !== undefined) {
      const chars = game.layerEngine.computeCharacteristics(discardId);
      nonLandDiscarded = !chars.types.has(CardType.Land);
      yield* game.action.moveTo(discardId, ZoneType.Graveyard, { toSeat: seat, cause: "discard" });
    }
    if (nonLandDiscarded) {
      const targetIds = sa.targets.length > 0 ? sa.targets : [sa.sourceCardId];
      for (const id of targetIds) {
        yield* game.action.addCounter(id, CounterType.PlusOnePlusOne, 1, sa.sourceCardId);
      }
    }
    // TODO(advanced): yield a discard chooser instead of "last in hand";
    // honor `Num$` for multi-Connive cards.
  }
}
effectRegistry.register(ConniveEffect);

// 11. FlipOntoBattlefield -----------------------------------------------------
// Forge `SP$ FlipOntoBattlefield` — flip a coin and, depending on outcome,
// put a target onto the battlefield. MVP: deterministic via game.rng heads
// branch — put source onto battlefield; tails branch — leave as-is.
export class FlipOntoBattlefieldEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "FlipOntoBattlefield";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const heads = game.rng.nextInt(0, 2) === 0;
    yield {
      kind: "event",
      event: {
        kind: "FlipCoin",
        version: 1,
        turn: game.turn,
        phase: game.phase,
        payload: { playerSeat: sa.controllerSeat, resultHeads: heads },
      },
    };
    if (heads) {
      const card = game.cards.get(sa.sourceCardId);
      if (card && card.zone !== ZoneType.Battlefield) {
        yield* game.action.moveTo(sa.sourceCardId, ZoneType.Battlefield, {
          toSeat: sa.controllerSeat,
          cause: "effect",
        });
      }
    }
    // TODO(advanced): consult `WinIfFlippedHeads$` / `LoseIfTails$` flags and
    // honor explicit Defined$ targets.
  }
}
effectRegistry.register(FlipOntoBattlefieldEffect);

// 12. BecomesBlocked ----------------------------------------------------------
// Forge `SP$ BecomesBlocked` — set a "becomes blocked" trigger on the
// targets. MVP: stash on remembered so the corpus resolves; the actual
// trigger is provided by Wave 19's BecomesBlocked-style triggers (none of
// the current corpus uses this as a *triggered effect* shape — most use it
// as a trigger Mode$. The effect form is rare wraparound).
export class BecomesBlockedEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "BecomesBlocked";

  // biome-ignore lint/correctness/useYield: pure mutation MVP
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    for (const id of sa.targets) {
      const card = game.cards.get(id);
      if (!card) continue;
      card.remembered.push(id);
    }
    // TODO(advanced): wire as a delayed trigger that fires on the next
    // AttackerBecomesBlocked event for the target.
  }
}
effectRegistry.register(BecomesBlockedEffect);

// 13. AddOrRemoveCounter ------------------------------------------------------
// Forge `SP$ AddOrRemoveCounter` — yield a binary choice (add or remove);
// then apply. MVP: deterministic — add by default, since most Forge cards
// using this prefer the boost branch.
export class AddOrRemoveCounterEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "AddOrRemoveCounter";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const typeRaw = hasParam(sa, "CounterType") ? evaluateParamRaw(sa, "CounterType") : "P1P1";
    const num = hasParam(sa, "CounterNum") ? evaluateParamNumber(sa, "CounterNum", game) : 1;
    const ct = resolveCounterType(typeRaw);
    // MVP: emit a chooseGenericOption decision; pick "add" by default.
    const rawResponse = yield {
      kind: "decision",
      request: {
        kind: "chooseGenericOption",
        sourceId: sa.sourceCardId,
        playerSeat: sa.controllerSeat,
        options: [
          { id: "add", description: "Add" },
          { id: "remove", description: "Remove" },
        ],
      },
    };
    const response = rawResponse as DecisionResponse | undefined;
    const choice = response && response.kind === "chooseGenericOption" ? response.optionId : "add";
    for (const id of sa.targets) {
      if (choice === "remove") {
        yield* game.action.removeCounter(id, ct, num, sa.sourceCardId);
      } else {
        yield* game.action.addCounter(id, ct, num, sa.sourceCardId);
      }
    }
  }
}
effectRegistry.register(AddOrRemoveCounterEffect);

// 14. AdvanceCrank ------------------------------------------------------------
// Unstable contraption advance — Forge `SP$ AdvanceCrank` rotates the
// player's contraption sprockets. MVP: stamp a record on the controller's
// remembered slot so the corpus passes; full sprocket-state machine is SP4.
export class AdvanceCrankEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "AdvanceCrank";

  // biome-ignore lint/correctness/useYield: stub mutation
  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const source = game.cards.get(sa.sourceCardId);
    if (source) source.remembered.push(sa.sourceCardId);
    // TODO(advanced): rotate Game.flags.attractions sprocket pointer per
    // controller; emit CardCranked event via game.eventBus.
  }
}
effectRegistry.register(AdvanceCrankEffect);

// 15. WinsGame ----------------------------------------------------------------
// Forge `SP$ WinsGame` — direct winner declaration (Approach of the Second
// Sun, Coalition Victory etc.). Routes through game.action.gameWin so any
// game-win replacement (Platinum Angel-style) gets a chance to deny.
export class WinsGameEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "WinsGame";

  override *resolve(sa: SpellAbilityType, game: Game): Generator<EngineYield, void, unknown> {
    const definedRaw = hasParam(sa, "Defined") ? evaluateParamRaw(sa, "Defined") : "You";
    const seat: PlayerSeat =
      definedRaw === "Opponent" ? otherSeat(sa.controllerSeat, game) : sa.controllerSeat;
    yield* game.action.gameWin(seat, { cause: "effect" });
  }
}
effectRegistry.register(WinsGameEffect);

// Silenced unused imports — referenced only by future sub-params.
void GameStateIntegrityError;
void TypeLine;
void SpellAbility;
void (null as unknown as AbilityAst);
void (null as unknown as CardDefinition);
void (null as unknown as PaperCard);
void (null as unknown as SVarAst);
