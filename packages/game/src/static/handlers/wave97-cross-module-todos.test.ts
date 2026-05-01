// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 97 — cross-module TODO(advanced) sweep round 2 regression tests.
//
// Picks closed (one assertion bundle per pick):
//   1. CantAttach ValidPlayerTarget$ — Curse-shape aura attach to player
//      gates via the new playerTargetMatches predicate; canAttachPlayer
//      helper consults it. Card-target attachments are unaffected by a
//      static that specifies ONLY ValidPlayerTarget$.
//   2. CantGainLifeFromSource$ — source-conditional CantGainLife. Gate
//      fires only when the threaded sourceCardId matches the static's
//      filter; sourceless gain (no opts.sourceCardId) falls through.
//   3. CantLoseLifeFromSource$ — symmetric on the negative-delta side.
//   4. CantDrawByCount$ N — gate fires after the matched player has
//      drawn N cards this turn; the first N draws succeed, the (N+1)-th
//      and onward are blocked. Per-card consultation inside the loop.
//   5. CantDiscard ValidCause$ + ForCost$ — Tamiyo-shape "your opponents
//      can't make you discard" filters by cause-controller AND ForCost$
//      False (effect-driven only). Cost-driven discards (Madness payment
//      lane) are not gated by a ForCost$ False static.
//   6. DisableTriggers composite zones — Origin$ / Destination$ accept
//      "Battlefield,Graveyard" comma-lists; the gate matches if the
//      event's zone is in the set.
import type {
  LobbyPlayer,
  PaperCard,
  PlayerSeat,
  StaticAbility,
  StaticAbilityMode,
  StaticAst,
} from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { canGainLife } from "../../statics/wave60-cant-gates.js";
import { canDraw } from "../../statics/wave70i-loyalty-gates.js";
import { isTriggerDisabled } from "../../statics/wave70j-rule-gates.js";
import { canAttach, canAttachPlayer } from "../../statics/wave70k-gate-helpers.js";
import { canLoseLife } from "../../statics/wave70m-gate-helpers.js";
import { canDiscard } from "../../statics/wave74-gate-helpers.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { staticHandlerRegistry } from "../static-handler.js";
// Side-effect: register every handler.
import "./index.js";

// ── fixtures ─────────────────────────────────────────────────────────────────
const alice: LobbyPlayer = { id: "P0", name: "P0", controllerKind: "human" };
const bob: LobbyPlayer = { id: "P1", name: "P1", controllerKind: "human" };
const rules: GameRules = {
  formatId: "standard",
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
const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "test",
  cardDataSyncedAt: "2026-04-26T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "deadbeef",
};

const mkGame = (): Game => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xdeadbeefn),
  });
  for (const p of game.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
  }
  return game;
};

const mkPaper = (name: string, types = "Creature — Bear"): PaperCard => ({
  name,
  edition: "TEST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name,
    oracle: "",
    types: TypeLine.parse(types),
    manaCost: { raw: "1G", symbols: [] },
    pt: { power: "2", toughness: "2" },
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  },
});

interface MintOpts {
  readonly game: Game;
  readonly id: number;
  readonly paper: PaperCard;
  readonly seat?: 0 | 1;
  readonly zone?: ZoneType;
}
const mintCard = (opts: MintOpts): Card => {
  const cid = mkEntityId(opts.id);
  const seat: PlayerSeat = mkPlayerSeat(opts.seat ?? 0);
  const card = new Card(cid, opts.paper, seat, seat, opts.zone ?? ZoneType.Battlefield);
  opts.game.cards.set(cid, card);
  const z = opts.game.getPlayer(seat).zones.get(opts.zone ?? ZoneType.Battlefield);
  z?.add(cid);
  return card;
};

