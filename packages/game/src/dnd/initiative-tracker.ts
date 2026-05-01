// SPDX-License-Identifier: GPL-3.0-or-later
// Initiative tracker (CR 906) — Adventures in the Forgotten Realms.
//
// game.flags.initiative: PlayerSeat | null. The initiative starts unowned
// and is taken by the FIRST card that says "you take the initiative". Two
// transitions matter:
//
//   1. Combat damage to the initiative-holder transfers initiative to the
//      attacker's controller (CR 906.4b). Hooked from CombatHandler.
//   2. At the beginning of the initiative-holder's upkeep, they advance
//      one room in the Initiative dungeon (Undercity; CR 906.4c).
//
// Wave 70.B closes the per-room SVar-effect TODO. Each room's printed
// effect is applied to the player who entered. The 9-room sequence + the
// effects are taken verbatim from Forge's `tokenscripts/undercity.txt`:
//
//   1. Secret Entrance         — search library for a basic land
//   2. Forge                   — put two +1/+1 counters on a creature you control
//   3. Lost Well               — scry 2
//   4. Trap!                   — each opponent loses 5 life
//   5. Arena                   — goad target creature you don't control
//   6. Stash                   — create a Treasure token
//   7. Archives                — draw a card
//   8. Catacombs               — create a 4/1 black Skeleton with menace
//   9. Throne of the Dead Three — reveal top 10, put a creature with three
//                                 +1/+1 counters onto the battlefield (MVP:
//                                 +1/+1 counters; full hexproof-until-next-
//                                 turn pump is documented inline).
//
// The room sequence is a non-branching loop in our model — Forge's text
// allows branching ("Leads to: Forge, Lost Well") but in practice the
// canonical pulse is "venture one room in this fixed order"; CR 309.4
// completion-and-restart wraps room 9 back to room 1 on the next venture.
//
// This module exposes three entry points:
//   - grantInitiative(game, seat) → events for BecameInitiative + the
//     UndercityRoomEntered pulse from the immediate venture-on-take.
//   - applyUndercityRoomEffect(game, seat, room) → generator that runs
//     the room's printed effect via game.action.* / sub-effect calls.
//     Callers iterate this AFTER emitting UndercityRoomEntered.
//   - onCombatDamageToPlayer / onUpkeepAdvanceInitiativeDungeon as before.
import type { TokenEntry } from "@mtg-forge-ts/cards";
import { tokenDatabase } from "@mtg-forge-ts/cards";
import {
  CardType,
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  type EntityId,
  type GameEvent,
  type KeywordAst,
  type PaperCard,
  type PlayerSeat,
  Supertype,
  TypeLine,
  ZoneType,
  keywordIdFromDisplayName,
} from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import type { Game } from "../game.js";

/**
 * Wave 45 / Wave 70.B — Undercity dungeon room sequence (CR 906.4c). Forge's
 * `tokenscripts/undercity.txt` lists 9 rooms in the canonical venture
 * order. Index 0 is "not yet entered"; the first venture lands on room 1
 * (Secret Entrance) and the 10th venture wraps to 1 (per CR 309.4 —
 * completing a dungeon lets the next venture start from the entrance).
 */
export const UNDERCITY_ROOMS: readonly string[] = [
  "Secret Entrance",
  "Forge",
  "Lost Well",
  "Trap!",
  "Arena",
  "Stash",
  "Archives",
  "Catacombs",
  "Throne of the Dead Three",
];

/**
 * Advance the Undercity dungeon by one room (mod 9). Returns the new
 * room index (1..9) and the corresponding name. Caller routes the
 * UndercityRoomEntered event through the engine pipeline.
 */
export const advanceUndercityRoom = (game: Game, seat: PlayerSeat): readonly GameEvent[] => {
  const prior = game.flags.undercityRoom;
  const next = (prior % UNDERCITY_ROOMS.length) + 1;
  game.flags.undercityRoom = next;
  const roomName = UNDERCITY_ROOMS[next - 1] ?? "Secret Entrance";
  return [
    {
      kind: "UndercityRoomEntered",
      version: 1,
      turn: game.turn,
      phase: game.phase,
      payload: { playerSeat: seat, room: next, roomName },
    },
  ];
};

