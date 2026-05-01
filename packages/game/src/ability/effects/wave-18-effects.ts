// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 18 — corpus-unknown effect handlers (20 entries). Each class is an
// MVP — it captures the canonical Forge param subset and produces an
// observable game-state change so the corpus passes semantic validation
// AND the common behavioural case is exercised. Advanced sub-params are
// flagged with TODO comments and deferred to follow-up waves.
//
// Effects covered:
//   ControlSpell, SacrificeAll, MultiplyCounter, MustBlock, Balance,
//   Investigate, Earthbend, Draft, Vote, Phases, ChooseNumber, TapOrUntap,
//   ReverseTurnOrder, RemoveCounterAll, Airbend, TimeTravel,
//   ChooseDirection, Clone, ExchangeControl, RearrangeTopOfLibrary.
import { tokenDatabase } from "@mtg-forge-ts/cards";
import {
  CardType,
  Color,
  ColorSet,
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  GameStateIntegrityError,
  Layer,
  TypeLine,
  ZoneType,
  mkEvent,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import type {
  AbilityAst,
  CardDefinition,
  ContinuousEffect,
  DecisionResponse,
  EntityId,
  PaperCard,
  PlayerSeat,
  SVarAst,
} from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { captureCopiable } from "../../copy/capture.js";
import type { Game } from "../../game.js";
import type { Layer6KeywordGrant } from "../../layers/keyword-layer.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import { SpellAbility } from "../spell-ability.js";

// Helpers ---------------------------------------------------------------------

const opponentSeat = (seat: PlayerSeat): PlayerSeat => {
  const n = seat as unknown as number;
  return mkPlayerSeat(n === 0 ? 1 : 0);
};

/** Classify a battlefield card against a dot-chained Valid filter (MVP subset). */
const cardMatchesValid = (
  game: Game,
  cardId: EntityId,
  filter: string,
  controllerSeat: PlayerSeat,
): boolean => {
  const card = game.cards.get(cardId);
  if (!card) return false;
  if (card.zone !== ZoneType.Battlefield) return false;
  const tokens = filter.split(/[.+]/).map((t) => t.trim());
  const base = tokens[0] ?? "Card";
  const chars = game.layerEngine.computeCharacteristics(cardId);
  switch (base) {
    case "Card":
    case "Permanent":
      break;
    case "Creature":
      if (!chars.types.has(CardType.Creature)) return false;
      break;
    case "Artifact":
      if (!chars.types.has(CardType.Artifact)) return false;
      break;
    case "Enchantment":
      if (!chars.types.has(CardType.Enchantment)) return false;
      break;
    case "Land":
      if (!chars.types.has(CardType.Land)) return false;
      break;
    case "Planeswalker":
      if (!chars.types.has(CardType.Planeswalker)) return false;
      break;
    default:
      // Unrecognised base — accept as pass-through (subtypes etc. are SP4).
      break;
  }
  for (let i = 1; i < tokens.length; i++) {
    const q = tokens[i] ?? "";
    if (q === "YouCtrl") {
      if (card.controllerSeat !== controllerSeat) return false;
    } else if (q === "OppCtrl" || q === "OpponentCtrl") {
      if (card.controllerSeat === controllerSeat) return false;
    } else if (q === "tapped") {
      if (!card.tapped) return false;
    } else if (q === "untapped") {
      if (card.tapped) return false;
    } else if (q === "Self") {
      // No-op here; Self is handled by ValidTgts$ at cast time.
    }
    // Other qualifiers (color/subtype) are pass-through MVP — see Wave 14b
    // cardMatchesIsPresent for the full grammar; this slimmer matcher
    // intentionally errs on the side of inclusion to avoid under-firing
    // board-wide effects for the rare param shapes.
  }
  return true;
};

const collectMatching = (sa: SpellAbility, game: Game, paramKey: string, fallback: string): EntityId[] => {
  const filter = hasParam(sa, paramKey) ? evaluateParamRaw(sa, paramKey) : fallback;
  const out: EntityId[] = [];
  for (const id of game.cards.keys()) {
    if (cardMatchesValid(game, id, filter, sa.controllerSeat)) out.push(id);
  }
  return out;
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

// 1. ControlSpell -------------------------------------------------------------
// Forge `SP$ ControlSpell` — gain control of a spell on the stack (Word of
// Seizing, Commandeer, Bend or Break-style theft). Targets are stack items.
export class ControlSpellEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ControlSpell";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const items = game.sharedZones.stack.toArray();
    yield* []; // satisfy generator constraint
    for (const targetId of sa.targets) {
      const stackItem = items.find((it: { id: EntityId }) => it.id === targetId);
      if (!stackItem) continue;
      // controllerSeat is declared readonly on StackItem to discourage
      // ad-hoc rewrites. ControlSpell is the legitimate exception (CR
      // 800.4-style control change of a spell). Cast and mutate.
      const mutable = stackItem as unknown as { controllerSeat: PlayerSeat };
      mutable.controllerSeat = sa.controllerSeat;
    }
  }
}
effectRegistry.register(ControlSpellEffect);

