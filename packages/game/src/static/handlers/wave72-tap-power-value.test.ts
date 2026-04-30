// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 72 — TapPowerValue static mode regression tests.
// Covers:
//   - Registration smoke for TapPowerValue.
//   - Filter match: vehicle pilot's Self filter substitutes only own
//     contribution; non-matching creatures use printed power.
//   - Value$ Toughness path returns useToughness=true.
//   - Value$ N path returns mod=N.
//   - ValidSA$ Activated.Crew+Vehicle filters by activation kind AND
//     activation source-type.
//   - Lifecycle: deregister returns to printed-power contribution.
import type {
  LobbyPlayer,
  ManaCostAst,
  PaperCard,
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
import { effectiveTapPowerValue } from "../../statics/wave72-tap-power-value.js";
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

const mkPaper = (
  name: string,
  types = "Creature — Bear",
  manaCostRaw = "1G",
  pt: { power: string; toughness: string } | undefined = { power: "2", toughness: "5" },
): PaperCard => {
  return {
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
      manaCost: { raw: manaCostRaw, symbols: [] } satisfies ManaCostAst,
      ...(pt ? { pt } : {}),
      abilities: [],
      triggers: [],
      replacements: [],
      statics: [],
      keywords: [],
      svars: new Map(),
    },
  };
};

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
describe("Wave 72 — registration smoke", () => {
  it("mode 'TapPowerValue' is registered", () => {
    expect(staticHandlerRegistry.has("TapPowerValue")).toBe(true);
  });
});