/**
 * Set the initiative-holder + emit BecameInitiative for the new holder.
 * Returns the events to yield (caller routes through engine pipeline).
 *
 * Pitfall: writes through `flags.initiative` (the snapshot-backed slot);
 * the older duck-typed `Game.initiativeSeat` field used by Wave 22's
 * `TakeInitiativeEffect` is migrated alongside this tracker.
 */
export const grantInitiative = (game: Game, seat: PlayerSeat): readonly GameEvent[] => {
  const prior = game.flags.initiative;
  if (prior === seat) return [];
  game.flags.initiative = seat;
  // Wave 45 — taking the initiative ventures into the Undercity (CR 906.4c
  // covers the upkeep advance; CR 906.4 says the player who takes the
  // initiative also ventures immediately on TAKE). Emit BecameInitiative
  // first, then the dungeon advance.
  const becameEvent: GameEvent = {
    kind: "BecameInitiative",
    version: 1,
    turn: game.turn,
    phase: game.phase,
    payload: { playerSeat: seat },
  };
  return [becameEvent, ...advanceUndercityRoom(game, seat)];
};

/**
 * Combat-damage transfer hook. Called from CombatHandler AFTER each
 * `game.action.damage(..., isCombat=true)` whose target is a player. If
 * the target is the current initiative-holder AND the source's controller
 * is a different seat, transfer initiative. Per CR 506.4 the transfer
 * happens AFTER damage is dealt but before the resulting triggers
 * resolve — combat-handler invokes us synchronously between the damage
 * yield and the next damage emission, which matches.
 */
export const onCombatDamageToPlayer = (
  game: Game,
  sourceCardId: number,
  targetSeat: PlayerSeat,
  amount: number,
): readonly GameEvent[] => {
  if (amount <= 0) return [];
  const holder = game.flags.initiative;
  if (holder === null || holder !== targetSeat) return [];
  const sourceCard = game.cards.get(sourceCardId as Parameters<Game["cards"]["get"]>[0]);
  if (!sourceCard) return [];
  const attackerSeat = sourceCard.controllerSeat;
  if (attackerSeat === targetSeat) return [];
  return grantInitiative(game, attackerSeat);
};

/**
 * Upkeep dungeon-advance hook. Called from PhaseHandler at the start of
 * the active player's upkeep when they're the initiative-holder. Returns
 * the UndercityRoomEntered event(s); the caller emits them and then runs
 * `applyUndercityRoomEffect` to apply the printed effect.
 */
export const onUpkeepAdvanceInitiativeDungeon = (
  game: Game,
  activeSeat: PlayerSeat,
): readonly GameEvent[] => {
  if (game.flags.initiative !== activeSeat) return [];
  return advanceUndercityRoom(game, activeSeat);
};

// ---------------------------------------------------------------------------
// Wave 70.B — per-room printed effect dispatch
// ---------------------------------------------------------------------------

/**
 * Pick the seat directly after `seat` in turn order. With 2-player MVP we
 * always have exactly one opponent, so the lookup degenerates to the
 * other player. Wave 98 — multiplayer expansion: iterate `game.players`
 * and pick the next non-eliminated seat (mirrors the monarch tracker /
 * priority pipeline). Eliminated seats (`hasLost === true`) are skipped
 * so the dungeon-room "another player" fallback does not stall on a
 * dead seat. If no live opponent exists (degenerate solo replay or every
 * other seat has lost), returns `seat` itself — the canonical "self
 * fallback" used by the priority pipeline; downstream callers that
 * apply life-loss / goad-target / etc. effectively no-op when the
 * routed seat happens to be the venturing player.
 */