// 2. SacrificeAll -------------------------------------------------------------
// Forge `SP$ SacrificeAll` — each affected player sacrifices all permanents
// matching the filter. ValidCards$ + Defined$ Player-class. Used by Wrath of
// Marit Lage-style mass sacrifice.
export class SacrificeAllEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "SacrificeAll";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const ids = collectMatching(sa, game, "ValidCards", "Permanent.YouCtrl");
    for (const id of ids) {
      const card = game.cards.get(id);
      if (!card) continue;
      yield* game.action.moveTo(id, ZoneType.Graveyard, {
        toSeat: card.ownerSeat,
        cause: "sacrifice",
      });
    }
  }
}
effectRegistry.register(SacrificeAllEffect);

// 3. MultiplyCounter ----------------------------------------------------------
// Forge `SP$ MultiplyCounter` — multiply the count of a counter type on the
// target by N (Doubling Season-as-effect; Branching Evolution-style spells).
export class MultiplyCounterEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "MultiplyCounter";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const typeRaw = hasParam(sa, "CounterType") ? evaluateParamRaw(sa, "CounterType") : "P1P1";
    const factor = hasParam(sa, "Multiplier") ? evaluateParamNumber(sa, "Multiplier", game) : 2;
    const ct = resolveCounterType(typeRaw);
    for (const id of sa.targets) {
      const card = game.cards.get(id);
      if (!card) continue;
      const cur = card.counters.get(ct) ?? 0;
      if (cur === 0) continue;
      const additional = cur * (factor - 1);
      if (additional > 0) {
        yield* game.action.addCounter(id, ct, additional, sa.sourceCardId);
      }
    }
  }
}
effectRegistry.register(MultiplyCounterEffect);

// 4. MustBlock ----------------------------------------------------------------
// Forge `SP$ MustBlock` — set a "must block" flag on a creature targeting
// another creature (Lure-style attacker compulsion).
export class MustBlockEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "MustBlock";

  // biome-ignore lint/correctness/useYield: pure flag mutation
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    if (sa.targets.length < 2) {
      // Single target: blocker, target attacker is sa.sourceCardId.
      const blockerId = sa.targets[0];
      if (blockerId === undefined) return;
      const blocker = game.cards.get(blockerId);
      if (blocker) blocker.mustBlockTargetId = sa.sourceCardId;
      return;
    }
    // Two-target form: targets[0] blocks targets[1].
    const blockerId = sa.targets[0];
    const attackerId = sa.targets[1];
    if (blockerId === undefined || attackerId === undefined) return;
    const blocker = game.cards.get(blockerId);
    if (blocker) blocker.mustBlockTargetId = attackerId;
  }
}
effectRegistry.register(MustBlockEffect);

