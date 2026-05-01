// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 110 — cross-module TODO(advanced) sweep round 15 regression tests.
//
// Picks closed (one assertion bundle per pick):
//   1. static/handlers/attack-restrict-static.ts — AttackRestrict's
//      `IsPresent$` sub-conditional gate (Mirri, Weatherlight Duelist
//      shape "as long as CARDNAME is tapped, no more than 1 creature
//      can attack you each combat"). Wired via shared
//      buildIsPresentGate; the `exceedsAttackerCap` consumer skips
//      statics whose gate is unsatisfied.
//   2. static/handlers/block-restrict-static.ts — symmetric IsPresent$
//      wiring on the BlockRestrict gate.
//   3. static/handlers/ignore-legend-rule-static.ts — Brothers Yamazaki
//      shape "the legend rule doesn't apply only when EQ2 copies are
//      present". The `isExemptFromLegendRule` consumer now honors the
//      IsPresent$ sub-conditional.
//   4. static/handlers/cant-sacrifice-static.ts — Sigarda's
//      `ValidCause$ SpellAbility.OppCtrl + ForCost$ False` shape: only
//      block opp-driven, effect-driven sacrifices. The `canBeSacrificed`
//      consumer accepts an optional `SacrificeCause` payload.
//   5. static/handlers/cant-exile-static.ts — The Master, Multiplied's
//      `ValidCause$ Triggered.YouCtrl` shape: only block exiles caused
//      by your own triggered abilities. The `canBeExiled` consumer
//      accepts an optional `ExileCause` payload.
//   6. static/handlers/cant-sacrifice-static.ts — Sigarda's
//      `ForCost$ True/False` discriminator (cost-driven vs. effect-driven
//      sacrifice). The same gate's ForCost gate fires independently of
//      ValidCause$.
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
import { Card } from "./card.js";
import type { GameMeta } from "./game-meta.js";
import type { GameRules } from "./game-rules.js";
import { Game } from "./game.js";
import type { AttackRestrictPayload } from "./static/handlers/attack-restrict-static.js";
import type { BlockRestrictPayload } from "./static/handlers/block-restrict-static.js";
import type { IgnoreLegendRulePayload } from "./static/handlers/ignore-legend-rule-static.js";
import { staticHandlerRegistry } from "./static/static-handler.js";
import { canBeSacrificed } from "./statics/wave60-cant-gates.js";
import { isExemptFromLegendRule } from "./statics/wave70j-rule-gates.js";
import { canBeExiled } from "./statics/wave75-gate-helpers.js";
import { Battlefield } from "./zone/zones/battlefield.js";
import { Graveyard } from "./zone/zones/graveyard.js";
import { Hand } from "./zone/zones/hand.js";
import { Library } from "./zone/zones/library.js";
import "./static/handlers/index.js";

// ── shared fixtures ──────────────────────────────────────────────────────────
const alice: LobbyPlayer = { id: "P0", name: "P0", controllerKind: "human" };
const bob: LobbyPlayer = { id: "P1", name: "P1", controllerKind: "human" };

const rules: GameRules = {
  formatId: "standard",
  startingLife: 20,
  startingHandSize: 7,
  mulliganRule: "london",
  firstPlayerSkipsDraw: false,
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
  seed: "wave110",
};

const mkGame = (): Game => {
  const game = new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xfacefeed10n),
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