const buildAndRegister = (
  game: Game,
  ast: StaticAst,
  sourceCardId: number,
  staticIdSeed: number,
  controllerSeat: 0 | 1 = 0,
): StaticAbility => {
  const Cls = staticHandlerRegistry.lookup(ast.mode as StaticAbilityMode);
  if (!Cls) throw new Error(`mode ${ast.mode} not registered`);
  const s = new Cls().build(ast, {
    game,
    sourceCardId: mkEntityId(sourceCardId),
    controllerSeat: mkPlayerSeat(controllerSeat),
    staticId: mkEntityId(staticIdSeed),
  });
  game.staticEffectRegistry.register(s);
  return s;
};

// ── Pick 1: CantAttach ValidPlayerTarget$ ────────────────────────────────────
describe("Wave 97 — CantAttach ValidPlayerTarget$ (player-target gate)", () => {
  it("ValidPlayerTarget$ You blocks player-attach when the candidate seat matches", () => {
    const g = mkGame();
    const aura = mintCard({ game: g, id: 9701, paper: mkPaper("Curse of X"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "CantAttach",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          ValidPlayerTarget: { kind: "literal", raw: "You" },
        },
        activeInZones: [],
      },
      aura.id,
      97001,
      0,
    );
    // Static's controller is seat 0 — "You" === seat 0.
    expect(canAttachPlayer(g, aura.id, mkPlayerSeat(0))).toBe(false);
    // Seat 1 not gated.
    expect(canAttachPlayer(g, aura.id, mkPlayerSeat(1))).toBe(true);
  });

  it("static with ONLY ValidPlayerTarget$ does NOT gate card-target attaches", () => {
    const g = mkGame();
    const aura = mintCard({ game: g, id: 9710, paper: mkPaper("Curse of Y"), seat: 0 });
    const target = mintCard({ game: g, id: 9711, paper: mkPaper("Bear"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "CantAttach",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          ValidPlayerTarget: { kind: "literal", raw: "You" },
        },
        activeInZones: [],
      },
      aura.id,
      97011,
      0,
    );
    // Card-target attach: the canAttach (card) helper is unaffected by a
    // player-target-only static.
    expect(canAttach(g, aura.id, target.id)).toBe(true);
  });

  it("static WITHOUT ValidPlayerTarget$ does NOT gate player-target attaches", () => {
    const g = mkGame();
    const aura = mintCard({ game: g, id: 9720, paper: mkPaper("Aura Z"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "CantAttach",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          // No ValidPlayerTarget$ → does not engage canAttachPlayer.
        },
        activeInZones: [],
      },
      aura.id,
      97021,
      0,
    );
    expect(canAttachPlayer(g, aura.id, mkPlayerSeat(0))).toBe(true);
    expect(canAttachPlayer(g, aura.id, mkPlayerSeat(1))).toBe(true);
  });
});

// ── Pick 2: CantGainLifeFromSource$ ──────────────────────────────────────────
describe("Wave 97 — CantGainLifeFromSource$ source-conditional", () => {
  it("FromSource$ Card.Self only blocks gain when source matches", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 9730, paper: mkPaper("Vortex"), seat: 0 });
    const other = mintCard({ game: g, id: 9731, paper: mkPaper("Other"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "CantGainLife",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          CantGainLifeFromSource: { kind: "literal", raw: "Card.Self" },
        },
        activeInZones: [],
      },
      src.id,
      97031,
      0,
    );
    // Source matches → blocked.
    expect(canGainLife(g, mkPlayerSeat(0), src.id)).toBe(false);
    // Different source → not blocked.
    expect(canGainLife(g, mkPlayerSeat(0), other.id)).toBe(true);
    // Sourceless gain (no source threaded) → not blocked.
    expect(canGainLife(g, mkPlayerSeat(0), undefined)).toBe(true);
  });

  it("unconditional CantGainLife (no FromSource$) gates every gain regardless of source", () => {
    const g = mkGame();
    buildAndRegister(
      g,
      {
        mode: "CantGainLife",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      9740,
      97041,
      0,
    );
    expect(canGainLife(g, mkPlayerSeat(0), undefined)).toBe(false);
    expect(canGainLife(g, mkPlayerSeat(0), mkEntityId(9999))).toBe(false);
  });
});