// 5. Balance ------------------------------------------------------------------
// Forge `SP$ Balance` — each player reduces hand and battlefield to the
// minimum count among players. Classic Balance card.
export class BalanceEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Balance";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const seats: PlayerSeat[] = [];
    for (const p of game.players) seats.push(p.seat);

    // Lands.
    const landsBySeat = new Map<PlayerSeat, EntityId[]>();
    for (const seat of seats) landsBySeat.set(seat, []);
    for (const [id, card] of game.cards) {
      if (card.zone !== ZoneType.Battlefield) continue;
      const chars = game.layerEngine.computeCharacteristics(id);
      if (!chars.types.has(CardType.Land)) continue;
      landsBySeat.get(card.controllerSeat)?.push(id);
    }
    let minLands = Number.POSITIVE_INFINITY;
    for (const arr of landsBySeat.values()) minLands = Math.min(minLands, arr.length);
    if (!Number.isFinite(minLands)) minLands = 0;
    for (const seat of seats) {
      const arr = landsBySeat.get(seat) ?? [];
      // Sacrifice in stable order — controller's own arrival order; AI
      // selection deferred (TODO).
      for (let i = arr.length - 1; i >= minLands; i--) {
        const id = arr[i];
        if (id === undefined) continue;
        const card = game.cards.get(id);
        if (!card) continue;
        yield* game.action.moveTo(id, ZoneType.Graveyard, {
          toSeat: card.ownerSeat,
          cause: "sacrifice",
        });
      }
    }

    // Creatures.
    const creaturesBySeat = new Map<PlayerSeat, EntityId[]>();
    for (const seat of seats) creaturesBySeat.set(seat, []);
    for (const [id, card] of game.cards) {
      if (card.zone !== ZoneType.Battlefield) continue;
      const chars = game.layerEngine.computeCharacteristics(id);
      if (!chars.types.has(CardType.Creature)) continue;
      creaturesBySeat.get(card.controllerSeat)?.push(id);
    }
    let minCreatures = Number.POSITIVE_INFINITY;
    for (const arr of creaturesBySeat.values()) minCreatures = Math.min(minCreatures, arr.length);
    if (!Number.isFinite(minCreatures)) minCreatures = 0;
    for (const seat of seats) {
      const arr = creaturesBySeat.get(seat) ?? [];
      for (let i = arr.length - 1; i >= minCreatures; i--) {
        const id = arr[i];
        if (id === undefined) continue;
        const card = game.cards.get(id);
        if (!card) continue;
        yield* game.action.moveTo(id, ZoneType.Graveyard, {
          toSeat: card.ownerSeat,
          cause: "sacrifice",
        });
      }
    }

    // Hands. Discard down to the minimum hand size.
    let minHand = Number.POSITIVE_INFINITY;
    for (const seat of seats) {
      const player = game.getPlayer(seat);
      const hand = player.zones.get(ZoneType.Hand);
      const size = hand ? hand.size : 0;
      if (size < minHand) minHand = size;
    }
    if (!Number.isFinite(minHand)) minHand = 0;
    for (const seat of seats) {
      const player = game.getPlayer(seat);
      const hand = player.zones.get(ZoneType.Hand);
      if (!hand) continue;
      const ids = hand.toArray();
      for (let i = ids.length - 1; i >= minHand; i--) {
        const id = ids[i];
        if (id === undefined) continue;
        yield* game.action.moveTo(id, ZoneType.Graveyard, {
          toSeat: seat,
          cause: "discard",
        });
      }
    }
    // TODO(advanced): Forge supports per-zone restrictions (HandZone$ False);
    // this MVP balances lands+creatures+hand, the canonical Balance form.
    void sa;
  }
}
effectRegistry.register(BalanceEffect);

// 6. Investigate --------------------------------------------------------------
// Forge `SP$ Investigate` — create N Clue tokens. Sugar over `SP$ Token` with
// a fixed TokenScript. Uses the predefined token database entry "c_a_clue".
export class InvestigateEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Investigate";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "Num") ? evaluateParamNumber(sa, "Num", game) : 1;
    // Wave 16b — switched to canonical token-database id `c_a_clue_draw`. The
    // legacy lookup `c_a_clue` returned undefined and silently routed through
    // the fallback branch (which builds a Clue token with TypeLine "Token …",
    // an invalid type token). With the correct id the canonical Clue entry is
    // used and the fallback only fires when the database is unavailable.
    const entry = tokenDatabase.get("c_a_clue_draw");
    if (!entry) {
      // Fallback synth — the real token DB should always have this entry,
      // but if it is missing for any reason, build a minimal Clue PaperCard
      // inline so corpus cards still resolve.
      const definition: CardDefinition = {
        name: "Clue",
        oracle: "{2}, Sacrifice this artifact: Draw a card.",
        types: TypeLine.parse("Token Artifact — Clue"),
        manaCost: null,
        colors: ColorSet.empty(),
        abilities: [],
        triggers: [],
        replacements: [],
        statics: [],
        keywords: [],
        svars: new Map(),
      };
      const paperCard: PaperCard = {
        name: "Clue",
        edition: "TOK",
        collectorNumber: "0",
        language: "en",
        foil: false,
        flags: DEFAULT_PAPER_CARD_FLAGS,
        definition,
      };
      const fallbackIds = yield* game.action.createToken({
        paperCard,
        controller: sa.controllerSeat,
        count: num,
      });
      // Wave 16b — CardInvestigated (CR 701.30) — fires once per Clue token
      // minted via Investigate. Triggers (Wave 21 InvestigateTrigger) listen.
      for (const clueId of fallbackIds) {
        yield game.emitEvent(
          mkEvent("CardInvestigated", game.turn, game.phase, {
            playerSeat: sa.controllerSeat,
            clueTokenId: clueId,
          }),
        );
      }
      return;
    }
    const definition: CardDefinition = {
      name: entry.name,
      oracle: entry.oracle,
      types: entry.types,
      manaCost: entry.manaCost,
      ...(entry.pt !== undefined ? { pt: entry.pt } : {}),
      colors: entry.colors,
      abilities: entry.abilities,
      triggers: [],
      replacements: [],
      statics: [],
      keywords: entry.keywords,
      svars: new Map(),
    };
    const paperCard: PaperCard = {
      name: entry.name,
      edition: "TOK",
      collectorNumber: "0",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition,
    };
    const clueIds = yield* game.action.createToken({
      paperCard,
      controller: sa.controllerSeat,
      count: num,
    });
    // Wave 16b — CardInvestigated emit (post-token-create) so Investigate
    // triggers fire once per Clue minted.
    for (const clueId of clueIds) {
      yield game.emitEvent(
        mkEvent("CardInvestigated", game.turn, game.phase, {
          playerSeat: sa.controllerSeat,
          clueTokenId: clueId,
        }),
      );
    }
  }
}
effectRegistry.register(InvestigateEffect);

