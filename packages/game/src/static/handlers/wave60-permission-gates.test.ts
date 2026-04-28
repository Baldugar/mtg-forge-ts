// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 60.C — two same-shape "permission gate" statics regression tests.
// Covers:
//   - Registry hookup for MayBeCastBy / MaxLevel
//   - mayBeCastBy helper grants permission for a card matched by an active
//     MayBeCastBy static (Bolas's Citadel-shape: top-of-library cast).
//   - Legal-action enumerator surfaces the topdeck cast when MayBeCastBy
//     active (visibility into the cast surface beyond hand-only).
//   - MaxLevel static stamps card.classMaxLevel on activate.
//   - Class level-up SA refuses to fire when classLevel >= classMaxLevel
//     (IllegalDecisionError thrown from activateAbility).
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
  IllegalDecisionError,
  PhaseStep,
  SeededRng,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { activateAbility } from "../../ability/activate.js";
import { SpellAbility } from "../../ability/spell-ability.js";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { enumerateLegalActions } from "../../priority/legal-action-enumerator.js";
import { maxLevelOf, mayBeCastBy } from "../../statics/wave60-cast-gates.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Exile } from "../../zone/zones/exile.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { staticHandlerRegistry } from "../static-handler.js";
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
    p.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, p.seat));
  }
  // Set up active player + Main1 for sorcery-speed gating.
  game.activePlayer = mkPlayerSeat(0);
  game.phase = PhaseStep.Main1;
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
describe("Wave 60.C — every new mode has a registered handler", () => {
  const modes: readonly StaticAbilityMode[] = ["MayBeCastBy", "MaxLevel"];
  for (const m of modes) {
    it(`mode '${m}' is registered`, () => {
      expect(staticHandlerRegistry.has(m)).toBe(true);
    });
  }
});

// ── MayBeCastBy (Bolas's Citadel-shape) ──────────────────────────────────────
describe("Wave 60.C — MayBeCastBy", () => {
  it("mayBeCastBy returns true when an active static targets (card, caster)", () => {
    const g = mkGame();
    // Spell card is on top of library (Bolas's Citadel-shape).
    const target = mintCard({
      game: g,
      id: 400,
      paper: mkPaper("Lightning Bolt", "Instant"),
      seat: 0,
      zone: ZoneType.Library,
    });
    buildAndRegister(
      g,
      {
        mode: "MayBeCastBy",
        params: {
          ValidCard: { kind: "literal", raw: "Card" },
          Caster: { kind: "literal", raw: "You" },
        },
        activeInZones: [],
      },
      9400,
      99400,
    );
    expect(mayBeCastBy(g, target.id, target.controllerSeat)).toBe(true);
  });

  it("mayBeCastBy returns false when caster filter does not match", () => {
    const g = mkGame();
    const target = mintCard({
      game: g,
      id: 410,
      paper: mkPaper("Lightning Bolt", "Instant"),
      seat: 0,
      zone: ZoneType.Library,
    });
    // Caster$ You — controller of the static is seat 0; opponent (seat 1)
    // does NOT match.
    buildAndRegister(
      g,
      {
        mode: "MayBeCastBy",
        params: {
          ValidCard: { kind: "literal", raw: "Card" },
          Caster: { kind: "literal", raw: "You" },
        },
        activeInZones: [],
      },
      9410,
      99410,
      0,
    );
    expect(mayBeCastBy(g, target.id, mkPlayerSeat(0))).toBe(true);
    expect(mayBeCastBy(g, target.id, mkPlayerSeat(1))).toBe(false);
  });

  it("legal-action enumerator surfaces topdeck cast under MayBeCastBy (Bolas's Citadel-shape)", () => {
    const g = mkGame();
    // Player 0's library top is an Instant; with MayBeCastBy active, the
    // enumerator should include castSpell{zone: Library} for that card.
    const top = mintCard({
      game: g,
      id: 420,
      paper: mkPaper("Lightning Bolt", "Instant"),
      seat: 0,
      zone: ZoneType.Library,
    });
    buildAndRegister(
      g,
      {
        mode: "MayBeCastBy",
        params: {
          ValidCard: { kind: "literal", raw: "Card" },
          Caster: { kind: "literal", raw: "You" },
        },
        activeInZones: [],
      },
      9420,
      99420,
      0,
    );
    const actions = enumerateLegalActions(g, mkPlayerSeat(0));
    const castFromLibrary = actions.find(
      (a) => a.kind === "castSpell" && a.cardId === top.id && a.zone === ZoneType.Library,
    );
    expect(castFromLibrary).toBeDefined();
  });
});