const opponentOf = (game: Game, seat: PlayerSeat): PlayerSeat => {
  for (const p of game.players) {
    if (p.seat === seat) continue;
    if (p.hasLost) continue;
    return p.seat;
  }
  return seat;
};

/**
 * Wave 102 — collect every battlefield creature card the seat controls.
 * Used by the Forge room as the eligible pool for the `chooseCard`
 * decision request (`ValidTgts$ Creature.YouCtrl` shape). The
 * caller treats `[0]` as the deterministic fallback when the
 * decision provider returns no chosen ids.
 */
const collectOwnCreatures = (game: Game, seat: PlayerSeat): readonly EntityId[] => {
  const out: EntityId[] = [];
  for (const [id, card] of game.cards) {
    if (card.zone !== ZoneType.Battlefield) continue;
    if (card.controllerSeat !== seat) continue;
    const chars = game.layerEngine.computeCharacteristics(id);
    if (chars.types.has(CardType.Creature)) out.push(id);
  }
  return out;
};

/**
 * Wave 102 — collect every battlefield creature card the seat does
 * NOT control. Used by the Arena room (goad target choice).
 */
const collectOpponentCreatures = (game: Game, seat: PlayerSeat): readonly EntityId[] => {
  const out: EntityId[] = [];
  for (const [id, card] of game.cards) {
    if (card.zone !== ZoneType.Battlefield) continue;
    if (card.controllerSeat === seat) continue;
    const chars = game.layerEngine.computeCharacteristics(id);
    if (chars.types.has(CardType.Creature)) out.push(id);
  }
  return out;
};

/**
 * Find the top basic land in `seat`'s library. Used by Secret Entrance
 * (search library for a basic land card). MVP: pick the first basic the
 * library scan finds. Forge's actual flow yields a chooseCard request
 * over the full library; documented as TODO(advanced) since the
 * decision-driven path needs the full library scanned + revealed.
 */
const findBasicLandInLibrary = (game: Game, seat: PlayerSeat): EntityId | undefined => {
  const player = game.getPlayer(seat);
  const library = player.zones.get(ZoneType.Library);
  if (!library) return undefined;
  for (const id of library.toArray()) {
    const card = game.cards.get(id);
    if (!card) continue;
    const chars = game.layerEngine.computeCharacteristics(id);
    if (!chars.types.has(CardType.Land)) continue;
    if (!chars.supertypes.has(Supertype.Basic)) continue;
    return id;
  }
  return undefined;
};

/**
 * Build a 4/1 black Skeleton paper card with menace for Catacombs. We
 * synthesize this inline rather than depending on a token-database entry
 * because the database currently has the 1/1 black Skeleton form
 * (`b_1_1_skeleton`); the 4/1 + menace shape is unique to the Undercity
 * Catacombs effect.
 */
const synthesizeSkeletonMenacePaperCard = (): PaperCard => {
  const typeLine = TypeLine.parse("Creature — Skeleton");
  const menaceId = keywordIdFromDisplayName("Menace");
  const keywords: readonly KeywordAst[] = menaceId !== null ? [{ keyword: menaceId }] : [];
  return {
    name: "Skeleton Token",
    edition: "TOK",
    collectorNumber: "0",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition: {
      name: "Skeleton Token",
      oracle: "Menace",
      types: typeLine,
      manaCost: null,
      pt: { power: "4", toughness: "1" },
      colors: ColorSet.empty(),
      abilities: [],
      triggers: [],
      replacements: [],
      statics: [],
      keywords,
      svars: new Map(),
    },
  };
};

/**
 * Apply the printed effect for the Undercity room indexed by `room` (1..9)
 * to `seat`. The room number matches what `advanceUndercityRoom` returned;
 * out-of-range / "not yet entered" (0) is a no-op for safety.
 *
 * The effects mirror Forge's `tokenscripts/undercity.txt` SVars:
 *   1 Secret Entrance — search library for basic land, put into hand, shuffle
 *   2 Forge           — put two +1/+1 counters on a creature you control
 *   3 Lost Well       — scry 2
 *   4 Trap!           — each opponent loses 5 life
 *   5 Arena           — goad a creature you don't control
 *   6 Stash           — create a Treasure token
 *   7 Archives        — draw a card
 *   8 Catacombs       — create a 4/1 black Skeleton creature token with menace
 *   9 Throne of the Dead Three — reveal top 10, put a creature card from
 *     among them onto the battlefield with three +1/+1 counters on it
 *     (MVP: hexproof-until-next-turn pump documented inline as TODO(advanced)).
 */