// 7. Earthbend ----------------------------------------------------------------
// Lorwyn-block "Bend" mechanics. Per Forge: `DB$ Earthbend` adds a +1/+1
// counter to a creature card. The full mechanic is mana-cost-scaled; the MVP
// applies a single +1/+1 counter to the target.
export class EarthbendEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Earthbend";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    // Wave 90 — X-scaling. Forge's Earthbend reads X from the source's
    // chosenX (`X$ Count$xPaid`) when CounterNum is omitted or set to "X".
    // Resolution order:
    //   1. CounterNum$ literal numeric (or non-X string) — direct value.
    //   2. CounterNum$ X / no CounterNum — fall back to source.chosenX, else 1.
    let num = 1;
    if (hasParam(sa, "CounterNum")) {
      const raw = evaluateParamRaw(sa, "CounterNum").trim();
      if (raw === "X" || raw === "x") {
        const source = game.cards.get(sa.sourceCardId);
        const chosenX = (source as { chosenX?: number } | undefined)?.chosenX;
        num = typeof chosenX === "number" && chosenX >= 0 ? chosenX : 0;
      } else {
        num = evaluateParamNumber(sa, "CounterNum", game);
      }
    } else {
      const source = game.cards.get(sa.sourceCardId);
      const chosenX = (source as { chosenX?: number } | undefined)?.chosenX;
      num = typeof chosenX === "number" && chosenX >= 0 ? chosenX : 1;
    }
    if (num <= 0) return;
    for (const id of sa.targets) {
      yield* game.action.addCounter(id, CounterType.PlusOnePlusOne, num, sa.sourceCardId);
    }
  }
}
effectRegistry.register(EarthbendEffect);

// 8. Airbend ------------------------------------------------------------------
// Companion to Earthbend — Forge's `DB$ Airbend` taps target creatures or
// grants +1/+0 + flying until end of turn (varies by card).
//
// Wave 85 — alongside the canonical tap (the "lift" subset of Airbend
// cards), grant Flying as a Layer 6 kw-grant on each target with an
// untilEndOfTurn duration. Mirrors the AddKeywords$ pipeline used by
// CopyPermanentEffect (single-target shape). The grant is recorded
// against the source ability id so observers can correlate the lift
// to its origin. The keyword exits on TurnEnded via the registry's
// duration evaluator (no manual cleanup hook needed — the Layer 6
// store evicts the grant when its duration expires).
export class AirbendEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Airbend";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    for (const id of sa.targets) {
      const card = game.cards.get(id);
      if (!card) continue;
      if (!card.tapped) {
        yield* game.action.tap(id);
      }
      // Grant Flying until end of turn via Layer 6 kw-grant.
      const ts = game.newEntityId();
      const grant: Layer6KeywordGrant = {
        keyword: "Flying",
        sourceAbilityId: sa.sourceCardId,
        timestamp: ts,
        targetCardIdFn: () => id,
      };
      const ce: ContinuousEffect = {
        id: game.newEntityId(),
        sourceCardId: sa.sourceCardId,
        timestamp: ts,
        layer: Layer.L6_Ability,
        duration: { kind: "untilEndOfTurn" },
        payload: { kind: "kw-grant", effect: grant },
      };
      game.continuousEffectRegistry.register(ce);
    }
  }
}
effectRegistry.register(AirbendEffect);

