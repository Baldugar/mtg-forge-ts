// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 78 — BlockTapped + FlipCoinMod + Devotion (final enum statics)
// regression tests. Covers:
//   - Registration smoke for all three modes.
//   - BlockTapped: tapped creature passes block validation when matching
//     static is in force (Masako shape); without the static, tapped
//     creatures are rejected; non-matched tapped creatures still rejected.
//   - FlipCoinMod: forced-heads / forced-tails dictate FlipACoinEffect's
//     outcome regardless of RNG; double-flip-pick prefers heads.
//   - Devotion: per-player Amount$ (Altar shape) adds to every queried
//     color; per-card DevotionMod$ adds to filtered cards' contribution
//     for the queried color.
//   - Lifecycle: deactivation reverses each gate.
import type {
  AbilityAst,
  LobbyPlayer,
  ManaCostAst,
  ManaCostJSON,
  PaperCard,
  PlayerSeat,
  StaticAbility,
  StaticAbilityMode,
  StaticAst,
} from "@mtg-forge-ts/core";
import {
  Color,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaCost,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import "../../ability/effects/index.js";
import { SpellAbility } from "../../ability/spell-ability.js";
import type { EngineYield } from "../../action/engine-yield.js";
import { Card } from "../../card.js";
import { isBlockLegal } from "../../combat/keywords/block-restrictions.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import {
  canBlockWhileTapped,
  devotionModifierFor,
  flipCoinModifier,
} from "../../statics/wave78-gate-helpers.js";
import "../../svar/selectors/wave42-selectors.js";
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

const paper: PaperCard = {
  name: "T",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkManaCostAst = (raw: string): ManaCostAst => {
  const j: ManaCostJSON = ManaCost.parse(raw).toJSON();
  return { raw, symbols: j.symbols };
};

const mkPaperWithCost = (name: string, typeLine: string, manaCostRaw: string): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "1",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: {
    name,
    oracle: "",
    types: TypeLine.parse(typeLine),
    manaCost: mkManaCostAst(manaCostRaw),
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars: new Map(),
  },
});

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

