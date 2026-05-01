// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 79 — TODO(advanced) sweep across keyword handlers.
//
// Closes inline TODO(advanced) tails on six keyword handlers:
//   * skulk-keyword.ts  — stale TODO; the block-restriction is already
//     wired in combat/keywords/block-restrictions.ts. Comment cleanup.
//   * decayed-keyword.ts — stale TODO; the EOC sacrifice is wired via
//     statics/wave65-combat-gates.ts (sweepEndOfCombat). Comment cleanup.
//   * amplify-keyword.ts — wires the chooseCard-from-hand reveal +
//     CardsRevealed emit + addCounter(P1P1, n*revealed) on self.
//   * enlist-keyword.ts — wires the chooseCard untapped non-attacking
//     creature → tap → register Layer 7c +power/+0 UEoT on the attacker.
//   * extort-keyword.ts — wires the {W/B} cost-payment via
//     parseCostString/payCost (drops payment-skipped MVP).
//   * recover-keyword.ts — wires the recover cost-payment via
//     parseCostString/payCost (drops payment-skipped MVP — payment
//     failure routes to exile, mirroring CR 702.59a).
import "../../ability/effects/index.js";
import "../../altcost/index.js";
import "./index.js";
import { parseCard } from "@mtg-forge-ts/cards";
import type { LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  Color,
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaProduced,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { ManaPool } from "../../mana/mana-pool.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Exile } from "../../zone/zones/exile.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { AmplifyKeywordHandler } from "./amplify-keyword.js";
import { DecayedKeywordHandler } from "./decayed-keyword.js";
import { EnlistKeywordHandler } from "./enlist-keyword.js";
import { ExtortKeywordHandler } from "./extort-keyword.js";
import { RecoverKeywordHandler } from "./recover-keyword.js";
import { SkulkKeywordHandler } from "./skulk-keyword.js";

const aliceLP: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bobLP: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };
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
  forgeSha: "abc",
  cardDataSyncedAt: "2026-04-26T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const ALICE: PlayerSeat = mkPlayerSeat(0);
const BOB: PlayerSeat = mkPlayerSeat(1);

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [aliceLP, bobLP], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, p.seat));
  }
  return game;
};

const goblinSrc = (): string =>
  `${["Name:Test Goblin", "ManaCost:1 R", "Types:Creature Goblin", "PT:1/1", "Oracle:Test"].join("\n")}\n`;
const elfSrc = (): string =>
  `${["Name:Test Elf", "ManaCost:G", "Types:Creature Elf", "PT:1/1", "Oracle:Test"].join("\n")}\n`;
const wizardSrc = (): string =>
  `${["Name:Test Wizard", "ManaCost:1 U", "Types:Creature Wizard", "PT:1/1", "Oracle:Test"].join("\n")}\n`;

const mkPaper = (name: string, src: string): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(src, `${name}.txt`),
});