// 9. Draft --------------------------------------------------------------------
// Forge `SP$ Draft` — Conspiracy-block "draft" mechanic. Rare. Stub.
export class DraftEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Draft";

  // biome-ignore lint/correctness/useYield: rare mechanic, MVP records intent
  override *resolve(sa: SpellAbility, _game: Game): Generator<EngineYield, void, unknown> {
    // Conspiracy-block draft is a pre-game ritual. At runtime we record the
    // request on the source card's `remembered` for downstream introspection.
    const source = _game.cards.get(sa.sourceCardId);
    if (source) source.remembered.push(sa.sourceCardId);
    // TODO(advanced): full draft pick + pile assignment requires a full
    // draft-mode runtime which is out of scope for the in-game DSL.
  }
}
effectRegistry.register(DraftEffect);

// 10. Vote --------------------------------------------------------------------
// Forge `SP$ Vote` — Council's Dilemma / will of the council voting. Each
// living player votes for one named option; majority wins.
export class VoteEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Vote";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const choicesRaw = hasParam(sa, "Choices") ? evaluateParamRaw(sa, "Choices") : "Yes,No";
    const choices = choicesRaw
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (choices.length === 0) return;

    const tally = new Map<string, number>();
    for (const c of choices) tally.set(c, 0);

    for (const player of game.players) {
      const seat = player.seat;
      const rawResponse = yield {
        kind: "decision",
        request: {
          kind: "vote",
          sourceId: sa.sourceCardId,
          voterSeat: seat,
          choices: choices.map((c) => ({ id: c, label: c, description: c })),
        },
      };
      const response = rawResponse as DecisionResponse | undefined;
      if (response && response.kind === "vote") {
        // The decision response carries `voteId` (the chosen choice id).
        // Forge tracks per-voter weight (Coercive Recruiter etc.) — defer.
        const voteId = response.voteId;
        if (voteId && tally.has(voteId)) tally.set(voteId, (tally.get(voteId) ?? 0) + 1);
      } else {
        // No response — default to first option (deterministic AI default).
        const fallback = choices[0];
        if (fallback) tally.set(fallback, (tally.get(fallback) ?? 0) + 1);
      }
    }

    // Pick the winning choice (ties broken by first-listed).
    let winner = choices[0] ?? "";
    let max = -1;
    for (const c of choices) {
      const v = tally.get(c) ?? 0;
      if (v > max) {
        max = v;
        winner = c;
      }
    }

    // Wave 90 — per-choice SubAbility$ branching. CouncilsDilemma cards
    // ride a `<ChoiceName>SubAbility$ DBFoo` style param convention OR
    // a Choices$-aligned positional sub-SVar list (`SubAbilities$ DB1,DB2`).
    // The handler now dispatches the SVar named for the winning choice.
    // Resolution order:
    //   1. `<winner>SubAbility$ <SVarKey>` — explicit per-choice mapping.
    //   2. `SubAbilities$ <key1>,<key2>,…` — positional list aligned with
    //      `Choices$` order; the winner's index picks the matching key.
    //   3. SVar lookup: `<winner>` directly when the choice id is itself
    //      an SVar key (the most compact convention).
    // On a hit the named ability runs as a sub-SA on the source; on a
    // miss the winner is stamped on `source.chosenVote` so downstream
    // SVars / triggers still observe the result.
    const source = game.cards.get(sa.sourceCardId);
    (source as unknown as { chosenVote?: string }).chosenVote = winner;

    let svarKey: string | undefined;
    const perChoiceParam = `${winner}SubAbility`;
    if (hasParam(sa, perChoiceParam)) {
      svarKey = evaluateParamRaw(sa, perChoiceParam).trim();
    } else if (hasParam(sa, "SubAbilities")) {
      const list = evaluateParamRaw(sa, "SubAbilities")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const idx = choices.indexOf(winner);
      if (idx >= 0 && idx < list.length) {
        svarKey = list[idx];
      }
    }
    if (svarKey === undefined) {
      // Final fallback: the winner is itself an SVar key.
      svarKey = winner;
    }
    if (!source) return;
    const def = source.paperCard.definition;
    const svars = (def?.svars ?? new Map()) as ReadonlyMap<string, SVarAst>;
    const sv = svars.get(svarKey);
    if (!sv || sv.kind !== "ability" || !sv.ability) return;
    const fakeAst: AbilityAst = { kind: "spell", effect: sv.ability, cost: { raw: "" } };
    const sub = new SpellAbility(fakeAst, sa.sourceCardId, sa.controllerSeat, svars, sa.targets);
    yield* sub.makeResolver().resolve(game) as Generator<EngineYield, void, unknown>;
  }
}
effectRegistry.register(VoteEffect);