// ── Pick 1: AttackRestrict IsPresent$ — Mirri, Weatherlight Duelist ─────────
describe("Wave 110 — Pick 1: AttackRestrict IsPresent$ gate (Mirri-shape)", () => {
  it("MaxAttackers cap fires only when IsPresent$ Card.Self+tapped is satisfied", () => {
    const g = mkGame();
    // Stamp the Mirri-shape static: cap of 1 attacker per combat as long
    // as CARDNAME is tapped. The static's source card stays untapped, so
    // the gate is unsatisfied at registration time.
    const mirri = mintCard({ game: g, id: 1010, paper: mkPaper("Mirri") });
    const s = buildAndRegister(
      g,
      {
        mode: "AttackRestrict",
        params: {
          MaxAttackers: { kind: "literal", raw: "1" },
          IsPresent: { kind: "literal", raw: "Card.Self+tapped" },
        },
        activeInZones: [],
      },
      mirri.id as unknown as number,
      11010,
    );
    const payload = s.describe() as AttackRestrictPayload;
    expect(payload.kind).toBe("attackRestrict");
    expect(payload.maxAttackers).toBe(1);
    // Mirri starts untapped → gate not satisfied.
    expect(payload.isPresentSatisfied(g)).toBe(false);
    // Tap Mirri → gate satisfied.
    mirri.tapped = true;
    expect(payload.isPresentSatisfied(g)).toBe(true);
  });

  it("Default (no IsPresent$) treats the gate as always-satisfied", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "AttackRestrict",
        params: {
          MaxAttackers: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      1020,
      11020,
    );
    const payload = s.describe() as AttackRestrictPayload;
    expect(payload.isPresentSatisfied(g)).toBe(true);
  });
});

// ── Pick 2: BlockRestrict IsPresent$ — symmetric to AttackRestrict ──────────
describe("Wave 110 — Pick 2: BlockRestrict IsPresent$ gate", () => {
  it("MaxBlockers cap fires only when IsPresent$ filter is satisfied", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 2010, paper: mkPaper("BlockerCap") });
    const s = buildAndRegister(
      g,
      {
        mode: "BlockRestrict",
        params: {
          MaxBlockers: { kind: "literal", raw: "1" },
          IsPresent: { kind: "literal", raw: "Card.Self+tapped" },
        },
        activeInZones: [],
      },
      src.id as unknown as number,
      12010,
    );
    const payload = s.describe() as BlockRestrictPayload;
    expect(payload.kind).toBe("blockRestrict");
    expect(payload.maxBlockers).toBe(1);
    // src starts untapped → gate not satisfied.
    expect(payload.isPresentSatisfied(g)).toBe(false);
    src.tapped = true;
    expect(payload.isPresentSatisfied(g)).toBe(true);
  });

  it("Default (no IsPresent$) treats the gate as always-satisfied", () => {
    const g = mkGame();
    const s = buildAndRegister(
      g,
      {
        mode: "BlockRestrict",
        params: {
          MaxBlockers: { kind: "literal", raw: "2" },
        },
        activeInZones: [],
      },
      2020,
      12020,
    );
    const payload = s.describe() as BlockRestrictPayload;
    expect(payload.isPresentSatisfied(g)).toBe(true);
  });
});

// ── Pick 3: IgnoreLegendRule IsPresent$ + PresentCompare$ — Brothers Yamazaki ─
describe("Wave 110 — Pick 3: IgnoreLegendRule IsPresent$ gate (Brothers Yamazaki shape)", () => {
  it("Carve-out only fires when EQ2 matching permanents are present (Brothers Yamazaki shape)", () => {
    const g = mkGame();
    // Mint two creature permanents on seat 0's battlefield. The
    // canonical Brothers Yamazaki spelling uses `named` sub-tokens which
    // aren't yet in the cardMatchesFilter grammar; the durable contract
    // here is the IsPresent$ + PresentCompare$ gate, so we use a broader
    // `Creature.YouCtrl` filter to verify the EQ2 gate switches on/off.
    const bro1 = mintCard({ game: g, id: 3010, paper: mkPaper("Bro1") });
    const bro2 = mintCard({ game: g, id: 3011, paper: mkPaper("Bro2") });
    const s = buildAndRegister(
      g,
      {
        mode: "IgnoreLegendRule",
        params: {
          ValidCard: { kind: "literal", raw: "Creature.YouCtrl" },
          IsPresent: { kind: "literal", raw: "Creature.YouCtrl" },
          PresentCompare: { kind: "literal", raw: "EQ2" },
        },
        activeInZones: [],
      },
      bro1.id as unknown as number,
      13010,
    );
    const payload = s.describe() as IgnoreLegendRulePayload;
    expect(payload.kind).toBe("ignoreLegendRule");
    // EQ2 → gate satisfied with both creatures on the battlefield.
    expect(payload.isPresentSatisfied(g)).toBe(true);
    // Both copies are exempt from the legend rule via the consumer gate.
    expect(isExemptFromLegendRule(g, bro1.id)).toBe(true);
    expect(isExemptFromLegendRule(g, bro2.id)).toBe(true);

    // Move bro2 off the battlefield → gate count drops to EQ1, no longer
    // EQ2, so the carve-out vanishes and bro1 becomes subject to the
    // legend rule again.
    g.getPlayer(mkPlayerSeat(0)).zones.get(ZoneType.Battlefield)?.remove(bro2.id);
    bro2.zone = ZoneType.Graveyard;
    g.getPlayer(mkPlayerSeat(0)).zones.get(ZoneType.Graveyard)?.add(bro2.id);
    expect(payload.isPresentSatisfied(g)).toBe(false);
    expect(isExemptFromLegendRule(g, bro1.id)).toBe(false);
  });

  it("Default (no IsPresent$) — Mirror Gallery shape — exempts every legendary", () => {
    const g = mkGame();
    const mg = mintCard({ game: g, id: 3020, paper: mkPaper("Mirror Gallery") });
    const someLegend = mintCard({ game: g, id: 3021, paper: mkPaper("Some Legendary") });
    buildAndRegister(
      g,
      {
        mode: "IgnoreLegendRule",
        params: {},
        activeInZones: [],
      },
      mg.id as unknown as number,
      13020,
    );
    expect(isExemptFromLegendRule(g, someLegend.id)).toBe(true);
  });
});