// ── MaxLevel (Class level cap, CR 716) ───────────────────────────────────────
describe("Wave 60.C — MaxLevel", () => {
  it("MaxLevel static stamps card.classMaxLevel on activate", () => {
    const g = mkGame();
    const classCard = mintCard({
      game: g,
      id: 500,
      paper: mkPaper("Class Card", "Enchantment"),
    });
    expect(classCard.classMaxLevel).toBeUndefined();
    buildAndRegister(
      g,
      {
        mode: "MaxLevel",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          MaxLevel: { kind: "literal", raw: "3" },
        },
        activeInZones: [],
      },
      classCard.id as unknown as number,
      99500,
    );
    expect(classCard.classMaxLevel).toBe(3);
    expect(maxLevelOf(g, classCard.id)).toBe(3);
  });

  it("Class level-up SA refuses to fire when classLevel >= classMaxLevel", () => {
    const g = mkGame();
    const classCard = mintCard({
      game: g,
      id: 510,
      paper: mkPaper("Class Card", "Enchantment"),
    });
    // Stamp the cap.
    buildAndRegister(
      g,
      {
        mode: "MaxLevel",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          MaxLevel: { kind: "literal", raw: "3" },
        },
        activeInZones: [],
      },
      classCard.id as unknown as number,
      99510,
    );
    // Simulate the Class keyword's synthesis: card.classLevel = 3
    // (already at cap), classMaxLevel = 3, and an SA tagged "class"
    // representing the level-up activation.
    classCard.classLevel = 3;
    const sa = new SpellAbility(
      {
        kind: "activated",
        effect: {
          handlerKey: "PutCounter",
          params: {
            Defined: { kind: "literal", raw: "Self" },
            CounterType: { kind: "literal", raw: "level" },
            CounterNum: { kind: "literal", raw: "1" },
          },
        },
        cost: { raw: "0" },
        rulesText: "Class level up to 4.",
      },
      classCard.id,
      classCard.controllerSeat,
      new Map(),
      [],
      undefined,
      new Set([ZoneType.Battlefield]),
      new Set(["class", "sorcery_speed", "class_level_4"]),
    );
    classCard.spellAbilities.push(sa);

    // Drain the activate generator until it throws. activateAbility is a
    // generator — we collect its yields until completion or error.
    const drain = (): void => {
      const gen = activateAbility(g, classCard.id, 0, classCard.controllerSeat);
      let result = gen.next();
      while (!result.done) {
        // Provide a benign decision response shape if asked — for the
        // PutCounter shape there are no targets, so we shouldn't be
        // asked. Pass empty input and rely on the gate firing first.
        result = gen.next({} as never);
      }
    };
    expect(drain).toThrow(IllegalDecisionError);
    expect(drain).toThrow(/Class level cap reached/);
  });

  it("Class level-up SA fires normally when classLevel < classMaxLevel (gate is permissive)", () => {
    const g = mkGame();
    const classCard = mintCard({
      game: g,
      id: 520,
      paper: mkPaper("Class Card", "Enchantment"),
    });
    buildAndRegister(
      g,
      {
        mode: "MaxLevel",
        params: {
          ValidCard: { kind: "literal", raw: "Card.Self" },
          MaxLevel: { kind: "literal", raw: "3" },
        },
        activeInZones: [],
      },
      classCard.id as unknown as number,
      99520,
    );
    // classLevel = 1 < cap of 3 — gate should NOT fire. Activation will
    // still fail downstream (no real cost-payment infra here), but the
    // gate must not be the cause.
    classCard.classLevel = 1;
    const sa = new SpellAbility(
      {
        kind: "activated",
        effect: {
          handlerKey: "PutCounter",
          params: {
            Defined: { kind: "literal", raw: "Self" },
            CounterType: { kind: "literal", raw: "level" },
            CounterNum: { kind: "literal", raw: "1" },
          },
        },
        cost: { raw: "0" },
        rulesText: "Class level up to 2.",
      },
      classCard.id,
      classCard.controllerSeat,
      new Map(),
      [],
      undefined,
      new Set([ZoneType.Battlefield]),
      new Set(["class", "sorcery_speed", "class_level_2"]),
    );
    classCard.spellAbilities.push(sa);

    // The gate should NOT throw IllegalDecisionError("Class level cap …").
    // We assert by collecting yields until completion or error and
    // checking the error type. Activation will likely succeed here
    // because cost "0" is parseable + the effect is registered.
    const collectOrError = (): { done: boolean; error?: unknown } => {
      try {
        const gen = activateAbility(g, classCard.id, 0, classCard.controllerSeat);
        let result = gen.next();
        let i = 0;
        while (!result.done && i < 100) {
          // Respond to any decision prompts with empty payloads.
          result = gen.next({ kind: "noop" } as never);
          i++;
        }
        return { done: true };
      } catch (e) {
        return { done: false, error: e };
      }
    };
    const r = collectOrError();
    if (!r.done) {
      // If the activation errored, it must NOT be the level-cap gate.
      expect(String((r.error as Error).message ?? "")).not.toMatch(/Class level cap reached/);
    }
  });
});

// ── helpers re-export tests ──────────────────────────────────────────────────
describe("Wave 60.C — wave60-cast-gates helpers", () => {
  it("maxLevelOf returns undefined when no MaxLevel static targets the card", () => {
    const g = mkGame();
    const c = mintCard({ game: g, id: 600, paper: mkPaper("Bear") });
    expect(maxLevelOf(g, c.id)).toBeUndefined();
  });

  it("mayBeCastBy returns false when no MayBeCastBy static is active", () => {
    const g = mkGame();
    const c = mintCard({
      game: g,
      id: 610,
      paper: mkPaper("Bolt", "Instant"),
      zone: ZoneType.Library,
    });
    expect(mayBeCastBy(g, c.id, c.controllerSeat)).toBe(false);
  });
});

// Touch unused import to satisfy biome; EntityId is referenced through the
// helper signatures via the casts above.
void (null as unknown as EntityId);
