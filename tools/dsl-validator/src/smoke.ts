// SPDX-License-Identifier: GPL-3.0-or-later
// Corpus smoke harness — Milestone 1 of TESTING_STRATEGY.md.
//
// Goal: for every parsed CardDefinition in the corpus, build a minimal Game,
// place the card in a zone appropriate to its type, exercise its abilities/
// triggers/replacements/keywords/statics activation, and (for permanents)
// drive an ETB transition through the canonical moveTo pipeline. We only
// assert "no thrown error" — the success metric is "the engine survives
// every real card text we have".
//
// What this is NOT:
//   - A full cast simulator (no cost / target / mode resolution).
//   - A behavioural test (we don't assert outcomes — just no crashes).
//   - A parity test against Forge's Java engine (that's Milestone 3+).
//
// What this IS:
//   - The cheapest possible end-to-end signal that our 100% registration
//     claim is actually exercised at runtime, not just at registration time.
//   - A way to surface real gaps (handler crashes, parser→runtime mismatches,
//     missing zone-activation handling) by class.
//
// MVP cast strategy by core type:
//   - Permanent (Creature, Artifact, Enchantment, Land, Planeswalker, Battle):
//     seed in hand, then game.action.moveTo(Battlefield) to ETB. This drives
//     the canonical moveTo pipeline (replacement loop, onZoneChange, layer-
//     epoch bump, trigger fan-out) end-to-end.
//   - Instant / Sorcery: seed in hand, activate abilities-from-definition.
//     A real "cast" would need cost & target resolution which the smoke
//     harness intentionally skips.
//   - Other (Plane, Phenomenon, Scheme, Vanguard, Conspiracy, Dungeon,
//     Kindred-only): seed in hand only, exercise activation. These types
//     do not enter the battlefield via the normal cast flow.
//
// Decision-yield handling: moveTo CAN yield decisions in unusual cases
// (e.g. CR 121.1 protector-seat choice for cards entering specific zones).
// The smoke harness aborts the card with `unexpected-decision` classification
// rather than synthesising a response — surfacing those cards as an
// MVP-scope limitation rather than masking them as crashes.
//
// Error classification heuristics (errorClass field on FailureRecord):
//   - "unhandled-decision"        : a moveTo yielded a decision we won't fulfil.
//   - "missing-handler"           : message mentions "no handler" / "unknown" / "lookup".
//   - "missing-card"              : message mentions "card not found" / "missing card".
//   - "integrity"                 : GameStateIntegrityError thrown.
//   - "illegal-decision"          : IllegalDecisionError thrown.
//   - "type-error"                : TypeError thrown (e.g. ".x is not a function").
//   - "range-error"               : RangeError thrown.
//   - "other"                     : everything else.

import type { CardDefinition, EntityId, LobbyPlayer, PlayerSeat } from "@mtg-forge-ts/core";
import { CardType, DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkPlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield, GameMeta, GameRules } from "@mtg-forge-ts/game";
import { Battlefield, Card, Game, GameAction, Graveyard, Hand, Library } from "@mtg-forge-ts/game";

// ── Public API ───────────────────────────────────────────────────────────────

export type SmokeErrorClass =
  | "unhandled-decision"
  | "missing-handler"
  | "missing-card"
  | "integrity"
  | "illegal-decision"
  | "type-error"
  | "range-error"
  | "other";

export interface SmokeResult {
  readonly ok: boolean;
  /** Why the card failed (only set when ok=false). */
  readonly errorClass?: SmokeErrorClass;
  /** Truncated error message (only set when ok=false). */
  readonly error?: string;
  /**
   * Cast strategy actually used. Useful for triaging — e.g. a flood of
   * permanent-ETB failures vs spell-activate failures suggests very
   * different root causes.
   */
  readonly strategy: "permanent-etb" | "spell-activate" | "other-activate";
}

/**
 * Run the smoke harness on a single parsed CardDefinition. Returns a
 * structured result: ok=true if no error was thrown, ok=false with an
 * `errorClass` and truncated message otherwise.
 *
 * Constructing a fresh Game per card is acceptable in MVP because each
 * Game weighs only a handful of registries + two empty Players. The
 * 32k-card corpus runs in O(seconds) on commodity hardware.
 */
export const runSmoke = (def: CardDefinition): SmokeResult => {
  // Decide-strategy must run inside the try so that a broken
  // CardDefinition (e.g. a parser regression that produces a getter that
  // throws) classifies as a failure rather than aborting the harness.
  let strategy: SmokeResult["strategy"] = "other-activate";
  try {
    strategy = decideStrategy(def);
    const fixture = makeFixture();
    const card = mintCard(fixture, def);

    // Activation order mirrors the engine's first-time-on-card sequencing:
    // abilities → triggers → replacements → keywords → statics. Each is
    // idempotent and the registries silently skip any unhandled mode/key,
    // so the order matters only for failure surface (we want the most
    // common path to fail first if it's going to fail).
    card.activateAbilitiesFromDefinition();
    card.activateTriggersFromDefinition(fixture.game);
    card.activateReplacementsFromDefinition(fixture.game);
    card.activateKeywordsFromDefinition(fixture.game);
    card.activateStaticsFromDefinition(fixture.game);

    if (strategy === "permanent-etb") {
      driveMoveTo(fixture.action, card.id, ZoneType.Battlefield);
    }
    // Spell/other strategies are activation-only in MVP — see file header.

    return { ok: true, strategy };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const errorClass = classify(e, msg);
    return {
      ok: false,
      strategy,
      errorClass,
      error: msg.slice(0, 240),
    };
  }
};