// 11. Phases ------------------------------------------------------------------
// Forge `SP$ Phases` — make a card phase out (or in). Toggles
// card.phasedOut; combat / target enumeration / SBA destroy collectors all
// honour this slot via the unified isPhasedOut helper (Wave 54).
//
// Cards: Teferi's Veil, Tawnos's Coffin, Vanishing (Sylvan Safekeeper),
// Reality Ripple, Time and Tide. ~25 cards in the corpus.
export class PhasesEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Phases";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    for (const id of sa.targets) {
      const card = game.cards.get(id);
      if (!card) continue;
      const wasOut = card.phasedOut === true || card.phased === true;
      // Toggle: phased-in cards phase out, phased-out cards (via either flag)
      // phase in. Reset both flags on phase-in to keep the two flag streams
      // aligned (the keyword Phasing untap-step processor sets card.phased;
      // direct effects set card.phasedOut — phase-in clears whichever was
      // set).
      if (wasOut) {
        card.phasedOut = false;
        card.phased = false;
      } else {
        card.phasedOut = true;
      }
      game.layerEngine.bumpEpoch("phases-effect");
      yield game.emitEvent({
        kind: wasOut ? "PhasedIn" : "PhasedOut",
        version: 1,
        turn: game.turn,
        phase: game.phase,
        payload: { cardId: id, direct: true },
      });
    }
  }
}
effectRegistry.register(PhasesEffect);

// 12. ChooseNumber ------------------------------------------------------------
// Forge `SP$ ChooseNumber` — yield a chooseNumber decision; store the
// response on source.chosenNumber.
export class ChooseNumberEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ChooseNumber";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const min = hasParam(sa, "Min") ? evaluateParamNumber(sa, "Min", game) : 0;
    const max = hasParam(sa, "Max") ? evaluateParamNumber(sa, "Max", game) : 100;
    const rawResponse = yield {
      kind: "decision",
      request: {
        kind: "chooseNumber",
        sourceId: sa.sourceCardId,
        min,
        max,
      },
    };
    const response = rawResponse as DecisionResponse | undefined;
    const chosen = response && response.kind === "chooseNumber" ? response.chosen : min;
    const source = game.cards.get(sa.sourceCardId);
    if (source) source.chosenNumber = chosen;
  }
}
effectRegistry.register(ChooseNumberEffect);

// 13. TapOrUntap --------------------------------------------------------------
// Forge `SP$ TapOrUntap` — yield a binary choice; tap or untap each target.
//
// Wave 82 — yields a typed `confirmAction` decision (Wave 56 schema). The
// prompt is `"Tap?"`; `confirmed = true` taps the target (and is a no-op
// if already tapped), `confirmed = false` untaps (no-op if already
// untapped). The independent per-target decision matches Forge's behavior
// (each target prompts independently). When the controller doesn't
// answer (drain-without-driver path) we fall back to the toggle — tap if
// untapped, untap if tapped — mirroring the prior MVP for back-compat
// with tests that don't yet thread a controller.
export class TapOrUntapEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "TapOrUntap";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    for (const id of sa.targets) {
      const card = game.cards.get(id);
      if (!card) continue;
      const rawResponse = yield {
        kind: "decision",
        request: {
          kind: "confirmAction",
          sourceId: sa.sourceCardId,
          prompt: "Tap?",
        },
      };
      const response = rawResponse as DecisionResponse | undefined;
      let shouldTap: boolean;
      if (response && response.kind === "confirmAction") {
        shouldTap = response.confirmed === true;
      } else {
        // Toggle fallback — preserves the prior MVP behavior.
        shouldTap = !card.tapped;
      }
      if (shouldTap) {
        if (!card.tapped) yield* game.action.tap(id);
      } else {
        if (card.tapped) yield* game.action.untap(id);
      }
    }
  }
}
effectRegistry.register(TapOrUntapEffect);

// 14. ReverseTurnOrder --------------------------------------------------------
// Forge `SP$ ReverseTurnOrder` — flip the turn order direction. Rare (Time
// Stop family). Toggles game.flags.turnOrder.
export class ReverseTurnOrderEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ReverseTurnOrder";

  // biome-ignore lint/correctness/useYield: pure flag mutation
  override *resolve(_sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    game.flags.turnOrder = game.flags.turnOrder === "forward" ? "reverse" : "forward";
  }
}
effectRegistry.register(ReverseTurnOrderEffect);

