// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 100 — milestone cross-module TODO(advanced) sweep round 5
// regression tests.
//
// Picks closed (one assertion bundle per pick):
//   1. static/handlers/affected-filter.ts — `AffectedZone$ <list>` /
//      `AffectedZone$ All` now widens / narrows the canonical
//      battlefield-only scope. Painter's Servant / Conspiracy-shape
//      Continuous statics that need to reach off-battlefield cards
//      finally do; explicit zone lists narrow.
//   2. static/handlers/restriction-helpers.ts — `buildPlayerPredicate`
//      now recognises `Player.YouCtrl`, `Player.OppCtrl`, `Player.You`,
//      `Player.Opponent`, `Each`, AND comma-OR alternatives. Closes the
//      "the four shapes above" Wave-50 scope cap.
//   3. static/handlers/disable-triggers-static.ts +
//      statics/wave70j-rule-gates.ts — `ValidCausePlayer$` adds a
//      per-player cause filter for events whose canonical cause is a
//      player rather than a card (LifeChanged / PlayerLost). Closes the
//      explicit "ValidCause$ targeting a Player" TODO(advanced).
//   4. static/handlers/max-level-static.ts — non-Self ValidCard$ filters
//      now scan game.cards at build time and stamp every matching
//      card's `classMaxLevel` slot. Closes the Wave-60.C "only the
//      published Forge usage stamps the Class itself" TODO.
//   5. static/handlers/dont-untap-static.ts — `MaxUntap$ N` counted-
//      allowance payload now exposes the quota on the cantUntap
//      Restriction's `payload`, so the untap loop can read it and the
//      Static-Orb / Smoke / Winter-Orb-land "only N may untap" shape
//      becomes implementable. (The untap loop currently still treats
//      cantUntap as fail-closed; the gate-helper is the durable
//      Wave-100 contract.)
//   6. static/handlers/cant-target-static.ts — `AffectedZone$ <list>` /
//      `All` is now respected on CantTarget. Card-in-Graveyard targeting
//      protections (Vigilance for the Dead-shape) finally fire when
//      the candidate is in the matching zone; default
//      battlefield-only behavior preserved when the param is omitted.
import type {
  CardDefinition,
  GameEvent,
  LobbyPlayer,
  ManaCostAst,
  ManaCostJSON,
  PaperCard,
  PlayerSeat,
  StaticAbility,
  StaticAbilityMode,
  StaticAst,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  ManaCost,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "./card.js";
import type { GameMeta } from "./game-meta.js";
import type { GameRules } from "./game-rules.js";
import { Game } from "./game.js";
import { cardIdMatchesAffectedFilter, parseAffectedZones } from "./static/handlers/affected-filter.js";
import type { CantTargetPayload } from "./static/handlers/cant-target-static.js";
import type { DontUntapPayload } from "./static/handlers/dont-untap-static.js";
import { buildPlayerPredicate } from "./static/handlers/restriction-helpers.js";
import { staticHandlerRegistry } from "./static/static-handler.js";
import type { Restriction } from "./statics/cant-must-may.js";
import { isTriggerDisabled } from "./statics/wave70j-rule-gates.js";
import { Battlefield } from "./zone/zones/battlefield.js";
import { Exile } from "./zone/zones/exile.js";
import { Graveyard } from "./zone/zones/graveyard.js";
import { Hand } from "./zone/zones/hand.js";
import { Library } from "./zone/zones/library.js";
// Side-effect: register every handler so registry lookups resolve.
import "./static/handlers/index.js";
import "./trigger/handlers/index.js";

// ── shared fixtures ──────────────────────────────────────────────────────────
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
  cardDataSyncedAt: "2026-04-30T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "wave100",
};

const mkGame = (): Game => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xfeedfacen),
  });
  for (const p of game.players) {
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, p.seat));
  }
  return game;
};

const mkManaCostAst = (raw: string): ManaCostAst => {
  const j: ManaCostJSON = ManaCost.parse(raw).toJSON();
  return { raw, symbols: j.symbols };
};

const mkPaper = (name: string, typeLine = "Creature — Bear", manaCostRaw = "1G"): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name,
    oracle: "",
    types: TypeLine.parse(typeLine),
    manaCost: mkManaCostAst(manaCostRaw),
    pt: { power: "2", toughness: "2" },
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  } as CardDefinition,
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