// ── Strategy selection ───────────────────────────────────────────────────────

const decideStrategy = (def: CardDefinition): SmokeResult["strategy"] => {
  const types = def.types.types;
  if (types.includes(CardType.Instant) || types.includes(CardType.Sorcery)) {
    return "spell-activate";
  }
  // Use the canonical permanent-ness map: any permanent core type triggers
  // ETB. CARD_TYPE_IS_PERMANENT covers Artifact / Battle / Creature /
  // Enchantment / Land / Planeswalker.
  for (const t of types) {
    if (PERMANENT_TYPES.has(t)) return "permanent-etb";
  }
  return "other-activate";
};

const PERMANENT_TYPES: ReadonlySet<CardType> = new Set<CardType>([
  CardType.Artifact,
  CardType.Battle,
  CardType.Creature,
  CardType.Enchantment,
  CardType.Land,
  CardType.Planeswalker,
]);

// ── Game fixture ────────────────────────────────────────────────────────────

interface Fixture {
  readonly game: Game;
  readonly action: GameAction;
  readonly seat0: PlayerSeat;
  readonly seat1: PlayerSeat;
}

const ALICE: LobbyPlayer = { id: "alice", name: "Alice", controllerKind: "human" };
const BOB: LobbyPlayer = { id: "bob", name: "Bob", controllerKind: "ai" };

const RULES: GameRules = {
  formatId: "casual",
  startingLife: 20,
  startingHandSize: 7,
  mulliganRule: "london",
  firstPlayerSkipsDraw: true,
  ruleOverrides: [],
  playerCount: { min: 2, max: 2 },
  poisonCountersToLose: 10,
  playForAnte: false,
  manaBurn: false,
  appliedVariants: [],
};

const META: GameMeta = {
  engineVersion: "smoke",
  forgeSha: "smoke",
  cardDataSyncedAt: "2026-04-30T00:00:00Z",
  crVersion: "2026-03-17",
  seed: "0xSMOKE",
};

const makeFixture = (): Fixture => {
  const game = new Game({
    lobbyPlayers: [ALICE, BOB],
    rules: RULES,
    meta: META,
    rng: new SeededRng(0xc0ffeen),
  });
  // Seed the per-player zones the smoke harness touches. Library/Graveyard
  // are seeded too because some replacement handlers reference them at
  // activation time (e.g. a "if this would die, exile instead" replacement
  // that registers a graveyard probe).
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return {
    game,
    action: new GameAction(game),
    seat0: mkPlayerSeat(0),
    seat1: mkPlayerSeat(1),
  };
};

// ── Card construction ───────────────────────────────────────────────────────

let smokePaperCardCounter = 0;

const mintCard = (fixture: Fixture, def: CardDefinition): Card => {
  smokePaperCardCounter++;
  const id = fixture.game.newEntityId();
  const paper = {
    name: def.name,
    edition: "SMK",
    collectorNumber: String(smokePaperCardCounter).padStart(4, "0"),
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition: def,
  };
  const card = new Card(id, paper, fixture.seat0, fixture.seat0, ZoneType.Hand);
  fixture.game.cards.set(id, card);
  // Seed in seat 0's hand so moveTo's source-zone resolution matches the
  // PaperCard.controllerSeat and the canonical card-state machine has a
  // valid starting point.
  const hand = fixture.game.getPlayer(fixture.seat0).zones.get(ZoneType.Hand);
  if (!hand) throw new Error("smoke: missing hand zone for seat 0");
  hand.add(id);
  return card;
};

// ── Generator drive ─────────────────────────────────────────────────────────

/**
 * Drive an action generator to completion, refusing decisions. The smoke
 * harness's contract is "no decisions needed" — if a card's ETB demands one,
 * we surface it as an `unhandled-decision` failure rather than fabricate a
 * response that might mask a real bug.
 */
const driveMoveTo = (action: GameAction, cardId: EntityId, toZone: ZoneType): void => {
  const gen = action.moveTo(cardId, toZone);
  let safety = 0;
  let step = gen.next();
  while (!step.done) {
    safety++;
    if (safety > 5000) {
      throw new Error("smoke: runaway moveTo generator (>5k yields)");
    }
    const value: EngineYield = step.value;
    if (value.kind === "decision") {
      throw new SmokeUnhandledDecisionError(`unhandled decision kind=${value.request.kind} during moveTo`);
    }
    step = gen.next();
  }
};

class SmokeUnhandledDecisionError extends Error {
  readonly _smokeKind = "unhandled-decision" as const;
}

// ── Error classification ────────────────────────────────────────────────────

const classify = (e: unknown, msg: string): SmokeErrorClass => {
  if (e instanceof SmokeUnhandledDecisionError) return "unhandled-decision";
  const ctor = e instanceof Error ? e.constructor.name : "";
  if (ctor === "GameStateIntegrityError") return "integrity";
  if (ctor === "IllegalDecisionError") return "illegal-decision";
  if (e instanceof TypeError) return "type-error";
  if (e instanceof RangeError) return "range-error";
  const lower = msg.toLowerCase();
  if (
    lower.includes("no handler") ||
    lower.includes("unknown handler") ||
    lower.includes("handler not found") ||
    lower.includes("lookup") ||
    lower.includes("registry")
  ) {
    return "missing-handler";
  }
  if (lower.includes("card not found") || lower.includes("missing card")) {
    return "missing-card";
  }
  return "other";
};
