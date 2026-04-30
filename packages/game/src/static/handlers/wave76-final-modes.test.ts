// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 76 — final small static-mode batch regression tests.
// Covers:
//   - Registration smoke for CantBeSuspected / CantVenture / PlotZone /
//     GainLifeRadiation. CantBeSuspected is wired into the Suspect
//     mechanic (Wave 71); the other three are forward-compat stubs
//     until their underlying mechanic infra (Venture / Plot /
//     Radiation counter) lands.
//   - CantBeSuspected: canBeSuspected helper true-by-default; false
//     when ValidCard$ Card.Self matches; SuspectEffect.resolve refuses
//     the suspect transition for a matched card.
//   - CantVenture:     canVenture helper true-by-default; false when
//     ValidPlayer$ You matches the candidate player.
//   - PlotZone:        plotZonesFor returns {Hand} by default; adds
//     the matched static's Zone$ on match.
//   - GainLifeRadiation: radiationLifeMod returns 0 by default; sums
//     Amount$ across matching statics.
//   - Lifecycle: deactivation reverses each gate.
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
import { SpellAbility } from "../../ability/spell-ability.js";
import "../../ability/effects/index.js";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import {
  canBeSuspected,
  canVenture,
  plotZonesFor,
  radiationLifeMod,
} from "../../statics/wave76-gate-helpers.js";
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

// ── registration smoke ───────────────────────────────────────────────────────
describe("Wave 76 — registration smoke", () => {
  const modes: readonly StaticAbilityMode[] = [
    "CantBeSuspected",
    "CantVenture",
    "PlotZone",
    "GainLifeRadiation",
  ];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── CantBeSuspected ──────────────────────────────────────────────────────────
describe("Wave 76 — CantBeSuspected (forward-compat stub)", () => {
  it("canBeSuspected true-by-default; false on Card.Self match", () => {
    const g = mkGame();
    const protectedCard = mintCard({
      game: g,
      id: 9000,
      paper: mkPaper("Suspect Immune"),
      seat: 0,
    });
    const otherCard = mintCard({
      game: g,
      id: 9001,
      paper: mkPaper("Other Bear"),
      seat: 0,
    });

    expect(canBeSuspected(g, protectedCard.id)).toBe(true);
    expect(canBeSuspected(g, otherCard.id)).toBe(true);

    buildAndRegister(
      g,
      {
        mode: "CantBeSuspected",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      protectedCard.id as unknown as number,
      79000,
      0,
    );

    expect(canBeSuspected(g, protectedCard.id)).toBe(false);
    expect(canBeSuspected(g, otherCard.id)).toBe(true);
  });

  it("SuspectEffect refuses suspect transition for matched card (wired consumer)", () => {
    const g = mkGame();
    const protectedCard = mintCard({
      game: g,
      id: 9050,
      paper: mkPaper("Suspect Immune"),
      seat: 0,
    });
    expect(protectedCard.suspected).toBeUndefined();

    // Stamp the gate.
    buildAndRegister(
      g,
      {
        mode: "CantBeSuspected",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      protectedCard.id as unknown as number,
      79050,
      0,
    );

    // Drive AB$ Suspect against the protected card.
    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: { handlerKey: "Suspect", params: {} },
        cost: { raw: "" },
      },
      mkEntityId(9051),
      mkPlayerSeat(0),
      new Map(),
      [protectedCard.id],
    );
    const gen = sa.makeResolver().resolve(g) as Generator<unknown, void, unknown>;
    while (!gen.next().done) {
      // drain
    }
    // Gate held — no suspect transition.
    expect(protectedCard.suspected).toBeUndefined();
  });
});

// ── CantVenture ──────────────────────────────────────────────────────────────
describe("Wave 76 — CantVenture (forward-compat stub)", () => {
  it("canVenture true-by-default; false when ValidPlayer$ You matches", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);

    expect(canVenture(g, seat0)).toBe(true);
    expect(canVenture(g, seat1)).toBe(true);

    buildAndRegister(
      g,
      {
        mode: "CantVenture",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      9100,
      79100,
      0, // controller seat 0 → "You" resolves to seat 0
    );

    expect(canVenture(g, seat0)).toBe(false);
    expect(canVenture(g, seat1)).toBe(true);
  });
});

// ── PlotZone ─────────────────────────────────────────────────────────────────
describe("Wave 76 — PlotZone (forward-compat stub)", () => {
  it("plotZonesFor returns {Hand} by default", () => {
    const g = mkGame();
    const zones = plotZonesFor(g, mkPlayerSeat(0));
    expect(zones.has(ZoneType.Hand)).toBe(true);
    expect(zones.size).toBe(1);
  });

  it("plotZonesFor adds Zone$ on match (Graveyard)", () => {
    const g = mkGame();

    buildAndRegister(
      g,
      {
        mode: "PlotZone",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Zone: { kind: "literal", raw: "Graveyard" },
        },
        activeInZones: [],
      },
      9200,
      79200,
      0,
    );

    const zonesP0 = plotZonesFor(g, mkPlayerSeat(0));
    expect(zonesP0.has(ZoneType.Hand)).toBe(true);
    expect(zonesP0.has(ZoneType.Graveyard)).toBe(true);

    // Other seat — only the default Hand.
    const zonesP1 = plotZonesFor(g, mkPlayerSeat(1));
    expect(zonesP1.has(ZoneType.Hand)).toBe(true);
    expect(zonesP1.has(ZoneType.Graveyard)).toBe(false);
  });
});