// ── Pick 4: CantSacrifice ValidCause$ — Sigarda, Host of Herons ─────────────
describe("Wave 110 — Pick 4: CantSacrifice ValidCause$ gate (Sigarda shape)", () => {
  it("ValidCause$ SpellAbility.OppCtrl blocks only opponent-driven sacrifice", () => {
    const g = mkGame();
    // Sigarda controlled by seat 0; her "cant be sacrificed by spells/abs
    // your opponents control" gate fires only when the cause is OppCtrl.
    const creature = mintCard({ game: g, id: 4010, paper: mkPaper("Creature") });
    buildAndRegister(
      g,
      {
        mode: "CantSacrifice",
        params: {
          ValidCard: { kind: "literal", raw: "Creature.YouCtrl" },
          ValidCause: { kind: "literal", raw: "SpellAbility.OppCtrl" },
          ForCost: { kind: "literal", raw: "False" },
        },
        activeInZones: [],
      },
      4011,
      14011,
      0, // Sigarda is controlled by seat 0
    );
    // No cause supplied → gate falls back to legacy behavior (always-fire);
    // matches pre-Wave-110 semantics for callers that haven't been
    // updated to thread cause yet.
    expect(canBeSacrificed(g, creature.id, mkPlayerSeat(0))).toBe(false);

    // Cause from opponent (seat 1) effect → gate fires (sacrifice blocked).
    expect(
      canBeSacrificed(g, creature.id, mkPlayerSeat(0), {
        kind: "effect",
        causeControllerSeat: mkPlayerSeat(1),
      }),
    ).toBe(false);

    // Cause from own (seat 0) effect → gate doesn't fire (sacrifice allowed —
    // Sigarda's controller can still sacrifice their own creatures via
    // their own effects).
    expect(
      canBeSacrificed(g, creature.id, mkPlayerSeat(0), {
        kind: "effect",
        causeControllerSeat: mkPlayerSeat(0),
      }),
    ).toBe(true);
  });
});