// ── Pick 3: CantLoseLifeFromSource$ ──────────────────────────────────────────
describe("Wave 97 — CantLoseLifeFromSource$ source-conditional", () => {
  it("FromSource$ Card.Self only blocks loss when source matches", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 9750, paper: mkPaper("Shield"), seat: 0 });
    const other = mintCard({ game: g, id: 9751, paper: mkPaper("Other"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "CantLoseLife",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          CantLoseLifeFromSource: { kind: "literal", raw: "Card.Self" },
        },
        activeInZones: [],
      },
      src.id,
      97051,
      0,
    );
    expect(canLoseLife(g, mkPlayerSeat(0), src.id)).toBe(false);
    expect(canLoseLife(g, mkPlayerSeat(0), other.id)).toBe(true);
    expect(canLoseLife(g, mkPlayerSeat(0), undefined)).toBe(true);
  });

  it("unconditional CantLoseLife gates every loss regardless of source", () => {
    const g = mkGame();
    buildAndRegister(
      g,
      {
        mode: "CantLoseLife",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      9760,
      97061,
      0,
    );
    expect(canLoseLife(g, mkPlayerSeat(0), undefined)).toBe(false);
    expect(canLoseLife(g, mkPlayerSeat(0), mkEntityId(9999))).toBe(false);
  });
});