// 15. RemoveCounterAll --------------------------------------------------------
// Forge `SP$ RemoveCounterAll` — remove counters from all matching cards.
export class RemoveCounterAllEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "RemoveCounterAll";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const typeRaw = hasParam(sa, "CounterType") ? evaluateParamRaw(sa, "CounterType") : "P1P1";
    const ct = resolveCounterType(typeRaw);
    const num = hasParam(sa, "CounterNum") ? evaluateParamNumber(sa, "CounterNum", game) : 1;
    const ids = collectMatching(sa, game, "ValidCards", "Permanent");
    for (const id of ids) {
      const card = game.cards.get(id);
      if (!card) continue;
      const cur = card.counters.get(ct) ?? 0;
      if (cur <= 0) continue;
      const remove = num === -1 ? cur : Math.min(num, cur);
      yield* game.action.removeCounter(id, ct, remove, sa.sourceCardId);
    }
  }
}
effectRegistry.register(RemoveCounterAllEffect);

// 16. TimeTravel --------------------------------------------------------------
// Doctor Who-block — adjust time counters on suspended cards. Forge:
// `DB$ TimeTravel | Defined$ Suspended` etc. MVP: subtract 1 time counter
// from each suspended card the controller controls.
export class TimeTravelEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "TimeTravel";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "Num") ? evaluateParamNumber(sa, "Num", game) : 1;
    for (const [id, card] of game.cards) {
      if (card.zone !== ZoneType.Exile) continue;
      const time = card.counters.get(CounterType.Time) ?? 0;
      if (time <= 0) continue;
      // Default direction: remove counters (advance time forward).
      const remove = Math.min(num, time);
      if (remove > 0) {
        yield* game.action.removeCounter(id, CounterType.Time, remove, sa.sourceCardId);
      }
    }
  }
}
effectRegistry.register(TimeTravelEffect);

// 17. ChooseDirection ---------------------------------------------------------
// Forge `SP$ ChooseDirection` — Choose left or right (multiplayer-relevant).
// Stores on source.chosenDirection.
//
// Wave 82 — yields a typed `chooseDirection` decision (Wave 56 schema —
// player-decisions.ts:560). The chosen direction is normalized to
// "Left" / "Right" (the schema admits lowercase; Card.chosenDirection
// stores capitalized form for back-compat with Wave 18's earlier
// readers). On missing / wrong-shape response we fall back to "Left"
// deterministically — same behavior as the prior MVP.
export class ChooseDirectionEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ChooseDirection";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const source = game.cards.get(sa.sourceCardId);
    if (!source) return;
    const rawResponse = yield {
      kind: "decision",
      request: {
        kind: "chooseDirection",
        playerSeat: sa.controllerSeat,
        sourceId: sa.sourceCardId,
      },
    };
    const response = rawResponse as DecisionResponse | undefined;
    let direction: "Left" | "Right" = "Left";
    if (response && response.kind === "chooseDirection") {
      direction = response.direction === "right" ? "Right" : "Left";
    }
    source.chosenDirection = direction;
  }
}
effectRegistry.register(ChooseDirectionEffect);

// 18. Clone -------------------------------------------------------------------
// Forge `SP$ Clone` — copy the characteristics of one card onto another.
// Distinct from CopyPermanent (which mints a token copy). Clone proper
// rebases the source's copiable characteristics onto an existing card —
// canonically used by Phantasmal Image, Clone, Phyrexian Metamorph,
// Renegade Doppelganger, Quasiduplicate, etc. (~50 cards).
//
// Wave 54 — wires the missing Layer 1 link: capture the target's copiable
// snapshot via captureCopiable (CR 707.2) and stamp it on
// sourceCard.copiedFrom. The layer engine's deriveBaseCharacteristics
// already invokes applyLayer1Copy(chars, card.copiedFrom) on every walk,
// so the Clone enters the battlefield with the target's name, P/T, types,
// abilities, etc.
//
// TODO(advanced) sub-variants:
//   - Phantasmal Image: also register a "when targeted, sacrifice"
//     replacement-trigger pair on sourceCard.
//   - Phyrexian Metamorph: also stamp a Layer 4 "is also an artifact"
//     continuous effect via the Layer 4 type-add machinery.
//   - Sakashima of a Thousand Faces: legend-rule waiver flag on the copy.
// All three sub-variants are decoded from explicit script params on the
// caller (AddTypes$ / Triggers$) and don't ride this effect.
export class CloneEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Clone";

  // biome-ignore lint/correctness/useYield: pure characteristic snapshot
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    if (sa.targets.length === 0) return;
    const sourceCard = game.cards.get(sa.sourceCardId);
    if (!sourceCard) return;
    const targetId = sa.targets[0];
    if (targetId === undefined) return;
    const targetCard = game.cards.get(targetId);
    if (!targetCard) return;
    // CR 707.2 — capture the target's current (post-layer) copiable
    // characteristics. Use captureCopiable so layered transforms (Day/Night
    // flip, face-down, prior copies) on the target carry through.
    sourceCard.copiedFrom = captureCopiable(targetId, game);
    sourceCard.remembered.push(targetId);
    game.layerEngine.bumpEpoch("clone");
  }
}
effectRegistry.register(CloneEffect);