const plainPaper: PaperCard = {
  name: "Test",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

interface YieldEnvelope {
  readonly kind?: string;
  readonly request?: { readonly kind?: string };
}

// -----------------------------------------------------------------------
// Skulk — stale TODO cleanup. The block-restriction is in
// combat/keywords/block-restrictions.ts and reads card.keywords. Verify
// the keyword stamp lands so the read continues to fire.
// -----------------------------------------------------------------------

describe("Wave 79 — Skulk stale-TODO cleanup", () => {
  it("activate stamps 'skulk' on card.keywords (block-restriction read site)", () => {
    const game = mkGame();
    const id = mkEntityId(7901);
    const card = new Card(id, plainPaper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new SkulkKeywordHandler().activate(
      { keyword: "skulk" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("skulk")).toBe(true);
  });
});

// -----------------------------------------------------------------------
// Decayed — stale TODO cleanup. The EOC sacrifice is in
// statics/wave65-combat-gates.ts (sweepEndOfCombat). Verify the slot
// stamp lands so the read continues to fire.
// -----------------------------------------------------------------------

describe("Wave 79 — Decayed stale-TODO cleanup", () => {
  it("activate stamps 'decayed' keyword AND card.decayed = true", () => {
    const game = mkGame();
    const id = mkEntityId(7902);
    const card = new Card(id, plainPaper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new DecayedKeywordHandler().activate(
      { keyword: "decayed" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("decayed")).toBe(true);
    expect(card.decayed).toBe(true);
  });
});

// -----------------------------------------------------------------------
// Amplify — chooseCards-from-hand-sharing-creature-type, then
// CardsRevealed emit, then addCounter(P1P1, n*revealed).
// -----------------------------------------------------------------------

describe("Wave 79 — Amplify choose-and-reveal lands", () => {
  it("yields chooseCard, picks 2 sharing-type cards, stamps 2*N counters", () => {
    const game = mkGame();
    const sourceId = mkEntityId(7910);
    const goblinPaper = mkPaper("Test Goblin", goblinSrc());
    const source = new Card(sourceId, goblinPaper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    // Two Goblins in hand (share creature type) + one Elf (does not).
    const handZone = game.getPlayer(ALICE).zones.get(ZoneType.Hand);
    if (!handZone) throw new Error("hand zone missing");
    const gob1Id = mkEntityId(7911);
    const gob1 = new Card(gob1Id, goblinPaper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(gob1Id, gob1);
    handZone.add(gob1Id);
    const gob2Id = mkEntityId(7912);
    const gob2 = new Card(gob2Id, goblinPaper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(gob2Id, gob2);
    handZone.add(gob2Id);
    const elfId = mkEntityId(7913);
    const elf = new Card(elfId, mkPaper("Test Elf", elfSrc()), ALICE, ALICE, ZoneType.Hand);
    game.cards.set(elfId, elf);
    handZone.add(elfId);

    new AmplifyKeywordHandler().activate(
      { keyword: "amplify", params: { amount: { kind: "literal", raw: "2" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    expect(ta).toBeDefined();
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    let sawChoose = false;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "chooseCard") {
        sawChoose = true;
        next = gen.next({ kind: "chooseCard", chosen: [gob1Id, gob2Id] });
      } else {
        next = gen.next();
      }
    }
    expect(sawChoose).toBe(true);
    // 2 amplify * 2 revealed = 4 +1/+1 counters on self.
    expect(source.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(4);
  });

  it("no-op when no eligible (sharing-type) cards in hand", () => {
    const game = mkGame();
    const sourceId = mkEntityId(7920);
    const source = new Card(
      sourceId,
      mkPaper("Test Goblin", goblinSrc()),
      ALICE,
      ALICE,
      ZoneType.Battlefield,
    );
    game.cards.set(sourceId, source);

    // Only an Elf in hand (does not share creature type with Goblin).
    const handZone = game.getPlayer(ALICE).zones.get(ZoneType.Hand);
    if (!handZone) throw new Error("hand zone missing");
    const elfId = mkEntityId(7921);
    const elf = new Card(elfId, mkPaper("Test Elf", elfSrc()), ALICE, ALICE, ZoneType.Hand);
    game.cards.set(elfId, elf);
    handZone.add(elfId);

    new AmplifyKeywordHandler().activate(
      { keyword: "amplify", params: { amount: { kind: "literal", raw: "1" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    let sawDecision = false;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision") sawDecision = true;
      next = gen.next();
    }
    expect(sawDecision).toBe(false);
    expect(source.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(0);
  });
});

// -----------------------------------------------------------------------
// Enlist — chooseCard untapped non-attacking creature → tap → register
// Layer 7c +power/+0 UEoT on attacker.
// -----------------------------------------------------------------------

describe("Wave 79 — Enlist tap-and-pump", () => {
  it("taps the chosen creature and adds its power to the attacker UEoT", () => {
    const game = mkGame();
    const attackerId = mkEntityId(7930);
    const attacker = new Card(
      attackerId,
      mkPaper("Test Goblin", goblinSrc()),
      ALICE,
      ALICE,
      ZoneType.Battlefield,
    );
    attacker.attackedThisCombat = true; // declared as attacker
    game.cards.set(attackerId, attacker);

    // Eligible enlistee: untapped, non-attacking creature.
    const helperId = mkEntityId(7931);
    const helper = new Card(helperId, mkPaper("Test Elf", elfSrc()), ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(helperId, helper);
    game.getPlayer(ALICE).zones.get(ZoneType.Battlefield)?.add(helperId);

    // Ineligible: an attacking creature (already declared).
    const otherAttackerId = mkEntityId(7932);
    const otherAttacker = new Card(
      otherAttackerId,
      mkPaper("Test Wizard", wizardSrc()),
      ALICE,
      ALICE,
      ZoneType.Battlefield,
    );
    otherAttacker.attackedThisCombat = true;
    game.cards.set(otherAttackerId, otherAttacker);
    game.getPlayer(ALICE).zones.get(ZoneType.Battlefield)?.add(otherAttackerId);

    new EnlistKeywordHandler().activate(
      { keyword: "enlist" },
      { game, sourceCardId: attackerId, controllerSeat: ALICE },
    );
    const ta = attacker.triggeredAbilities[0];
    expect(ta).toBeDefined();
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    let sawChoose = false;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "chooseCard") {
        sawChoose = true;
        // Pool should contain only the helper (the other attacker is
        // filtered out by attackedThisCombat).
        const req = y.request as unknown as { pool: readonly unknown[] };
        expect(req.pool).toEqual([helperId]);
        next = gen.next({ kind: "chooseCard", chosen: [helperId] });
      } else {
        next = gen.next();
      }
    }
    expect(sawChoose).toBe(true);
    // Helper should be tapped.
    expect(helper.tapped).toBe(true);
    // Attacker's power should have been pumped by helper's power (1).
    const chars = game.layerEngine.computeCharacteristics(attackerId);
    expect(chars.power ?? 0).toBe(2); // base 1 + enlist pump 1
  });

  it("no-op when there are no eligible enlistees (all tapped or attacking)", () => {
    const game = mkGame();
    const attackerId = mkEntityId(7940);
    const attacker = new Card(
      attackerId,
      mkPaper("Test Goblin", goblinSrc()),
      ALICE,
      ALICE,
      ZoneType.Battlefield,
    );
    attacker.attackedThisCombat = true;
    game.cards.set(attackerId, attacker);

    // The only other creature is also attacking; not an eligible enlistee.
    const otherId = mkEntityId(7941);
    const other = new Card(otherId, mkPaper("Test Elf", elfSrc()), ALICE, ALICE, ZoneType.Battlefield);
    other.attackedThisCombat = true;
    game.cards.set(otherId, other);
    game.getPlayer(ALICE).zones.get(ZoneType.Battlefield)?.add(otherId);

    new EnlistKeywordHandler().activate(
      { keyword: "enlist" },
      { game, sourceCardId: attackerId, controllerSeat: ALICE },
    );
    const ta = attacker.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    let sawDecision = false;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision") sawDecision = true;
      next = gen.next();
    }
    expect(sawDecision).toBe(false);
    // No pump applied.
    const chars = game.layerEngine.computeCharacteristics(attackerId);
    expect(chars.power ?? 0).toBe(1); // base unchanged
  });
});

// -----------------------------------------------------------------------
// Extort — full {W/B} cost-payment via parseCostString/payCost. Confirm
// that on confirm + payment success, opponents lose 1 + controller gains
// total drained. On confirm + payment failure (empty mana pool), no
// drain (extort is a "you may pay" — failure to pay aborts the effect).
// -----------------------------------------------------------------------

describe("Wave 79 — Extort cost-payment integration", () => {
  it("on confirm + W in pool: drains 1 from each opponent + controller gains total", () => {
    const game = mkGame();
    const sourceId = mkEntityId(7950);
    const source = new Card(sourceId, plainPaper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    // Set up a W mana pool so the W/B hybrid can be paid.
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.White, { sourceId: mkEntityId(99) }));
    game.getPlayer(ALICE).manaPool = pool;

    // Initial life totals: Alice 20, Bob 20.
    const aliceLife0 = game.getPlayer(ALICE).life;
    const bobLife0 = game.getPlayer(BOB).life;

    new ExtortKeywordHandler().activate(
      { keyword: "extort" },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    expect(ta).toBeDefined();
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "confirmAction") {
        next = gen.next({ kind: "confirmAction", confirmed: true });
      } else {
        next = gen.next();
      }
    }
    // Cost paid → mana pool drained.
    expect(pool.size()).toBe(0);
    // Bob lost 1 life.
    expect(game.getPlayer(BOB).life).toBe(bobLife0 - 1);
    // Alice gained 1 life.
    expect(game.getPlayer(ALICE).life).toBe(aliceLife0 + 1);
  });

  it("on confirm + empty pool: payCost throws → no drain, no life change", () => {
    const game = mkGame();
    const sourceId = mkEntityId(7960);
    const source = new Card(sourceId, plainPaper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    // Empty mana pool — cost cannot be paid.
    game.getPlayer(ALICE).manaPool = new ManaPool();

    const aliceLife0 = game.getPlayer(ALICE).life;
    const bobLife0 = game.getPlayer(BOB).life;

    new ExtortKeywordHandler().activate(
      { keyword: "extort" },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "confirmAction") {
        next = gen.next({ kind: "confirmAction", confirmed: true });
      } else {
        next = gen.next();
      }
    }
    // No drain — payment failed.
    expect(game.getPlayer(BOB).life).toBe(bobLife0);
    expect(game.getPlayer(ALICE).life).toBe(aliceLife0);
  });
});

// -----------------------------------------------------------------------
// Recover — full cost-payment via parseCostString/payCost. On confirm +
// payment success, return self to hand. On confirm + payment failure,
// fall through to exile (mirroring CR 702.59a's "otherwise exile it").
// -----------------------------------------------------------------------

describe("Wave 79 — Recover cost-payment integration", () => {
  it("on confirm + B in pool: pays cost, returns self to hand", () => {
    const game = mkGame();
    const sourceId = mkEntityId(7970);
    const source = new Card(sourceId, plainPaper, ALICE, ALICE, ZoneType.Graveyard);
    game.cards.set(sourceId, source);
    game.getPlayer(ALICE).zones.get(ZoneType.Graveyard)?.add(sourceId);

    // Dying creature that triggers recover (must be a creature, controlled
    // by recover-card's controller).
    const dyingId = mkEntityId(7971);
    const dying = new Card(dyingId, mkPaper("Test Elf", elfSrc()), ALICE, ALICE, ZoneType.Graveyard);
    game.cards.set(dyingId, dying);

    // Set up pool so the recover cost ("B") can be paid.
    const pool = new ManaPool();
    pool.add(ManaProduced.colored(Color.Black, { sourceId: mkEntityId(99) }));
    game.getPlayer(ALICE).manaPool = pool;

    new RecoverKeywordHandler().activate(
      { keyword: "recover", params: { cost: { kind: "literal", raw: "B" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    expect(ta).toBeDefined();
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "confirmAction") {
        next = gen.next({ kind: "confirmAction", confirmed: true });
      } else {
        next = gen.next();
      }
    }
    expect(pool.size()).toBe(0); // cost paid
    expect(source.zone).toBe(ZoneType.Hand);
  });

  it("on confirm + empty pool: payment fails → self exiled (fallback)", () => {
    const game = mkGame();
    const sourceId = mkEntityId(7980);
    const source = new Card(sourceId, plainPaper, ALICE, ALICE, ZoneType.Graveyard);
    game.cards.set(sourceId, source);
    game.getPlayer(ALICE).zones.get(ZoneType.Graveyard)?.add(sourceId);

    const dyingId = mkEntityId(7981);
    const dying = new Card(dyingId, mkPaper("Test Elf", elfSrc()), ALICE, ALICE, ZoneType.Graveyard);
    game.cards.set(dyingId, dying);

    // Empty pool — payment will throw, so we fall through to exile.
    game.getPlayer(ALICE).manaPool = new ManaPool();

    new RecoverKeywordHandler().activate(
      { keyword: "recover", params: { cost: { kind: "literal", raw: "B" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "confirmAction") {
        next = gen.next({ kind: "confirmAction", confirmed: true });
      } else {
        next = gen.next();
      }
    }
    // Self exiled (CR 702.59a — "Otherwise, exile it").
    expect(source.zone).toBe(ZoneType.Exile);
  });
});