// ── filter match: integer modifier shape ─────────────────────────────────────
describe("Wave 72 — TapPowerValue (Value$ N)", () => {
  it("Hotshot Mechanic shape: Self pilot crews vehicles as if power were +2", () => {
    const g = mkGame();
    // Seat 0 controls a Vehicle and the pilot creature.
    const vehicle = mintCard({
      game: g,
      id: 7200,
      paper: mkPaper("Vehicle Bot", "Artifact — Vehicle", "3", { power: "4", toughness: "4" }),
      seat: 0,
    });
    const pilot = mintCard({ game: g, id: 7201, paper: mkPaper("Hotshot Mechanic"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "TapPowerValue",
        params: {
          ValidSA: { kind: "literal", raw: "Activated.Crew+Vehicle" },
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Value: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      pilot.id as unknown as number,
      97200,
    );
    const tpv = effectiveTapPowerValue(g, pilot.id, {
      saKind: "Crew",
      activatingSourceId: vehicle.id,
    });
    expect(tpv).not.toBeNull();
    expect(tpv?.useToughness).toBe(false);
    expect(tpv?.mod).toBe(2);
  });

  it("filter mismatch: another creature without a TapPowerValue static returns null", () => {
    const g = mkGame();
    const vehicle = mintCard({
      game: g,
      id: 7210,
      paper: mkPaper("Vehicle Bot", "Artifact — Vehicle", "3", { power: "4", toughness: "4" }),
      seat: 0,
    });
    const pilot = mintCard({ game: g, id: 7211, paper: mkPaper("Hotshot Mechanic"), seat: 0 });
    const plain = mintCard({ game: g, id: 7212, paper: mkPaper("Random Bear"), seat: 0 });
    // Static targets only the pilot (Card.Self).
    buildAndRegister(
      g,
      {
        mode: "TapPowerValue",
        params: {
          ValidSA: { kind: "literal", raw: "Activated.Crew+Vehicle" },
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Value: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      pilot.id as unknown as number,
      97211,
    );
    // Plain Bear is not the source; effectiveTapPowerValue returns null.
    expect(
      effectiveTapPowerValue(g, plain.id, {
        saKind: "Crew",
        activatingSourceId: vehicle.id,
      }),
    ).toBeNull();
  });

  it("Cloudspire Captain shape: any creature you control gets +2 for crew/saddle", () => {
    const g = mkGame();
    const vehicle = mintCard({
      game: g,
      id: 7220,
      paper: mkPaper("Vehicle Bot", "Artifact — Vehicle", "3", { power: "4", toughness: "4" }),
      seat: 0,
    });
    const captain = mintCard({ game: g, id: 7221, paper: mkPaper("Cloudspire Captain"), seat: 0 });
    const ally = mintCard({ game: g, id: 7222, paper: mkPaper("Ally Bear"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "TapPowerValue",
        params: {
          ValidSA: { kind: "literal", raw: "Activated.Saddle+Mount,Activated.Crew+Vehicle" },
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Value: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      captain.id as unknown as number,
      97221,
    );
    // The captain itself benefits.
    const tpvCaptain = effectiveTapPowerValue(g, captain.id, {
      saKind: "Crew",
      activatingSourceId: vehicle.id,
    });
    expect(tpvCaptain?.mod).toBe(2);
    // The ally is NOT the static's host, so Card.Self filter rejects.
    const tpvAlly = effectiveTapPowerValue(g, ally.id, {
      saKind: "Crew",
      activatingSourceId: vehicle.id,
    });
    expect(tpvAlly).toBeNull();
  });
});

// ── Value$ Toughness path (Giant Ox / Interface Ace shape) ───────────────────
describe("Wave 72 — TapPowerValue (Value$ Toughness)", () => {
  it("Giant Ox shape: useToughness=true substitutes toughness for power in crew", () => {
    const g = mkGame();
    const vehicle = mintCard({
      game: g,
      id: 7300,
      paper: mkPaper("Vehicle Bot", "Artifact — Vehicle", "3", { power: "4", toughness: "4" }),
      seat: 0,
    });
    // Giant Ox is 0/6 — printed power 0, toughness 6.
    const ox = mintCard({
      game: g,
      id: 7301,
      paper: mkPaper("Giant Ox", "Creature — Ox", "1G", { power: "0", toughness: "6" }),
      seat: 0,
    });
    buildAndRegister(
      g,
      {
        mode: "TapPowerValue",
        params: {
          ValidSA: { kind: "literal", raw: "Activated.Crew+Vehicle" },
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Value: { kind: "literal", raw: "Toughness" },
        },
        activeInZones: [],
      },
      ox.id as unknown as number,
      97301,
    );
    const tpv = effectiveTapPowerValue(g, ox.id, {
      saKind: "Crew",
      activatingSourceId: vehicle.id,
    });
    expect(tpv?.useToughness).toBe(true);
    expect(tpv?.mod).toBe(0);
  });
});

// ── ValidSA$ kind / source-type filtering ────────────────────────────────────
describe("Wave 72 — ValidSA$ filter", () => {
  it("Crew+Vehicle filter rejects Saddle+Mount activation", () => {
    const g = mkGame();
    const vehicle = mintCard({
      game: g,
      id: 7400,
      paper: mkPaper("Vehicle Bot", "Artifact — Vehicle", "3", { power: "4", toughness: "4" }),
      seat: 0,
    });
    const mount = mintCard({
      game: g,
      id: 7401,
      paper: mkPaper("Mount Bot", "Creature — Mount Horse", "2", { power: "2", toughness: "2" }),
      seat: 0,
    });
    const pilot = mintCard({ game: g, id: 7402, paper: mkPaper("Hotshot Mechanic"), seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "TapPowerValue",
        params: {
          ValidSA: { kind: "literal", raw: "Activated.Crew+Vehicle" },
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Value: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      pilot.id as unknown as number,
      97402,
    );
    // Crew on a Vehicle: matches.
    expect(
      effectiveTapPowerValue(g, pilot.id, {
        saKind: "Crew",
        activatingSourceId: vehicle.id,
      })?.mod,
    ).toBe(2);
    // Saddle on a Mount: does NOT match (kind mismatch).
    expect(
      effectiveTapPowerValue(g, pilot.id, {
        saKind: "Saddle",
        activatingSourceId: mount.id,
      }),
    ).toBeNull();
  });
});

// ── aggregate / Forge-style multi-static stacking ────────────────────────────
describe("Wave 72 — aggregate behavior", () => {
  it("integer modifiers from multiple matching statics stack additively", () => {
    const g = mkGame();
    const vehicle = mintCard({
      game: g,
      id: 7600,
      paper: mkPaper("Vehicle Bot", "Artifact — Vehicle", "3", { power: "4", toughness: "4" }),
      seat: 0,
    });
    const pilot = mintCard({ game: g, id: 7601, paper: mkPaper("Stacked Pilot"), seat: 0 });
    // Two statics, both Card.Self, +2 each.
    buildAndRegister(
      g,
      {
        mode: "TapPowerValue",
        params: {
          ValidSA: { kind: "literal", raw: "Activated.Crew+Vehicle" },
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Value: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      pilot.id as unknown as number,
      97601,
    );
    buildAndRegister(
      g,
      {
        mode: "TapPowerValue",
        params: {
          ValidSA: { kind: "literal", raw: "Activated.Crew+Vehicle" },
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Value: { kind: "literal", raw: "1" },
        },
        activeInZones: [],
      },
      pilot.id as unknown as number,
      97602,
    );
    const tpv = effectiveTapPowerValue(g, pilot.id, {
      saKind: "Crew",
      activatingSourceId: vehicle.id,
    });
    expect(tpv?.useToughness).toBe(false);
    expect(tpv?.mod).toBe(3);
  });

  it("Toughness path takes precedence over integer modifiers (Forge: withToughness short-circuits getMod)", () => {
    const g = mkGame();
    const vehicle = mintCard({
      game: g,
      id: 7610,
      paper: mkPaper("Vehicle Bot", "Artifact — Vehicle", "3", { power: "4", toughness: "4" }),
      seat: 0,
    });
    const ox = mintCard({
      game: g,
      id: 7611,
      paper: mkPaper("Hybrid Ox", "Creature — Ox", "1G", { power: "0", toughness: "6" }),
      seat: 0,
    });
    // Toughness static.
    buildAndRegister(
      g,
      {
        mode: "TapPowerValue",
        params: {
          ValidSA: { kind: "literal", raw: "Activated.Crew+Vehicle" },
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Value: { kind: "literal", raw: "Toughness" },
        },
        activeInZones: [],
      },
      ox.id as unknown as number,
      97611,
    );
    // +N modifier static (would normally add 2).
    buildAndRegister(
      g,
      {
        mode: "TapPowerValue",
        params: {
          ValidSA: { kind: "literal", raw: "Activated.Crew+Vehicle" },
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Value: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      ox.id as unknown as number,
      97612,
    );
    const tpv = effectiveTapPowerValue(g, ox.id, {
      saKind: "Crew",
      activatingSourceId: vehicle.id,
    });
    expect(tpv?.useToughness).toBe(true);
    expect(tpv?.mod).toBe(0);
  });
});

// ── lifecycle ────────────────────────────────────────────────────────────────
describe("Wave 72 — lifecycle", () => {
  it("deregister returns the creature to printed-power contribution", () => {
    const g = mkGame();
    const vehicle = mintCard({
      game: g,
      id: 7500,
      paper: mkPaper("Vehicle Bot", "Artifact — Vehicle", "3", { power: "4", toughness: "4" }),
      seat: 0,
    });
    const pilot = mintCard({ game: g, id: 7501, paper: mkPaper("Hotshot Mechanic"), seat: 0 });
    const s = buildAndRegister(
      g,
      {
        mode: "TapPowerValue",
        params: {
          ValidSA: { kind: "literal", raw: "Activated.Crew+Vehicle" },
          ValidCard: { kind: "literal", raw: "Card.Self" },
          Value: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      pilot.id as unknown as number,
      97501,
    );
    expect(
      effectiveTapPowerValue(g, pilot.id, {
        saKind: "Crew",
        activatingSourceId: vehicle.id,
      })?.mod,
    ).toBe(2);
    g.staticEffectRegistry.unregister(s.id);
    expect(
      effectiveTapPowerValue(g, pilot.id, {
        saKind: "Crew",
        activatingSourceId: vehicle.id,
      }),
    ).toBeNull();
  });
});