// ── Pick 4: CantDrawByCount$ N ───────────────────────────────────────────────
describe("Wave 97 — CantDrawByCount$ N count-conditional", () => {
  it("N=2 allows the first 2 draws and blocks the 3rd onward", () => {
    const g = mkGame();
    buildAndRegister(
      g,
      {
        mode: "CantDraw",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          CantDrawByCount: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      9770,
      97071,
      0,
    );
    const seat = mkPlayerSeat(0);
    // 0 drawn → can draw.
    expect(canDraw(g, seat)).toBe(true);
    // Simulate 1 drawn.
    g.flags.cardsDrawnThisTurn.set(seat, 1);
    expect(canDraw(g, seat)).toBe(true);
    // Simulate 2 drawn — at threshold, gate fires.
    g.flags.cardsDrawnThisTurn.set(seat, 2);
    expect(canDraw(g, seat)).toBe(false);
    // Above threshold → still blocked.
    g.flags.cardsDrawnThisTurn.set(seat, 5);
    expect(canDraw(g, seat)).toBe(false);
  });

  it("undefined byCount preserves the unconditional pre-Wave-97 behavior", () => {
    const g = mkGame();
    buildAndRegister(
      g,
      {
        mode: "CantDraw",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      9780,
      97081,
      0,
    );
    const seat = mkPlayerSeat(0);
    expect(canDraw(g, seat)).toBe(false);
    g.flags.cardsDrawnThisTurn.set(seat, 99);
    expect(canDraw(g, seat)).toBe(false);
  });
});

// ── Pick 5: CantDiscard ValidCause$ + ForCost$ ───────────────────────────────
describe("Wave 97 — CantDiscard ValidCause$ + ForCost$", () => {
  it("ValidCause$ SpellAbility.OppCtrl + ForCost$ False — only effect-driven, opp-source discards blocked", () => {
    const g = mkGame();
    buildAndRegister(
      g,
      {
        mode: "CantDiscard",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          ValidCause: { kind: "literal", raw: "SpellAbility.OppCtrl" },
          ForCost: { kind: "literal", raw: "False" },
        },
        activeInZones: [],
      },
      9790,
      97091,
      0,
    );
    const seat = mkPlayerSeat(0);
    // Effect-driven from opponent (seat 1) → blocked.
    expect(canDiscard(g, seat, { kind: "effect", causeControllerSeat: mkPlayerSeat(1) })).toBe(false);
    // Effect-driven from owner (seat 0) → not blocked (not opp-controlled).
    expect(canDiscard(g, seat, { kind: "effect", causeControllerSeat: mkPlayerSeat(0) })).toBe(true);
    // Cost-driven from opponent → not blocked (ForCost$ False).
    expect(canDiscard(g, seat, { kind: "cost", causeControllerSeat: mkPlayerSeat(1) })).toBe(true);
    // Effect-driven with no known controller → not blocked (ValidCause$
    // SpellAbility.OppCtrl needs a known opp controller to match).
    expect(canDiscard(g, seat, { kind: "effect" })).toBe(true);
  });

  it("legacy unconditional CantDiscard (no ValidCause$/ForCost$) blocks all discards", () => {
    const g = mkGame();
    buildAndRegister(
      g,
      {
        mode: "CantDiscard",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      9800,
      97101,
      0,
    );
    const seat = mkPlayerSeat(0);
    expect(canDiscard(g, seat)).toBe(false);
    expect(canDiscard(g, seat, { kind: "cost" })).toBe(false);
    expect(canDiscard(g, seat, { kind: "effect", causeControllerSeat: mkPlayerSeat(1) })).toBe(false);
  });
});

// ── Pick 6: DisableTriggers composite zones ─────────────────────────────────
describe("Wave 97 — DisableTriggers composite Origin$/Destination$", () => {
  it("Destination$ 'Battlefield,Graveyard' matches an event whose toZone is either", () => {
    const g = mkGame();
    buildAndRegister(
      g,
      {
        mode: "DisableTriggers",
        params: {
          Destination: { kind: "literal", raw: "Battlefield,Graveyard" },
        },
        activeInZones: [],
      },
      9810,
      97111,
      0,
    );
    const statics = g.staticEffectRegistry.byMode("DisableTriggers");
    expect(statics.length).toBe(1);
    const payload = statics[0]?.describe() as { destinations?: ReadonlySet<ZoneType> };
    expect(payload.destinations).toBeDefined();
    expect(payload.destinations?.has(ZoneType.Battlefield)).toBe(true);
    expect(payload.destinations?.has(ZoneType.Graveyard)).toBe(true);
    expect(payload.destinations?.has(ZoneType.Hand)).toBe(false);

    // End-to-end via isTriggerDisabled — Battlefield destination, ChangesZone.
    const triggerStub = {
      sourceCardId: mkEntityId(9999),
    } as unknown as Parameters<typeof isTriggerDisabled>[1];
    const evtBattlefield = {
      kind: "CardChangedZone",
      turn: 1,
      phase: undefined,
      payload: { fromZone: ZoneType.Hand, toZone: ZoneType.Battlefield },
    } as unknown as Parameters<typeof isTriggerDisabled>[2];
    expect(isTriggerDisabled(g, triggerStub, evtBattlefield)).toBe(true);
    const evtGraveyard = {
      kind: "CardChangedZone",
      turn: 1,
      phase: undefined,
      payload: { fromZone: ZoneType.Battlefield, toZone: ZoneType.Graveyard },
    } as unknown as Parameters<typeof isTriggerDisabled>[2];
    expect(isTriggerDisabled(g, triggerStub, evtGraveyard)).toBe(true);
    const evtHand = {
      kind: "CardChangedZone",
      turn: 1,
      phase: undefined,
      payload: { fromZone: ZoneType.Library, toZone: ZoneType.Hand },
    } as unknown as Parameters<typeof isTriggerDisabled>[2];
    expect(isTriggerDisabled(g, triggerStub, evtHand)).toBe(false);
  });

  it("malformed zone tokens collapse to undefined (treated as 'any')", () => {
    const g = mkGame();
    buildAndRegister(
      g,
      {
        mode: "DisableTriggers",
        params: {
          Destination: { kind: "literal", raw: "NotAZone,AlsoBogus" },
        },
        activeInZones: [],
      },
      9820,
      97121,
      0,
    );
    const statics = g.staticEffectRegistry.byMode("DisableTriggers");
    const payload = statics[0]?.describe() as { destinations?: ReadonlySet<ZoneType> };
    expect(payload.destinations).toBeUndefined();
  });
});
