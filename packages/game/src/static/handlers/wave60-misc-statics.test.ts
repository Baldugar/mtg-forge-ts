// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.I — three remaining named modes from the Wave 60 roadmap
// (wrap-up batch). Covers:
//   - Registry hookup for ManaConvert / Crew / StartingHandSizeMod
//   - ManaConvert payload exposes the ValidPlayer / ValidCard / ValidSA
//     filters + the raw ManaConversion$ token (Chromatic-Lantern shape)
//   - Crew static stamps `card.crewStaticActive = true`
//   - StartingHandSizeMod stamps the additive accumulator on Player.
//   - Lifecycle: deactivation reverses each per-card / per-player slot.
import type { LobbyPlayer, PaperCard, StaticAbility, StaticAbilityMode, StaticAst } from "@mtg-forge-ts/core";
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
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { staticHandlerRegistry } from "../static-handler.js";
import type { CrewStaticPayload } from "./crew-static.js";
import { _clearCrewStaticFlag } from "./crew-static.js";
import type { ManaConvertPayload } from "./mana-convert-static.js";
import type { StartingHandSizeModPayload } from "./starting-hand-size-mod-static.js";
import { _revertStartingHandSizeMod } from "./starting-hand-size-mod-static.js";
// Side-effect: the barrel registers every Wave-60 handler.
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

const mkPaper = (name: string, types = "Artifact"): PaperCard => ({
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
    manaCost: { raw: "3", symbols: [] },
    pt: { power: "0", toughness: "0" },
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
  const seat = mkPlayerSeat(opts.seat ?? 0);
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

// ── registration smoke ───────────────────────────────────────────────────────
describe("Wave 60.I — registration smoke", () => {
  const modes: readonly StaticAbilityMode[] = ["ManaConvert", "Crew", "StartingHandSizeMod"];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── ManaConvert ──────────────────────────────────────────────────────────────
describe("Wave 60.I — ManaConvert", () => {
  it("payload exposes ValidPlayer / ValidSA / ManaConversion for the Chromatic-Orrery shape", () => {
    const g = mkGame();
    // S:Mode$ ManaConvert | ValidPlayer$ You | ValidSA$ Spell,Activated
    //   | ManaConversion$ AnyType->AnyColor
    const orrery = mintCard({ game: g, id: 5100, paper: mkPaper("Test Orrery") });
    const s = buildAndRegister(
      g,
      {
        mode: "ManaConvert",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          ValidSA: { kind: "literal", raw: "Spell,Activated" },
          ManaConversion: { kind: "literal", raw: "AnyType->AnyColor" },
        },
        activeInZones: [],
      },
      orrery.id as unknown as number,
      95100,
      0,
    );
    const payload = s.describe() as ManaConvertPayload;
    expect(payload.kind).toBe("manaConvert");
    expect(payload.playerMatches(mkPlayerSeat(0))).toBe(true);
    expect(payload.playerMatches(mkPlayerSeat(1))).toBe(false);
    expect(payload.validSaRaw).toBe("Spell,Activated");
    expect(payload.conversionRaw).toBe("AnyType->AnyColor");
  });

  it("ValidCard$ Card.Self only matches the static's source card", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 5110, paper: mkPaper("Test Activator") });
    const other = mintCard({ game: g, id: 5111, paper: mkPaper("Test Other") });
    const s = buildAndRegister(
      g,
      {
        mode: "ManaConvert",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          ValidCard: { kind: "literal", raw: "Card.Self" },
          ManaConversion: { kind: "literal", raw: "AnyType->AnyColor" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      95110,
      0,
    );
    const payload = s.describe() as ManaConvertPayload;
    expect(payload.cardMatches(src.id, g)).toBe(true);
    expect(payload.cardMatches(other.id, g)).toBe(false);
  });

  it("accepts the kickoff-prompt's ManaTypes$ alias when ManaConversion$ is missing", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 5120, paper: mkPaper("Test Lantern") });
    const s = buildAndRegister(
      g,
      {
        mode: "ManaConvert",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          // Forge's canonical param name is ManaConversion; the kickoff
          // prompt also documents ManaTypes — verify both shapes flow.
          ManaTypes: { kind: "literal", raw: "Any" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      95120,
      0,
    );
    const payload = s.describe() as ManaConvertPayload;
    expect(payload.conversionRaw).toBe("Any");
  });

  it("registry walk surfaces the active static via byMode('ManaConvert')", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 5130, paper: mkPaper("Test Mana") });
    buildAndRegister(
      g,
      {
        mode: "ManaConvert",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          ManaConversion: { kind: "literal", raw: "AnyType->AnyColor" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      95130,
      0,
    );
    const entries = g.staticEffectRegistry.byMode("ManaConvert");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.mode).toBe("ManaConvert");
  });
});

