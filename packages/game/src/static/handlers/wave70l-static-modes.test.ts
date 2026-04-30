// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 70.L — three more registry-walk gate statics regression tests.
// Covers:
//   - Registration smoke for CantPayLife / MustTarget /
//     ActivateAbilityAsIfHaste.
//   - CantPayLife: cantPayLife helper rejects matched (player, cause)
//     pair; CostPayLife.canPay returns false; CostPayLife.pay throws.
//   - MustTarget: mustTargetCandidates surfaces the eligible-Flagbearer
//     set when the SA matches the gate's ValidSA filter; empty when
//     nothing eligible / no gate.
//   - ActivateAbilityAsIfHaste: canActivateAsIfHaste returns true for
//     matched cards, false for non-matched.
//   - Lifecycle: deactivation reverses each gate.
import type {
  EntityId,
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
import type { CostPaymentContext } from "../../cost/parts/cost-part.js";
import { CostPayLife } from "../../cost/parts/cost-pay-life.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import {
  canActivateAsIfHaste,
  cantPayLife,
  mustTargetCandidates,
} from "../../statics/wave70l-gate-helpers.js";
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

const runAll = <T>(gen: Generator<T, unknown, unknown>): readonly T[] => {
  const out: T[] = [];
  let v = gen.next();
  while (!v.done) {
    out.push(v.value);
    v = gen.next();
  }
  return out;
};