export function* applyUndercityRoomEffect(
  game: Game,
  seat: PlayerSeat,
  room: number,
): Generator<EngineYield, void, unknown> {
  switch (room) {
    case 1: {
      // Secret Entrance — search basic land + reveal + put into hand,
      // then shuffle. MVP: scan library deterministically (decision-driven
      // search-and-reveal is TODO(advanced)).
      const found = findBasicLandInLibrary(game, seat);
      if (found !== undefined) {
        yield* game.action.moveTo(found, ZoneType.Hand, { toSeat: seat, cause: "effect" });
      }
      yield* game.action.shuffle(seat);
      return;
    }
    case 2: {
      // Forge — put two +1/+1 counters on a creature you control.
      // Wave 102: decision-driven target choice. The venturing player
      // yields a `chooseCard` decision over the eligible pool of
      // creatures they control; first-match is the deterministic
      // fallback when the decision provider returns nothing
      // (snapshot replay parity, headless tests). Single-creature
      // pools still surface the decision request for trace
      // determinism — Forge's chooser path is consistent regardless
      // of pool size.
      const ownCreatures = collectOwnCreatures(game, seat);
      if (ownCreatures.length === 0) return;
      const decision = (yield {
        kind: "decision",
        request: {
          kind: "chooseCard",
          playerSeat: seat,
          pool: ownCreatures,
          restriction: { effect: "undercity-forge" },
          min: 1,
          max: 1,
        },
      }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;
      const eligible = new Set(ownCreatures);
      let target: EntityId | undefined = ownCreatures[0];
      if (decision && decision.kind === "chooseCard") {
        for (const id of decision.chosen) {
          if (eligible.has(id)) {
            target = id;
            break;
          }
        }
      }
      if (target !== undefined) {
        yield* game.action.addCounter(target, "P1P1" as never, 2);
      }
      return;
    }
    case 3: {
      // Lost Well — scry 2.
      yield* game.action.scry(seat, 2);
      return;
    }
    case 4: {
      // Trap! — Forge's printed text is "target player loses 5 life";
      // CR 906 dungeon-room effects let the venturing player choose
      // the target. Wave 102: decision-driven `choosePlayer` request.
      // The venturing player picks any live player; deterministic
      // fallback is the first live opponent (or self-fallback if
      // every other seat has lost — same shape as the priority
      // pipeline's "no live opponent" degenerate case).
      const livePool: PlayerSeat[] = [];
      for (const p of game.players) {
        if (p.hasLost) continue;
        livePool.push(p.seat);
      }
      if (livePool.length === 0) return;
      // Dungeon-room turn-based actions have no real card source
      // (CR 906.4c is a state-based, undercity-driven effect, not
      // an ability of any specific card). Mint a fresh entity id so
      // the decision request stays well-typed; the value is
      // opaque to the chooser and only echoes back through telemetry.
      const trapSourceId = game.newEntityId();
      const decision = (yield {
        kind: "decision",
        request: {
          kind: "choosePlayer",
          sourceId: trapSourceId,
          restriction: { effect: "undercity-trap" },
          min: 1,
          max: 1,
        },
      }) as { readonly kind: "choosePlayer"; readonly chosen: readonly PlayerSeat[] } | undefined;
      const livePoolSet = new Set(livePool);
      let target: PlayerSeat = opponentOf(game, seat);
      if (decision && decision.kind === "choosePlayer") {
        for (const s of decision.chosen) {
          if (livePoolSet.has(s)) {
            target = s;
            break;
          }
        }
      }
      yield* game.action.changeLife(target, -5, { cause: "effect" });
      return;
    }
    case 5: {
      // Arena — goad target creature you don't control. Wave 102:
      // decision-driven `chooseCard` request over the eligible
      // pool of opponent-controlled creatures. First-match is the
      // deterministic fallback so snapshot replays / headless
      // tests still resolve when the decision provider returns
      // nothing.
      const opponentCreatures = collectOpponentCreatures(game, seat);
      if (opponentCreatures.length === 0) return;
      const decision = (yield {
        kind: "decision",
        request: {
          kind: "chooseCard",
          playerSeat: seat,
          pool: opponentCreatures,
          restriction: { effect: "undercity-arena" },
          min: 1,
          max: 1,
        },
      }) as { readonly kind: "chooseCard"; readonly chosen: readonly EntityId[] } | undefined;
      const eligible = new Set(opponentCreatures);
      let tgt: EntityId | undefined = opponentCreatures[0];
      if (decision && decision.kind === "chooseCard") {
        for (const id of decision.chosen) {
          if (eligible.has(id)) {
            tgt = id;
            break;
          }
        }
      }
      if (tgt !== undefined) {
        const card = game.cards.get(tgt);
        if (card) card.goaded = true;
      }
      return;
    }
    case 6: {
      // Stash — create a Treasure token. Routes through the predefined
      // token-database entry so the {T}, Sacrifice ability is wired.
      const treasureEntry = tokenDatabase.get("c_a_treasure_sac");
      if (treasureEntry !== undefined) {
        const paperCard = paperCardFromTreasureEntry(treasureEntry);
        yield* game.action.createToken({ paperCard, controller: seat, count: 1 });
      }
      return;
    }
    case 7: {
      // Archives — draw a card.
      yield* game.action.drawCards(seat, 1);
      return;
    }
    case 8: {
      // Catacombs — create a 4/1 black Skeleton creature token with menace.
      const paperCard = synthesizeSkeletonMenacePaperCard();
      yield* game.action.createToken({ paperCard, controller: seat, count: 1 });
      return;
    }
    case 9: {
      // Throne of the Dead Three — reveal top 10 of `seat`'s library; put
      // a creature card from among them onto the battlefield with three
      // +1/+1 counters on it; the rest are shuffled back. MVP scans the
      // top 10 deterministically and picks the first creature; the
      // hexproof-until-next-turn pump and the "may" wording are
      // TODO(advanced) — Wave 56's decision pipeline can drive the chooser
      // request and the chained Pump sub-ability once the trigger flow
      // here grows beyond the MVP single-yield shape.
      const player = game.getPlayer(seat);
      const library = player.zones.get(ZoneType.Library);
      if (library === undefined) return;
      const topIds = library.toArray().slice(0, 10);
      let chosen: EntityId | undefined;
      for (const id of topIds) {
        const chars = game.layerEngine.computeCharacteristics(id);
        if (chars.types.has(CardType.Creature)) {
          chosen = id;
          break;
        }
      }
      if (chosen !== undefined) {
        yield* game.action.moveTo(chosen, ZoneType.Battlefield, { toSeat: seat, cause: "effect" });
        yield* game.action.addCounter(chosen, "P1P1" as never, 3);
      }
      yield* game.action.shuffle(seat);
      return;
    }
    default:
      // 0 = "not yet entered"; nothing to do. Out-of-range never reached
      // from advanceUndercityRoom (which always returns 1..9 modulo 9).
      return;
  }
}

/**
 * Build a PaperCard from a TokenEntry (Treasure / Skeleton / Food / etc.).
 * Inlined here so this module doesn't depend on token.ts (which lives in
 * the ability-effects layer). Mirrors `paperCardFromEntry` in token.ts.
 */
const paperCardFromTreasureEntry = (entry: TokenEntry): PaperCard => ({
  name: entry.name,
  edition: "TOK",
  collectorNumber: "0",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
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
  },
});