const buildAndRegisterStatic = (
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

// ── Pick 1: AffectedZone$ widens / narrows scope ─────────────────────────────
describe("Wave 100 — AffectedZone$ widens cardIdMatchesAffectedFilter", () => {
  it("default (undefined) preserves battlefield-only Wave 47 contract", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const src = mintCard({ game: g, id: 8000, paper: mkPaper("Source"), seat: 0 });
    const handCard = mintCard({
      game: g,
      id: 8001,
      paper: mkPaper("In hand"),
      seat: 0,
      zone: ZoneType.Hand,
    });
    const bfCard = mintCard({ game: g, id: 8002, paper: mkPaper("On bf"), seat: 0 });
    // Default — handCard does NOT match.
    expect(cardIdMatchesAffectedFilter(g, src.id, seat0, handCard.id, "Card.YouCtrl")).toBe(false);
    // Default — bfCard matches.
    expect(cardIdMatchesAffectedFilter(g, src.id, seat0, bfCard.id, "Card.YouCtrl")).toBe(true);
  });

  it("'All' allows non-battlefield cards (Painter's Servant shape)", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const src = mintCard({ game: g, id: 8010, paper: mkPaper("Painter") });
    const handCard = mintCard({
      game: g,
      id: 8011,
      paper: mkPaper("Hand card"),
      seat: 0,
      zone: ZoneType.Hand,
    });
    const libCard = mintCard({
      game: g,
      id: 8012,
      paper: mkPaper("Library card"),
      seat: 0,
      zone: ZoneType.Library,
    });
    expect(cardIdMatchesAffectedFilter(g, src.id, seat0, handCard.id, "Card.YouCtrl", "all")).toBe(true);
    expect(cardIdMatchesAffectedFilter(g, src.id, seat0, libCard.id, "Card.YouCtrl", "all")).toBe(true);
  });

  it("explicit zone Set narrows correctly", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const src = mintCard({ game: g, id: 8020, paper: mkPaper("Src") });
    const handCard = mintCard({
      game: g,
      id: 8021,
      paper: mkPaper("Hand"),
      seat: 0,
      zone: ZoneType.Hand,
    });
    const gyCard = mintCard({
      game: g,
      id: 8022,
      paper: mkPaper("GY"),
      seat: 0,
      zone: ZoneType.Graveyard,
    });
    const zones = new Set<ZoneType>([ZoneType.Hand]);
    expect(cardIdMatchesAffectedFilter(g, src.id, seat0, handCard.id, "Card.YouCtrl", zones)).toBe(true);
    expect(cardIdMatchesAffectedFilter(g, src.id, seat0, gyCard.id, "Card.YouCtrl", zones)).toBe(false);
  });

  it("parseAffectedZones round-trip", () => {
    expect(parseAffectedZones(undefined)).toBe(null);
    expect(parseAffectedZones("All")).toBe("all");
    const set = parseAffectedZones("Hand,Graveyard");
    expect(set).not.toBe(null);
    expect(set).not.toBe("all");
    if (set instanceof Set || (set !== null && set !== "all")) {
      const s = set as ReadonlySet<ZoneType>;
      expect(s.has(ZoneType.Hand)).toBe(true);
      expect(s.has(ZoneType.Graveyard)).toBe(true);
      expect(s.has(ZoneType.Battlefield)).toBe(false);
    }
  });
});

// ── Pick 2: buildPlayerPredicate broader grammar ─────────────────────────────
describe("Wave 100 — buildPlayerPredicate recognises Player.YouCtrl / OppCtrl / Each", () => {
  const seat0 = mkPlayerSeat(0);
  const seat1 = mkPlayerSeat(1);

  it("Player.YouCtrl matches the controller seat only", () => {
    const pred = buildPlayerPredicate("Player.YouCtrl", seat0);
    expect(pred(seat0)).toBe(true);
    expect(pred(seat1)).toBe(false);
  });

  it("Player.OppCtrl matches opposing seats only", () => {
    const pred = buildPlayerPredicate("Player.OppCtrl", seat0);
    expect(pred(seat0)).toBe(false);
    expect(pred(seat1)).toBe(true);
  });

  it("Each matches every seat", () => {
    const pred = buildPlayerPredicate("Each", seat0);
    expect(pred(seat0)).toBe(true);
    expect(pred(seat1)).toBe(true);
  });

  it("comma-OR alternatives short-circuit", () => {
    // "You,Opponent" matches both seats (covers everyone in 1v1).
    const pred = buildPlayerPredicate("You,Opponent", seat0);
    expect(pred(seat0)).toBe(true);
    expect(pred(seat1)).toBe(true);
  });

  it("unrecognised aliases still fail-closed (Wave 50 contract)", () => {
    const pred = buildPlayerPredicate("Player.controllingThis", seat0);
    expect(pred(seat0)).toBe(false);
    expect(pred(seat1)).toBe(false);
  });
});