// 19. ExchangeControl ---------------------------------------------------------
// Forge `SP$ ExchangeControl` — swap controllers of two permanents (Switcheroo,
// Rionya etc.).
export class ExchangeControlEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ExchangeControl";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    if (sa.targets.length < 2) return;
    const idA = sa.targets[0];
    const idB = sa.targets[1];
    if (idA === undefined || idB === undefined) return;
    const a = game.cards.get(idA);
    const b = game.cards.get(idB);
    if (!a || !b) return;
    const seatA = a.controllerSeat;
    const seatB = b.controllerSeat;
    if (seatA === seatB) return;
    yield* game.action.changeControl(idA, seatB, { sourceId: sa.sourceCardId });
    yield* game.action.changeControl(idB, seatA, { sourceId: sa.sourceCardId });
  }
}
effectRegistry.register(ExchangeControlEffect);

// 20. RearrangeTopOfLibrary ---------------------------------------------------
// Forge `SP$ RearrangeTopOfLibrary` — yield an order decision, reorder the
// top N library cards. Used by Brainstorm-shuffle, Telepathic Spies, etc.
//
// Wave 86 — yield the canonical orderCards decision so the controller
// actually picks a permutation. Mirrors ReorderZoneEffect's validation
// (length match + bijection over the input multiset). On invalid responses
// we fall back to the original prefix order AND stamp a structured warning
// on game.decisionWarnings; on missing responses (test-mode draining a
// generator without a controller) the legacy identity-reorder MVP behavior
// is preserved (the prefix lands at the top in its original order, which
// is a no-op).
export class RearrangeTopOfLibraryEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "RearrangeTopOfLibrary";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "NumCards") ? evaluateParamNumber(sa, "NumCards", game) : 3;
    const seat = sa.controllerSeat;
    const player = game.getPlayer(seat);
    const lib = player.zones.get(ZoneType.Library);
    if (!lib) throw new GameStateIntegrityError("RearrangeTopOfLibrary: no Library zone");
    const allIds = lib.toArray();
    const prefix = allIds.slice(0, Math.max(0, Math.min(num, allIds.length)));
    if (prefix.length === 0) return;

    const rawResponse = yield {
      kind: "decision",
      request: {
        kind: "orderCards",
        playerSeat: seat,
        sourceId: sa.sourceCardId,
        cards: prefix,
      },
    };
    const response = rawResponse as DecisionResponse | undefined;
    let ordered: readonly EntityId[] = prefix;
    if (response && response.kind === "orderCards") {
      const candidate = response.ordered;
      let ok = candidate.length === prefix.length;
      if (ok) {
        const expected = new Set(prefix);
        const seen = new Set<EntityId>();
        for (const id of candidate) {
          if (!expected.has(id) || seen.has(id)) {
            ok = false;
            break;
          }
          seen.add(id);
        }
      }
      if (ok) {
        ordered = candidate.slice();
      } else {
        game.decisionWarnings.push({
          kind: "orderCards-invalid-permutation",
          sourceId: sa.sourceCardId,
          detail: `RearrangeTopOfLibrary: response of length ${candidate.length} not a bijection over ${prefix.length}-card prefix`,
        });
      }
    }

    // If ordered === prefix (identity, no decision response), skip the
    // remove/re-add round-trip — pure no-op preserves earlier MVP semantics.
    let identical = true;
    for (let i = 0; i < prefix.length; i++) {
      if (prefix[i] !== ordered[i]) {
        identical = false;
        break;
      }
    }
    if (identical) return;

    // Apply: remove each card in the prefix, then re-add at the top in
    // REVERSE order so ordered[0] ends up at index 0 (top).
    for (const id of prefix) lib.remove(id);
    for (let i = ordered.length - 1; i >= 0; i--) {
      const id = ordered[i];
      if (id !== undefined) lib.addToTop(id);
    }
  }
}
effectRegistry.register(RearrangeTopOfLibraryEffect);

// Re-export silenced helpers to satisfy linting; the module is import-for-
// side-effect from the barrel index.
void Color;
void opponentSeat;