// ── GainLifeRadiation ────────────────────────────────────────────────────────
describe("Wave 76 — GainLifeRadiation (forward-compat stub)", () => {
  it("radiationLifeMod 0 by default", () => {
    const g = mkGame();
    expect(radiationLifeMod(g, mkPlayerSeat(0))).toBe(0);
    expect(radiationLifeMod(g, mkPlayerSeat(1))).toBe(0);
  });

  it("radiationLifeMod sums Amount$ across matching statics", () => {
    const g = mkGame();

    buildAndRegister(
      g,
      {
        mode: "GainLifeRadiation",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Amount: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      9300,
      79300,
      0,
    );
    buildAndRegister(
      g,
      {
        mode: "GainLifeRadiation",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Amount: { kind: "literal", raw: "3" },
        },
        activeInZones: [],
      },
      9301,
      79301,
      0,
    );

    expect(radiationLifeMod(g, mkPlayerSeat(0))).toBe(5);
    // Seat 1 doesn't match the ValidPlayer$ You (controller seat 0).
    expect(radiationLifeMod(g, mkPlayerSeat(1))).toBe(0);
  });

  it("radiationLifeMod default Amount$ is 1 when omitted", () => {
    const g = mkGame();
    buildAndRegister(
      g,
      {
        mode: "GainLifeRadiation",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      9400,
      79400,
      0,
    );
    expect(radiationLifeMod(g, mkPlayerSeat(0))).toBe(1);
  });
});

// ── Lifecycle ────────────────────────────────────────────────────────────────
describe("Wave 76 — lifecycle: deactivation reverses each gate", () => {
  it("unregistering each Wave 76 static restores defaults", () => {
    const g = mkGame();
    const protectedCard = mintCard({
      game: g,
      id: 9500,
      paper: mkPaper("Suspect Immune"),
      seat: 0,
    });
    const seat0 = mkPlayerSeat(0);

    const sCantBeSuspected = buildAndRegister(
      g,
      {
        mode: "CantBeSuspected",
        params: { ValidCard: { kind: "literal", raw: "Card.Self" } },
        activeInZones: [],
      },
      protectedCard.id as unknown as number,
      79500,
      0,
    );
    const sCantVenture = buildAndRegister(
      g,
      {
        mode: "CantVenture",
        params: { ValidPlayer: { kind: "literal", raw: "You" } },
        activeInZones: [],
      },
      9501,
      79501,
      0,
    );
    const sPlotZone = buildAndRegister(
      g,
      {
        mode: "PlotZone",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Zone: { kind: "literal", raw: "Graveyard" },
        },
        activeInZones: [],
      },
      9502,
      79502,
      0,
    );
    const sGainLifeRadiation = buildAndRegister(
      g,
      {
        mode: "GainLifeRadiation",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Amount: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      9503,
      79503,
      0,
    );

    // All four gates active.
    expect(canBeSuspected(g, protectedCard.id)).toBe(false);
    expect(canVenture(g, seat0)).toBe(false);
    expect(plotZonesFor(g, seat0).has(ZoneType.Graveyard)).toBe(true);
    expect(radiationLifeMod(g, seat0)).toBe(2);

    // Unregister; each gate releases.
    g.staticEffectRegistry.unregister(sCantBeSuspected.id);
    g.staticEffectRegistry.unregister(sCantVenture.id);
    g.staticEffectRegistry.unregister(sPlotZone.id);
    g.staticEffectRegistry.unregister(sGainLifeRadiation.id);

    expect(canBeSuspected(g, protectedCard.id)).toBe(true);
    expect(canVenture(g, seat0)).toBe(true);
    expect(plotZonesFor(g, seat0).has(ZoneType.Graveyard)).toBe(false);
    expect(plotZonesFor(g, seat0).has(ZoneType.Hand)).toBe(true);
    expect(radiationLifeMod(g, seat0)).toBe(0);
  });
});