// ── Pick 5: CantExile ValidCause$ — The Master, Multiplied ──────────────────
describe("Wave 110 — Pick 5: CantExile ValidCause$ Triggered.YouCtrl (Master Multiplied shape)", () => {
  it("Only blocks exiles caused by your own triggered abilities", () => {
    const g = mkGame();
    // The canonical Master, Multiplied filter is "Creature.YouCtrl+token"
    // — the `token` qualifier is not yet in cardMatchesFilter's grammar,
    // so the durable contract here is the ValidCause$ + ForCost$ gate.
    // We use the broader "Creature.YouCtrl" filter to verify that the
    // gate's cause-classification logic fires correctly per cause kind.
    const creature = mintCard({ game: g, id: 5010, paper: mkPaper("Creature") });
    creature.isToken = true;
    buildAndRegister(
      g,
      {
        mode: "CantExile",
        params: {
          ValidCard: { kind: "literal", raw: "Creature.YouCtrl" },
          ValidCause: { kind: "literal", raw: "Triggered.YouCtrl" },
          ForCost: { kind: "literal", raw: "False" },
        },
        activeInZones: [],
      },
      5011,
      15011,
      0,
    );

    // Cause: triggered ability controlled by seat 0 (you) → blocked.
    expect(
      canBeExiled(g, creature.id, {
        kind: "triggered",
        causeControllerSeat: mkPlayerSeat(0),
      }),
    ).toBe(false);

    // Cause: triggered ability controlled by seat 1 (opponent) → not blocked.
    expect(
      canBeExiled(g, creature.id, {
        kind: "triggered",
        causeControllerSeat: mkPlayerSeat(1),
      }),
    ).toBe(true);

    // Cause: spell/effect (not triggered) controlled by seat 0 → not blocked.
    expect(
      canBeExiled(g, creature.id, {
        kind: "effect",
        causeControllerSeat: mkPlayerSeat(0),
      }),
    ).toBe(true);
  });
});

// ── Pick 6: CantSacrifice ForCost$ — cost-vs-effect discriminator ────────────
describe("Wave 110 — Pick 6: CantSacrifice ForCost$ discriminator", () => {
  it("ForCost$ True blocks only cost-driven sacrifice; effect-driven slips through", () => {
    const g = mkGame();
    const creature = mintCard({ game: g, id: 6010, paper: mkPaper("Creature") });
    buildAndRegister(
      g,
      {
        mode: "CantSacrifice",
        params: {
          ValidCard: { kind: "literal", raw: "Creature.YouCtrl" },
          ForCost: { kind: "literal", raw: "True" },
        },
        activeInZones: [],
      },
      6011,
      16011,
      0,
    );
    // Cost-driven sacrifice → blocked.
    expect(
      canBeSacrificed(g, creature.id, mkPlayerSeat(0), {
        kind: "cost",
        causeControllerSeat: mkPlayerSeat(0),
      }),
    ).toBe(false);
    // Effect-driven sacrifice → not blocked.
    expect(
      canBeSacrificed(g, creature.id, mkPlayerSeat(0), {
        kind: "effect",
        causeControllerSeat: mkPlayerSeat(0),
      }),
    ).toBe(true);
    // Triggered-driven sacrifice → not blocked (kind != "cost").
    expect(
      canBeSacrificed(g, creature.id, mkPlayerSeat(0), {
        kind: "triggered",
        causeControllerSeat: mkPlayerSeat(0),
      }),
    ).toBe(true);
  });

  it("ForCost$ False blocks only effect-driven sacrifice; cost-driven slips through", () => {
    const g = mkGame();
    const creature = mintCard({ game: g, id: 6020, paper: mkPaper("Creature") });
    buildAndRegister(
      g,
      {
        mode: "CantSacrifice",
        params: {
          ValidCard: { kind: "literal", raw: "Creature.YouCtrl" },
          ForCost: { kind: "literal", raw: "False" },
        },
        activeInZones: [],
      },
      6021,
      16021,
      0,
    );
    // Effect-driven sacrifice → blocked.
    expect(
      canBeSacrificed(g, creature.id, mkPlayerSeat(0), {
        kind: "effect",
        causeControllerSeat: mkPlayerSeat(0),
      }),
    ).toBe(false);
    // Triggered-driven sacrifice → blocked too (also non-cost).
    expect(
      canBeSacrificed(g, creature.id, mkPlayerSeat(0), {
        kind: "triggered",
        causeControllerSeat: mkPlayerSeat(0),
      }),
    ).toBe(false);
    // Cost-driven sacrifice → not blocked (Madness payment lane survives).
    expect(
      canBeSacrificed(g, creature.id, mkPlayerSeat(0), {
        kind: "cost",
        causeControllerSeat: mkPlayerSeat(0),
      }),
    ).toBe(true);
  });
});