// ── Pick 3: ValidCausePlayer$ on DisableTriggers ─────────────────────────────
describe("Wave 100 — DisableTriggers ValidCausePlayer$ matches player-cause events", () => {
  const mkLifeChangedEvent = (seat: PlayerSeat): GameEvent =>
    ({
      kind: "LifeChanged",
      payload: { playerSeat: seat, before: 20, after: 18, delta: -2 },
    }) as unknown as GameEvent;

  const mkDummyTrigger = (sourceCardId: number, modeStr = "LifeLost"): TriggeredAbility =>
    ({
      id: mkEntityId(99000 + sourceCardId),
      kind: "trigger",
      sourceCardId: mkEntityId(sourceCardId),
      timestamp: 1,
      activeInZones: [ZoneType.Battlefield],
      ast: { mode: modeStr, params: {} } as unknown,
      controllerSeatAtReg: mkPlayerSeat(0),
      describe: () => null,
    }) as unknown as TriggeredAbility;

  it("ValidCausePlayer$ Opponent matches opponent's life-loss event", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 8100, paper: mkPaper("Suppressor") });
    buildAndRegisterStatic(
      g,
      {
        mode: "DisableTriggers",
        params: {
          ValidCausePlayer: { kind: "literal", raw: "Opponent" },
          ValidMode: { kind: "literal", raw: "LifeLost" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      88100,
      0,
    );
    const trig = mkDummyTrigger(8101, "LifeLost");
    // Event from opponent (seat 1) — DisableTriggers seat 0's controller →
    // OppCtrl matches seat 1.
    const evtOpp = mkLifeChangedEvent(mkPlayerSeat(1));
    expect(isTriggerDisabled(g, trig, evtOpp)).toBe(true);
    // Event from controller (seat 0) — should NOT be disabled.
    const evtSelf = mkLifeChangedEvent(mkPlayerSeat(0));
    expect(isTriggerDisabled(g, trig, evtSelf)).toBe(false);
  });

  it("event without playerSeat skips the player-cause gate", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 8120, paper: mkPaper("Suppressor") });
    buildAndRegisterStatic(
      g,
      {
        mode: "DisableTriggers",
        params: {
          ValidCausePlayer: { kind: "literal", raw: "Each" },
          ValidMode: { kind: "literal", raw: "LifeLost" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      88120,
      0,
    );
    const trig = mkDummyTrigger(8121, "LifeLost");
    // Event with NO playerSeat — gate skips it (no match).
    const evtBlank = { kind: "LifeChanged", payload: {} } as unknown as GameEvent;
    expect(isTriggerDisabled(g, trig, evtBlank)).toBe(false);
  });
});

// ── Pick 4: MaxLevel non-Self ValidCard$ multi-stamp ─────────────────────────
describe("Wave 100 — MaxLevel non-Self ValidCard$ stamps every matching card", () => {
  it("ValidCard$ Card.YouCtrl stamps every controlled card's classMaxLevel", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 8200, paper: mkPaper("Cap source") });
    const a = mintCard({ game: g, id: 8201, paper: mkPaper("Class A"), seat: 0 });
    const b = mintCard({ game: g, id: 8202, paper: mkPaper("Class B"), seat: 0 });
    const oppC = mintCard({ game: g, id: 8203, paper: mkPaper("Opp Class"), seat: 1 });
    buildAndRegisterStatic(
      g,
      {
        mode: "MaxLevel",
        params: {
          ValidCard: { kind: "literal", raw: "Card.YouCtrl" },
          MaxLevel: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      88200,
      0,
    );
    expect(a.classMaxLevel).toBe(2);
    expect(b.classMaxLevel).toBe(2);
    // Opponent-controlled card unaffected.
    expect(oppC.classMaxLevel).toBeUndefined();
  });

  it("ValidCard$ Card.Self preserves the canonical Class shape", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 8210, paper: mkPaper("Class self"), seat: 0 });
    buildAndRegisterStatic(
      g,
      {
        mode: "MaxLevel",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          MaxLevel: { kind: "literal", raw: "3" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      88210,
      0,
    );
    expect(src.classMaxLevel).toBe(3);
  });
});