interface MintOpts {
  readonly game: Game;
  readonly id: number;
  readonly seat?: 0 | 1;
  readonly zone?: ZoneType;
  readonly paper?: PaperCard;
}
const mintCard = (opts: MintOpts): Card => {
  const cid = mkEntityId(opts.id);
  const seat: PlayerSeat = mkPlayerSeat(opts.seat ?? 0);
  const card = new Card(cid, opts.paper ?? paper, seat, seat, opts.zone ?? ZoneType.Battlefield);
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

const drain = (g: Generator<EngineYield, void, unknown>): EngineYield[] => {
  const out: EngineYield[] = [];
  let s = g.next();
  while (!s.done) {
    out.push(s.value);
    s = g.next();
  }
  return out;
};

// ── registration smoke ───────────────────────────────────────────────────────
describe("Wave 78 — registration smoke", () => {
  const modes: readonly StaticAbilityMode[] = ["BlockTapped", "FlipCoinMod", "Devotion"];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── BlockTapped ──────────────────────────────────────────────────────────────
describe("Wave 78 — BlockTapped (Masako shape)", () => {
  it("without static: tapped blocker fails block validation", () => {
    const g = mkGame();
    const blocker = mintCard({ game: g, id: 7800, seat: 0 });
    const attacker = mintCard({ game: g, id: 7801, seat: 1 });
    blocker.tapped = true;
    expect(canBlockWhileTapped(g, blocker.id)).toBe(false);
    const result = isBlockLegal(g, blocker.id, attacker.id, [blocker.id]);
    expect(result.legal).toBe(false);
    expect(result.reason).toContain("tapped");
  });

  it("with matching static: tapped blocker passes block validation", () => {
    const g = mkGame();
    const blocker = mintCard({ game: g, id: 7810, seat: 0 });
    const attacker = mintCard({ game: g, id: 7811, seat: 1 });
    blocker.tapped = true;
    // Matches all your creatures.
    buildAndRegister(
      g,
      {
        mode: "BlockTapped",
        params: { ValidCard: { kind: "literal", raw: "Card.YouCtrl" } },
        activeInZones: [],
      },
      7812,
      97812,
      0,
    );
    expect(canBlockWhileTapped(g, blocker.id)).toBe(true);
    expect(isBlockLegal(g, blocker.id, attacker.id, [blocker.id]).legal).toBe(true);
  });

  it("filter: non-matched tapped blocker still rejected", () => {
    const g = mkGame();
    // Static controlled by seat 0; ValidCard$ Card.YouCtrl matches only
    // seat-0 cards. Seat 1's tapped blocker does NOT match.
    const matched = mintCard({ game: g, id: 7820, seat: 0 });
    const unmatched = mintCard({ game: g, id: 7821, seat: 1 });
    const attacker = mintCard({ game: g, id: 7822, seat: 0 });
    matched.tapped = true;
    unmatched.tapped = true;
    buildAndRegister(
      g,
      {
        mode: "BlockTapped",
        params: { ValidCard: { kind: "literal", raw: "Card.YouCtrl" } },
        activeInZones: [],
      },
      7823,
      97823,
      0,
    );
    expect(canBlockWhileTapped(g, matched.id)).toBe(true);
    expect(canBlockWhileTapped(g, unmatched.id)).toBe(false);
    expect(isBlockLegal(g, unmatched.id, attacker.id, [unmatched.id]).legal).toBe(false);
  });

  it("untapped blocker is unaffected by the static", () => {
    const g = mkGame();
    const blocker = mintCard({ game: g, id: 7830, seat: 0 });
    const attacker = mintCard({ game: g, id: 7831, seat: 1 });
    expect(blocker.tapped).toBe(false);
    expect(isBlockLegal(g, blocker.id, attacker.id, [blocker.id]).legal).toBe(true);
  });
});

// ── FlipCoinMod ──────────────────────────────────────────────────────────────
describe("Wave 78 — FlipCoinMod (Edgar / Krark's Thumb shape)", () => {
  it("flipCoinModifier defaults to mode='default'", () => {
    const g = mkGame();
    expect(flipCoinModifier(g, mkPlayerSeat(0)).mode).toBe("default");
  });

  it("Result$ True forces heads regardless of RNG", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 7840, seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "FlipCoinMod",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Result: { kind: "literal", raw: "True" },
        },
        activeInZones: [],
      },
      7841,
      97841,
      0,
    );
    expect(flipCoinModifier(g, mkPlayerSeat(0)).mode).toBe("forced-heads");
    // Drive FlipACoinEffect; heads is forced.
    const ast: AbilityAst = {
      kind: "spell",
      effect: { handlerKey: "FlipACoin", params: {} },
      cost: { raw: "" },
    };
    const sa = new SpellAbility(ast, src.id, mkPlayerSeat(0), new Map(), []);
    const yields = drain(sa.makeResolver().resolve(g) as Generator<EngineYield, void, unknown>);
    const flipEvent = yields.find((y) => y.kind === "event" && y.event.kind === "FlipCoin");
    expect(flipEvent).toBeDefined();
    if (flipEvent && flipEvent.kind === "event" && flipEvent.event.kind === "FlipCoin") {
      expect(flipEvent.event.payload.resultHeads).toBe(true);
    }
  });

  it("Result$ False forces tails regardless of RNG", () => {
    const g = mkGame();
    const src = mintCard({ game: g, id: 7850, seat: 0 });
    buildAndRegister(
      g,
      {
        mode: "FlipCoinMod",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Result: { kind: "literal", raw: "False" },
        },
        activeInZones: [],
      },
      7851,
      97851,
      0,
    );
    expect(flipCoinModifier(g, mkPlayerSeat(0)).mode).toBe("forced-tails");
    const ast: AbilityAst = {
      kind: "spell",
      effect: { handlerKey: "FlipACoin", params: {} },
      cost: { raw: "" },
    };
    const sa = new SpellAbility(ast, src.id, mkPlayerSeat(0), new Map(), []);
    const yields = drain(sa.makeResolver().resolve(g) as Generator<EngineYield, void, unknown>);
    const flipEvent = yields.find((y) => y.kind === "event" && y.event.kind === "FlipCoin");
    expect(flipEvent).toBeDefined();
    if (flipEvent && flipEvent.kind === "event" && flipEvent.event.kind === "FlipCoin") {
      expect(flipEvent.event.payload.resultHeads).toBe(false);
    }
  });

  it("DoubleFlip$ True grants 'double-flip-pick' mode", () => {
    const g = mkGame();
    buildAndRegister(
      g,
      {
        mode: "FlipCoinMod",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          DoubleFlip: { kind: "literal", raw: "True" },
        },
        activeInZones: [],
      },
      7860,
      97860,
      0,
    );
    expect(flipCoinModifier(g, mkPlayerSeat(0)).mode).toBe("double-flip-pick");
    // Opponent unaffected.
    expect(flipCoinModifier(g, mkPlayerSeat(1)).mode).toBe("default");
  });
});