// ── Crew (static form) ───────────────────────────────────────────────────────
describe("Wave 60.I — Crew (static)", () => {
  it("stamps `card.crewStaticActive = true` on activate (Card.Self default)", () => {
    const g = mkGame();
    const vehicle = mintCard({ game: g, id: 5200, paper: mkPaper("Test Vehicle", "Artifact — Vehicle") });
    expect(vehicle.crewStaticActive).toBeUndefined();
    buildAndRegister(
      g,
      {
        mode: "Crew",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Power: { kind: "literal", raw: "3" },
        },
        activeInZones: [],
      },
      vehicle.id as unknown as number,
      95200,
      0,
    );
    expect(vehicle.crewStaticActive).toBe(true);
  });

  it("payload exposes the Power$ threshold", () => {
    const g = mkGame();
    const vehicle = mintCard({ game: g, id: 5210, paper: mkPaper("Test Vehicle 2", "Artifact — Vehicle") });
    const s = buildAndRegister(
      g,
      {
        mode: "Crew",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Power: { kind: "literal", raw: "5" },
        },
        activeInZones: [],
      },
      vehicle.id as unknown as number,
      95210,
      0,
    );
    const payload = s.describe() as CrewStaticPayload;
    expect(payload.kind).toBe("crewStatic");
    expect(payload.power).toBe(5);
  });

  it("_clearCrewStaticFlag reverses the per-card flag", () => {
    const g = mkGame();
    const vehicle = mintCard({ game: g, id: 5220, paper: mkPaper("Test Vehicle 3", "Artifact — Vehicle") });
    buildAndRegister(
      g,
      {
        mode: "Crew",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Power: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      vehicle.id as unknown as number,
      95220,
      0,
    );
    expect(vehicle.crewStaticActive).toBe(true);
    _clearCrewStaticFlag(g, vehicle.id as unknown as number);
    expect(vehicle.crewStaticActive).toBeUndefined();
  });
});

// ── StartingHandSizeMod ──────────────────────────────────────────────────────
describe("Wave 60.I — StartingHandSizeMod", () => {
  it("stamps Player.startingHandSizeMod on activate (positive shape)", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 5300, paper: mkPaper("Test Emblem") });
    expect(g.getPlayer(mkPlayerSeat(0)).startingHandSizeMod).toBe(0);
    buildAndRegister(
      g,
      {
        mode: "StartingHandSizeMod",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Amount: { kind: "literal", raw: "+1" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      95300,
      0,
    );
    expect(g.getPlayer(mkPlayerSeat(0)).startingHandSizeMod).toBe(1);
    // Opponent seat untouched.
    expect(g.getPlayer(mkPlayerSeat(1)).startingHandSizeMod).toBe(0);
  });

  it("stamps the negative Yawgmoth's-Bargain-style modifier", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 5310, paper: mkPaper("Test YB Emblem") });
    buildAndRegister(
      g,
      {
        mode: "StartingHandSizeMod",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Amount: { kind: "literal", raw: "-7" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      95310,
      0,
    );
    expect(g.getPlayer(mkPlayerSeat(0)).startingHandSizeMod).toBe(-7);
  });

  it("multiple active statics stack additively", () => {
    const g = mkGame();
    const e1 = mintCard({ game: g, id: 5320, paper: mkPaper("Test E1") });
    const e2 = mintCard({ game: g, id: 5321, paper: mkPaper("Test E2") });
    buildAndRegister(
      g,
      {
        mode: "StartingHandSizeMod",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Amount: { kind: "literal", raw: "+2" },
        },
        activeInZones: [],
      },
      e1.id as unknown as number,
      95320,
      0,
    );
    buildAndRegister(
      g,
      {
        mode: "StartingHandSizeMod",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Amount: { kind: "literal", raw: "+1" },
        },
        activeInZones: [],
      },
      e2.id as unknown as number,
      95321,
      0,
    );
    expect(g.getPlayer(mkPlayerSeat(0)).startingHandSizeMod).toBe(3);
  });

  it("_revertStartingHandSizeMod reverses the per-player accumulator", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 5330, paper: mkPaper("Test Reverse") });
    const s = buildAndRegister(
      g,
      {
        mode: "StartingHandSizeMod",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Amount: { kind: "literal", raw: "+3" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      95330,
      0,
    );
    expect(g.getPlayer(mkPlayerSeat(0)).startingHandSizeMod).toBe(3);
    const payload = s.describe() as StartingHandSizeModPayload;
    _revertStartingHandSizeMod(g, payload.playerMatches, payload.amount);
    expect(g.getPlayer(mkPlayerSeat(0)).startingHandSizeMod).toBe(0);
  });
});