// ── Pick 5: DontUntap MaxUntap$ counted-allowance payload ────────────────────
describe("Wave 100 — DontUntap MaxUntap$ exposes counted-allowance payload", () => {
  it("MaxUntap$ 1 surfaces the quota on the Restriction's payload", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 8300, paper: mkPaper("Static Orb") });
    const stat = buildAndRegisterStatic(
      g,
      {
        mode: "DontUntap",
        params: {
          ValidCard: { kind: "literal", raw: "Permanent.YouCtrl" },
          MaxUntap: { kind: "literal", raw: "1" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      88300,
      0,
    );
    const r = stat.describe() as Restriction;
    expect(r.kind).toBe("cantUntap");
    const payload = r.payload as DontUntapPayload | undefined;
    expect(payload).toBeDefined();
    if (payload) {
      expect(payload.kind).toBe("dontUntap");
      expect(payload.maxUntap).toBe(1);
    }
  });

  it("missing MaxUntap$ leaves quota undefined (Stasis-shape — full skip)", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 8310, paper: mkPaper("Stasis") });
    const stat = buildAndRegisterStatic(
      g,
      {
        mode: "DontUntap",
        params: { ValidCard: { kind: "literal", raw: "Permanent" } },
        activeInZones: [],
      },
      src.id as unknown as number,
      88310,
      0,
    );
    const r = stat.describe() as Restriction;
    const payload = r.payload as DontUntapPayload | undefined;
    expect(payload?.maxUntap).toBeUndefined();
  });

  it("MaxUntap$ payload's cardMatches matches valid card ids", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 8320, paper: mkPaper("Smoke") });
    const own = mintCard({ game: g, id: 8321, paper: mkPaper("Mine"), seat: 0 });
    const opp = mintCard({ game: g, id: 8322, paper: mkPaper("Theirs"), seat: 1 });
    const stat = buildAndRegisterStatic(
      g,
      {
        mode: "DontUntap",
        params: {
          ValidCard: { kind: "literal", raw: "Card.YouCtrl" },
          MaxUntap: { kind: "literal", raw: "1" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      88320,
      0,
    );
    const r = stat.describe() as Restriction;
    const payload = r.payload as DontUntapPayload;
    expect(payload.cardMatches(own.id, g)).toBe(true);
    expect(payload.cardMatches(opp.id, g)).toBe(false);
  });
});

// ── Pick 6: CantTarget AffectedZone$ ─────────────────────────────────────────
describe("Wave 100 — CantTarget honors AffectedZone$ list", () => {
  it("AffectedZone$ Graveyard gates cards in graveyard only", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 8400, paper: mkPaper("Graveyard guard") });
    const gyCard = mintCard({
      game: g,
      id: 8401,
      paper: mkPaper("In GY"),
      seat: 0,
      zone: ZoneType.Graveyard,
    });
    const bfCard = mintCard({ game: g, id: 8402, paper: mkPaper("On BF"), seat: 0 });
    const stat = buildAndRegisterStatic(
      g,
      {
        mode: "CantTarget",
        params: {
          ValidTarget: { kind: "literal", raw: "Card" },
          AffectedZone: { kind: "literal", raw: "Graveyard" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      88400,
      0,
    );
    const r = stat.describe() as Restriction;
    const payload = r.payload as CantTargetPayload;
    // GY-zoned card matches; BF-zoned card does NOT.
    expect(payload.targetMatches(gyCard.id, g)).toBe(true);
    expect(payload.targetMatches(bfCard.id, g)).toBe(false);
    // affectedZones is surfaced explicitly.
    expect(payload.affectedZones).not.toBe("all");
    expect(payload.affectedZones).not.toBeUndefined();
  });

  it("default (no AffectedZone$) keeps the canonical battlefield-only Wave 70.D contract", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 8410, paper: mkPaper("Default guard") });
    const gyCard = mintCard({
      game: g,
      id: 8411,
      paper: mkPaper("In GY"),
      seat: 0,
      zone: ZoneType.Graveyard,
    });
    const bfCard = mintCard({ game: g, id: 8412, paper: mkPaper("On BF"), seat: 0 });
    const stat = buildAndRegisterStatic(
      g,
      {
        mode: "CantTarget",
        params: { ValidTarget: { kind: "literal", raw: "Card" } },
        activeInZones: [],
      },
      src.id as unknown as number,
      88410,
      0,
    );
    const r = stat.describe() as Restriction;
    const payload = r.payload as CantTargetPayload;
    expect(payload.affectedZones).toBeUndefined();
    expect(payload.targetMatches(bfCard.id, g)).toBe(true);
    expect(payload.targetMatches(gyCard.id, g)).toBe(false);
  });

  it("AffectedZone$ All matches every zone the candidate may live in", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 8420, paper: mkPaper("Omni") });
    const gyCard = mintCard({
      game: g,
      id: 8421,
      paper: mkPaper("GY"),
      seat: 0,
      zone: ZoneType.Graveyard,
    });
    const exiled = mintCard({
      game: g,
      id: 8422,
      paper: mkPaper("Exile"),
      seat: 0,
      zone: ZoneType.Exile,
    });
    const stat = buildAndRegisterStatic(
      g,
      {
        mode: "CantTarget",
        params: {
          ValidTarget: { kind: "literal", raw: "Card" },
          AffectedZone: { kind: "literal", raw: "All" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      88420,
      0,
    );
    const r = stat.describe() as Restriction;
    const payload = r.payload as CantTargetPayload;
    expect(payload.affectedZones).toBe("all");
    expect(payload.targetMatches(gyCard.id, g)).toBe(true);
    expect(payload.targetMatches(exiled.id, g)).toBe(true);
  });
});