// ── Devotion ─────────────────────────────────────────────────────────────────
describe("Wave 78 — Devotion (Altar of the Pantheon shape)", () => {
  it("devotionModifierFor defaults to 0", () => {
    const g = mkGame();
    expect(devotionModifierFor(g, mkPlayerSeat(0), Color.Black)).toBe(0);
  });

  it("ValidPlayer$ You + Amount$ 1 adds to every queried color", () => {
    const g = mkGame();
    buildAndRegister(
      g,
      {
        mode: "Devotion",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Amount: { kind: "literal", raw: "1" },
        },
        activeInZones: [],
      },
      7870,
      97870,
      0,
    );
    expect(devotionModifierFor(g, mkPlayerSeat(0), Color.Black)).toBe(1);
    expect(devotionModifierFor(g, mkPlayerSeat(0), Color.White)).toBe(1);
    expect(devotionModifierFor(g, mkPlayerSeat(0), Color.Green)).toBe(1);
    // Opponent unaffected.
    expect(devotionModifierFor(g, mkPlayerSeat(1), Color.Black)).toBe(0);
  });

  it("ValidCard$ + DevotionMod$ + DevotionColor$ adds per-card to that color only", () => {
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    // 2 matching cards on the battlefield → +2 black devotion.
    mintCard({
      game: g,
      id: 7880,
      seat: 0,
      paper: mkPaperWithCost("CardA", "Creature — Demon", ""),
    });
    mintCard({
      game: g,
      id: 7881,
      seat: 0,
      paper: mkPaperWithCost("CardB", "Creature — Demon", ""),
    });
    buildAndRegister(
      g,
      {
        mode: "Devotion",
        params: {
          ValidCard: { kind: "literal", raw: "Creature.YouCtrl" },
          DevotionMod: { kind: "literal", raw: "1" },
          DevotionColor: { kind: "literal", raw: "Black" },
        },
        activeInZones: [],
      },
      7882,
      97882,
      0,
    );
    expect(devotionModifierFor(g, seat0, Color.Black)).toBe(2);
    // Other colors unaffected (DevotionColor filter).
    expect(devotionModifierFor(g, seat0, Color.White)).toBe(0);
  });

  it("integrates with Wave 42 Count$Devotion selector", async () => {
    // The svar selector path adds the modifier to the canonical
    // symbol-count. Build a card with no symbols + an Altar-shape
    // static; the queried devotion should equal the modifier.
    const { evaluateExpression } = await import("../../svar/evaluator.js");
    const g = mkGame();
    const seat0 = mkPlayerSeat(0);
    // No mana-pip cards on the battlefield: canonical symbol count = 0.
    buildAndRegister(
      g,
      {
        mode: "Devotion",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Amount: { kind: "literal", raw: "1" },
        },
        activeInZones: [],
      },
      7890,
      97890,
      0,
    );
    const result = evaluateExpression(
      {
        kind: "Count",
        raw: "Count$Devotion.Black",
        args: [{ kind: "literal", raw: "Devotion.Black" }],
      },
      {
        game: g,
        svars: new Map(),
        controller: seat0,
      },
    );
    expect(result).toBe(1);
  });
});

// ── Lifecycle ────────────────────────────────────────────────────────────────
describe("Wave 78 — lifecycle: deactivation reverses each gate", () => {
  it("unregistering each Wave 78 static restores defaults", () => {
    const g = mkGame();
    const blocker = mintCard({ game: g, id: 7900, seat: 0 });
    blocker.tapped = true;
    const seat0 = mkPlayerSeat(0);

    const sBlock = buildAndRegister(
      g,
      {
        mode: "BlockTapped",
        params: { ValidCard: { kind: "literal", raw: "Card.YouCtrl" } },
        activeInZones: [],
      },
      blocker.id as unknown as number,
      97900,
      0,
    );
    const sFlip = buildAndRegister(
      g,
      {
        mode: "FlipCoinMod",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Result: { kind: "literal", raw: "True" },
        },
        activeInZones: [],
      },
      7901,
      97901,
      0,
    );
    const sDev = buildAndRegister(
      g,
      {
        mode: "Devotion",
        params: {
          ValidPlayer: { kind: "literal", raw: "You" },
          Amount: { kind: "literal", raw: "1" },
        },
        activeInZones: [],
      },
      7902,
      97902,
      0,
    );

    // All three gates active.
    expect(canBlockWhileTapped(g, blocker.id)).toBe(true);
    expect(flipCoinModifier(g, seat0).mode).toBe("forced-heads");
    expect(devotionModifierFor(g, seat0, Color.Black)).toBe(1);

    // Unregister; each gate releases.
    g.staticEffectRegistry.unregister(sBlock.id);
    g.staticEffectRegistry.unregister(sFlip.id);
    g.staticEffectRegistry.unregister(sDev.id);

    expect(canBlockWhileTapped(g, blocker.id)).toBe(false);
    expect(flipCoinModifier(g, seat0).mode).toBe("default");
    expect(devotionModifierFor(g, seat0, Color.Black)).toBe(0);
  });
});