// ── registration smoke ───────────────────────────────────────────────────────
describe("Wave 70.L — registration smoke", () => {
  const modes: readonly StaticAbilityMode[] = ["CantPayLife", "MustTarget", "ActivateAbilityAsIfHaste"];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── CantPayLife — Angel of Jubilation / Karn's Sylex / Yasharn ───────────────
describe("Wave 70.L — CantPayLife", () => {
  it("cantPayLife: rejects matched (player, spell-cause); default permits", () => {
    const g = mkGame();
    // No static — life payment permitted.
    expect(cantPayLife(g, mkPlayerSeat(0), { kind: "spell" })).toBe(false);
    expect(cantPayLife(g, mkPlayerSeat(1), { kind: "ability" })).toBe(false);
    // Stamp Angel-of-Jubilation-shape gate from seat 0:
    //   ValidPlayer$ Player | ValidCause$ Spell,Activated | ForCost$ True.
    buildAndRegister(
      g,
      {
        mode: "CantPayLife",
        params: {
          ValidPlayer: { kind: "literal", raw: "Player" },
          ValidCause: { kind: "literal", raw: "Spell,Activated" },
          ForCost: { kind: "literal", raw: "True" },
        },
        activeInZones: [],
      },
      9000,
      99000,
      0,
    );
    // Both players blocked; both causes blocked.
    expect(cantPayLife(g, mkPlayerSeat(0), { kind: "spell" })).toBe(true);
    expect(cantPayLife(g, mkPlayerSeat(0), { kind: "ability" })).toBe(true);
    expect(cantPayLife(g, mkPlayerSeat(1), { kind: "spell" })).toBe(true);
  });

  it("CostPayLife.canPay returns false when CantPayLife matches", () => {
    const g = mkGame();
    // Plenty of life — only the static should fail it.
    g.getPlayer(mkPlayerSeat(0)).life = 20;
    buildAndRegister(
      g,
      {
        mode: "CantPayLife",
        params: {
          ValidPlayer: { kind: "literal", raw: "Player" },
          ValidCause: { kind: "literal", raw: "Spell,Activated" },
          ForCost: { kind: "literal", raw: "True" },
        },
        activeInZones: [],
      },
      9100,
      99100,
      1, // controllerSeat=1 (any seat works since ValidPlayer$ Player matches all)
    );
    const ctx: CostPaymentContext = {
      game: g,
      payerSeat: mkPlayerSeat(0),
      sourceCardId: mkEntityId(9101),
      raw: "2 life",
      kind: "spell",
    };
    expect(CostPayLife.canPay(ctx)).toBe(false);
  });

  it("CostPayLife.pay throws when CantPayLife matches; succeeds without static", () => {
    const g = mkGame();
    g.getPlayer(mkPlayerSeat(0)).life = 20;
    const ctx: CostPaymentContext = {
      game: g,
      payerSeat: mkPlayerSeat(0),
      sourceCardId: mkEntityId(9201),
      raw: "2 life",
      kind: "spell",
    };
    // Without static — pay succeeds, life decrements.
    {
      const ys = runAll(CostPayLife.pay(ctx));
      // Generator returns receipt; events are yielded along the way.
      void ys;
      expect(g.getPlayer(mkPlayerSeat(0)).life).toBe(18);
    }
    // Stamp gate; pay now throws.
    buildAndRegister(
      g,
      {
        mode: "CantPayLife",
        params: {
          ValidPlayer: { kind: "literal", raw: "Player" },
          ValidCause: { kind: "literal", raw: "Spell,Activated" },
          ForCost: { kind: "literal", raw: "True" },
        },
        activeInZones: [],
      },
      9200,
      99200,
      1,
    );
    expect(() => runAll(CostPayLife.pay(ctx))).toThrow(/CantPayLife/);
    // Life unchanged on the second attempt.
    expect(g.getPlayer(mkPlayerSeat(0)).life).toBe(18);
  });

  it("ForCost$ False disables the gate even when other filters match", () => {
    const g = mkGame();
    buildAndRegister(
      g,
      {
        mode: "CantPayLife",
        params: {
          ValidPlayer: { kind: "literal", raw: "Player" },
          ValidCause: { kind: "literal", raw: "Spell,Activated" },
          ForCost: { kind: "literal", raw: "False" },
        },
        activeInZones: [],
      },
      9300,
      99300,
      0,
    );
    expect(cantPayLife(g, mkPlayerSeat(0), { kind: "spell" })).toBe(false);
  });
});

// ── MustTarget — Coalition Flag / Honor Guard / Standard Bearer ──────────────
describe("Wave 70.L — MustTarget", () => {
  it("mustTargetCandidates: surfaces Flagbearer cards when SA matches", () => {
    const g = mkGame();
    // Create a Flagbearer (we use the same name to drive the simple
    // type-derived match; the static uses a simple subtype-style filter
    // resolved by cardMatchesFilter on the card's types/subtypes).
    const flagbearer = mintCard({
      game: g,
      id: 9400,
      paper: mkPaper("Standard Bearer", "Creature — Human Flagbearer"),
      seat: 0,
    });
    // Stamp the standard Flagbearer-shape gate (controlled by seat 0):
    buildAndRegister(
      g,
      {
        mode: "MustTarget",
        params: {
          ValidSA: { kind: "literal", raw: "Spell.OppCtrl,Activated.OppCtrl" },
          ValidTarget: { kind: "literal", raw: "Flagbearer" },
          ValidZone: { kind: "literal", raw: "Battlefield" },
        },
        activeInZones: [],
      },
      9401,
      99401,
      0,
    );
    // SA controlled by seat 1 (an opponent of seat 0) → matches.
    const candidates = mustTargetCandidates(g, { kind: "spell", controllerSeat: mkPlayerSeat(1) });
    expect(candidates).toContain(flagbearer.id);
    // SA controlled by seat 0 (the static's controller, i.e. NOT an opponent)
    // → no match → no requirement.
    const candidatesYou = mustTargetCandidates(g, {
      kind: "spell",
      controllerSeat: mkPlayerSeat(0),
    });
    expect(candidatesYou.length).toBe(0);
  });

  it("mustTargetCandidates: empty when no candidate exists in zone", () => {
    const g = mkGame();
    // No Flagbearer card minted.
    buildAndRegister(
      g,
      {
        mode: "MustTarget",
        params: {
          ValidSA: { kind: "literal", raw: "Spell.OppCtrl,Activated.OppCtrl" },
          ValidTarget: { kind: "literal", raw: "Flagbearer" },
          ValidZone: { kind: "literal", raw: "Battlefield" },
        },
        activeInZones: [],
      },
      9500,
      99500,
      0,
    );
    expect(mustTargetCandidates(g, { kind: "spell", controllerSeat: mkPlayerSeat(1) }).length).toBe(0);
  });

  it("mustTargetCandidates: no statics → empty result", () => {
    const g = mkGame();
    mintCard({
      game: g,
      id: 9600,
      paper: mkPaper("Some Bear", "Creature — Human Flagbearer"),
      seat: 0,
    });
    expect(mustTargetCandidates(g, { kind: "spell", controllerSeat: mkPlayerSeat(1) }).length).toBe(0);
  });
});

// ── ActivateAbilityAsIfHaste — Thousand-Year Elixir / Dynaheir / Tyvar ───────
describe("Wave 70.L — ActivateAbilityAsIfHaste", () => {
  it("canActivateAsIfHaste: matches creatures controlled by the gate's controller", () => {
    const g = mkGame();
    const myCreature = mintCard({ game: g, id: 9700, paper: mkPaper("My Bear"), seat: 0 });
    const oppCreature = mintCard({ game: g, id: 9701, paper: mkPaper("Opp Bear"), seat: 1 });

    // Default: no static — neither has haste-as-if.
    expect(canActivateAsIfHaste(g, myCreature.id)).toBe(false);
    expect(canActivateAsIfHaste(g, oppCreature.id)).toBe(false);

    // Stamp Thousand-Year Elixir-shape gate (ValidCard$ Creature.YouCtrl).
    buildAndRegister(
      g,
      {
        mode: "ActivateAbilityAsIfHaste",
        params: {
          ValidCard: { kind: "literal", raw: "Creature.YouCtrl" },
        },
        activeInZones: [],
      },
      9702,
      99702,
      0,
    );

    expect(canActivateAsIfHaste(g, myCreature.id)).toBe(true);
    expect(canActivateAsIfHaste(g, oppCreature.id)).toBe(false);
  });

  it("canActivateAsIfHaste: Dynaheir-shape Creature.Other excludes the source itself", () => {
    const g = mkGame();
    const dynaheir = mintCard({
      game: g,
      id: 9800,
      paper: mkPaper("Dynaheir, Invoker Adept", "Legendary Creature — Human Wizard"),
      seat: 0,
    });
    const otherCreature = mintCard({ game: g, id: 9801, paper: mkPaper("Other Bear"), seat: 0 });

    // Stamp the Dynaheir-shape gate. The source-card id is dynaheir.id so
    // "Other" semantics resolve against it.
    buildAndRegister(
      g,
      {
        mode: "ActivateAbilityAsIfHaste",
        params: {
          ValidCard: { kind: "literal", raw: "Creature.Other+YouCtrl" },
        },
        activeInZones: [],
      },
      dynaheir.id as unknown as number,
      99802,
      0,
    );

    // Dynaheir herself: filter is ".Other" (not self) → false.
    expect(canActivateAsIfHaste(g, dynaheir.id)).toBe(false);
    // Other friendly creature → true.
    expect(canActivateAsIfHaste(g, otherCreature.id)).toBe(true);
  });
});

// ── Lifecycle: deactivation reverses each gate ───────────────────────────────
describe("Wave 70.L — lifecycle: deactivation reverses each gate", () => {
  it("unregistering CantPayLife / MustTarget / ActivateAbilityAsIfHaste restores defaults", () => {
    const g = mkGame();
    const flagbearer = mintCard({
      game: g,
      id: 9900,
      paper: mkPaper("Flagbearer Creature", "Creature — Human Flagbearer"),
      seat: 0,
    });
    const bearForHaste = mintCard({ game: g, id: 9901, paper: mkPaper("Friendly Bear"), seat: 0 });

    const sCantPayLife = buildAndRegister(
      g,
      {
        mode: "CantPayLife",
        params: {
          ValidPlayer: { kind: "literal", raw: "Player" },
          ValidCause: { kind: "literal", raw: "Spell,Activated" },
          ForCost: { kind: "literal", raw: "True" },
        },
        activeInZones: [],
      },
      9902,
      99902,
      0,
    );
    const sMustTarget = buildAndRegister(
      g,
      {
        mode: "MustTarget",
        params: {
          ValidSA: { kind: "literal", raw: "Spell.OppCtrl,Activated.OppCtrl" },
          ValidTarget: { kind: "literal", raw: "Flagbearer" },
          ValidZone: { kind: "literal", raw: "Battlefield" },
        },
        activeInZones: [],
      },
      9903,
      99903,
      0,
    );
    const sActHaste = buildAndRegister(
      g,
      {
        mode: "ActivateAbilityAsIfHaste",
        params: {
          ValidCard: { kind: "literal", raw: "Creature.YouCtrl" },
        },
        activeInZones: [],
      },
      9904,
      99904,
      0,
    );

    // All three active.
    expect(cantPayLife(g, mkPlayerSeat(0), { kind: "spell" })).toBe(true);
    expect(mustTargetCandidates(g, { kind: "spell", controllerSeat: mkPlayerSeat(1) })).toContain(
      flagbearer.id,
    );
    expect(canActivateAsIfHaste(g, bearForHaste.id)).toBe(true);

    // Deregister.
    g.staticEffectRegistry.unregister(sCantPayLife.id);
    g.staticEffectRegistry.unregister(sMustTarget.id);
    g.staticEffectRegistry.unregister(sActHaste.id);

    // Defaults restored.
    expect(cantPayLife(g, mkPlayerSeat(0), { kind: "spell" })).toBe(false);
    expect(mustTargetCandidates(g, { kind: "spell", controllerSeat: mkPlayerSeat(1) }).length).toBe(0);
    expect(canActivateAsIfHaste(g, bearForHaste.id)).toBe(false);
  });
});

// Avoid TS6133 unused-import noise for EntityId — used via type args.
void (0 as unknown as EntityId);
