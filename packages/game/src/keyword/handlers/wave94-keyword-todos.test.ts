// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 94 — EoT-step bug fix + keyword TODO closures.
//
// Two threads:
//   1. PhaseStep matcher fix on `mobilize-keyword.ts` and
//      `ability/effects/encore.ts`. PhaseStep emits "EndStep" not
//      "End"; the matchers used to compare against "End" only, so the
//      delayed sacrifice trigger was silently dead in production. The
//      fix accepts both forms (forward-compat).
//   2. TODO(advanced) closures across 5 keyword handlers:
//        - chapter-keyword.ts   — per-chapter SVar dispatch (DB1..DBN).
//        - tribute-keyword.ts   — alt-trigger via `AltTribute` SVar.
//        - tempting-offer-keyword.ts — runOffer per-opponent confirm loop.
//        - backup-keyword.ts    — `BackupGrant` SVar dispatch on target.
//        - ripple-keyword.ts    — same-name free-cast via castCopyOf.
import "../../ability/effects/index.js";
import "../../altcost/index.js";
import "./index.js";
import {
  type AbilityAst,
  type CardDefinition,
  CardType,
  Color,
  ColorSet,
  CounterType,
  DEFAULT_PAPER_CARD_FLAGS,
  type EffectInvocation,
  type EntityId,
  type LobbyPlayer,
  type PaperCard,
  PhaseStep,
  type PlayerSeat,
  type SVarAst,
  SeededRng,
  type Supertype,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkEvent,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Exile } from "../../zone/zones/exile.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { BackupKeywordHandler } from "./backup-keyword.js";
import { ChapterKeywordHandler } from "./chapter-keyword.js";
import { MobilizeKeywordHandler } from "./mobilize-keyword.js";
import { TemptingOfferKeywordHandler } from "./tempting-offer-keyword.js";
import { TributeKeywordHandler } from "./tribute-keyword.js";

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
  cardDataSyncedAt: "2026-04-30T00:00:00Z",
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
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
  }
  return game;
};

const NO_SUPERTYPES: readonly Supertype[] = [];

const mkCreaturePaperWithSVars = (name: string, svars: ReadonlyMap<string, SVarAst>): PaperCard => {
  const types = new TypeLine(NO_SUPERTYPES, [CardType.Creature], ["Beast"]);
  const definition: CardDefinition = {
    name,
    oracle: "",
    types,
    manaCost: null,
    pt: { power: "2", toughness: "2" },
    colors: ColorSet.of(Color.Red),
    abilities: [],
    triggers: [],
    replacements: [],
    statics: [],
    keywords: [],
    svars,
  };
  return {
    name,
    edition: "TST",
    collectorNumber: "001",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition,
  };
};

interface YieldEnvelope {
  readonly kind?: string;
  readonly request?: { readonly kind?: string; readonly playerSeat?: PlayerSeat };
}

// -----------------------------------------------------------------------
// Step 1 — EoT step-name bug fix on Mobilize.
// -----------------------------------------------------------------------

describe("Wave 94 — Mobilize EoT delayed-trigger fires on PhaseStep.EndStep", () => {
  it("delayed trigger fires for the canonical 'EndStep' step value (was bug: only 'End')", () => {
    const game = mkGame();
    const sourceId = mkEntityId(94001);
    const source = new Card(
      sourceId,
      mkCreaturePaperWithSVars("Mob Source", new Map()),
      ALICE,
      ALICE,
      ZoneType.Battlefield,
    );
    source.mobilizeAmount = 1;
    game.cards.set(sourceId, source);
    game.getPlayer(ALICE).zones.get(ZoneType.Battlefield)?.add(sourceId);

    new MobilizeKeywordHandler().activate(
      { keyword: "mobilize", params: { amount: { kind: "literal", raw: "1" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const ta = source.triggeredAbilities[0];
    if (!ta) return;
    // Manually feed an AttackersDeclared event into the matcher to set
    // capturedDefender, then drive the resolver.
    const attackEvent = mkEvent("AttackersDeclared", game.turn, game.phase, {
      attackingSeat: ALICE,
      attackers: [{ attackerId: sourceId, defender: { kind: "player", seat: BOB } }],
    });
    expect(ta.matches(attackEvent)).toBe(true);
    const resolver = (
      ta as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    const initialDelayedSize = game.delayedTriggerQueue.size();
    const gen = resolver.resolve(game);
    let next = gen.next();
    while (!next.done) next = gen.next();
    expect(game.delayedTriggerQueue.size()).toBeGreaterThan(initialDelayedSize);

    // Locate a freshly-spawned token (controller=ALICE, copiedFrom undefined
    // but tapped + Warrior Token).
    let tokenId: EntityId | undefined;
    for (const [, c] of game.cards) {
      if (c.id === sourceId) continue;
      if (c.paperCard.name === "Warrior Token" && c.zone === ZoneType.Battlefield) {
        tokenId = c.id;
        break;
      }
    }
    expect(tokenId).toBeDefined();
    if (tokenId === undefined) return;

    // Now feed a StepStarted(EndStep) event using the canonical enum
    // value. The pre-fix matcher compared against "End" and would have
    // returned false here, leaving the token alive.
    const endStepEvent = mkEvent("StepStarted", game.turn, PhaseStep.EndStep, {
      step: PhaseStep.EndStep,
      activeSeat: ALICE,
    });
    game.delayedTriggerQueue.onEvent(endStepEvent, game.triggerRegistry);
    const tok = game.cards.get(tokenId);
    // Token was sacrificed — should be in graveyard now.
    expect(tok?.zone).toBe(ZoneType.Graveyard);
  });
});

// -----------------------------------------------------------------------
// Step 2.A — Chapter per-chapter SVar dispatch.
// -----------------------------------------------------------------------

describe("Wave 94 — Chapter per-chapter SVar dispatch", () => {
  it("CounterAdded watcher dispatches DB1..DBN by lore total via sub-SVar", () => {
    const game = mkGame();
    const sourceId = mkEntityId(94010);

    // Build a Saga PaperCard with two chapter SVars. Each is a no-op
    // PutCounter on Card.Self with a distinct counter so we can observe
    // which one fired. Chapter 1 → adds a Charge counter; Chapter 2 →
    // adds a Loyalty counter.
    const dbA: EffectInvocation = {
      handlerKey: "PutCounter",
      params: {
        Defined: { kind: "literal", raw: "Self" },
        CounterType: { kind: "literal", raw: "charge" },
        CounterNum: { kind: "literal", raw: "1" },
      },
    };
    const dbB: EffectInvocation = {
      handlerKey: "PutCounter",
      params: {
        Defined: { kind: "literal", raw: "Self" },
        CounterType: { kind: "literal", raw: "loyalty" },
        CounterNum: { kind: "literal", raw: "1" },
      },
    };
    const svars = new Map<string, SVarAst>([
      ["DBA", { kind: "ability", raw: "", ability: dbA }],
      ["DBB", { kind: "ability", raw: "", ability: dbB }],
    ]);
    const paper = mkCreaturePaperWithSVars("Test Saga", svars);
    const source = new Card(sourceId, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.getPlayer(ALICE).zones.get(ZoneType.Battlefield)?.add(sourceId);

    new ChapterKeywordHandler().activate(
      { keyword: "chapter", params: { detail: { kind: "literal", raw: "2:DBA,DBB" } } },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    expect(source.sagaChapterCount).toBe(2);
    expect(source.sagaChapterSVars).toEqual(["DBA", "DBB"]);

    // The watcher is triggers[2] (etb, main1, watcher).
    const watcher = source.triggeredAbilities[2];
    expect(watcher).toBeDefined();
    if (!watcher) return;

    // Stamp one Lore counter manually + drive the watcher's resolver.
    source.counters.set(CounterType.Lore, 1);
    const resolver1 = (
      watcher as unknown as { resolver: { resolve: (g: Game) => Generator<unknown, void, unknown> } }
    ).resolver;
    {
      const gen = resolver1.resolve(game);
      let next = gen.next();
      while (!next.done) next = gen.next();
    }
    // Chapter 1 dispatched DBA → +1 Charge counter on the Saga.
    expect(source.counters.get(CounterType.Charge) ?? 0).toBeGreaterThanOrEqual(1);

    // Lore=2 → DBB → +1 Loyalty counter and final-chapter flag.
    source.counters.set(CounterType.Lore, 2);
    {
      const gen = resolver1.resolve(game);
      let next = gen.next();
      while (!next.done) next = gen.next();
    }
    expect(source.counters.get(CounterType.Loyalty) ?? 0).toBeGreaterThanOrEqual(1);
    expect(source.sagaFinalChapterResolved).toBe(true);
  });
});

// -----------------------------------------------------------------------
// Step 2.B — Tribute alternate-trigger SVar dispatch on decline.
// -----------------------------------------------------------------------

describe("Wave 94 — Tribute alternate-trigger via AltTribute SVar", () => {
  it("on decline, dispatches AltTribute SVar (kind=ability)", () => {
    const game = mkGame();
    const sourceId = mkEntityId(94020);

    // AltTribute = +1 Charge counter on Card.Self (so we can assert it
    // fired without depending on more elaborate effects).
    const alt: EffectInvocation = {
      handlerKey: "PutCounter",
      params: {
        Defined: { kind: "literal", raw: "Self" },
        CounterType: { kind: "literal", raw: "charge" },
        CounterNum: { kind: "literal", raw: "2" },
      },
    };
    const svars = new Map<string, SVarAst>([["AltTribute", { kind: "ability", raw: "", ability: alt }]]);
    const paper = mkCreaturePaperWithSVars("Tributed", svars);
    const source = new Card(sourceId, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    new TributeKeywordHandler().activate(
      { keyword: "tribute", params: { amount: { kind: "literal", raw: "3" } } },
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
        // Decline tribute → triggers AltTribute SVar.
        next = gen.next({ kind: "confirmAction", confirmed: false });
      } else {
        next = gen.next();
      }
    }
    expect(source.tributePaid).toBe(false);
    // AltTribute fired and put 2 Charge counters.
    expect(source.counters.get(CounterType.Charge) ?? 0).toBe(2);
    // No +1/+1 counters since the controller declined tribute.
    expect(source.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(0);
  });
});

// -----------------------------------------------------------------------
// Step 2.C — Tempting Offer per-opponent confirm loop.
// -----------------------------------------------------------------------

describe("Wave 94 — Tempting Offer runOffer per-opponent confirm loop", () => {
  it("counts opponent confirmations and stamps temptingOfferAcceptedCount", () => {
    const game = mkGame();
    const sourceId = mkEntityId(94030);
    const source = new Card(
      sourceId,
      mkCreaturePaperWithSVars("Offering", new Map()),
      ALICE,
      ALICE,
      ZoneType.Battlefield,
    );
    game.cards.set(sourceId, source);

    const gen = TemptingOfferKeywordHandler.runOffer(game, sourceId, ALICE);
    let next = gen.next();
    let oppPrompts = 0;
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "confirmAction") {
        oppPrompts++;
        // Bob accepts.
        next = gen.next({ kind: "confirmAction", confirmed: true });
      } else {
        next = gen.next();
      }
    }
    expect(oppPrompts).toBe(1); // Only Bob is opposite ALICE.
    expect(source.temptingOfferAcceptedCount).toBe(1);
    expect(next.value).toBe(1);
  });

  it("dispatches TemptingOfferCopy SVar once per accepting opponent", () => {
    const game = mkGame();
    const sourceId = mkEntityId(94031);
    const copyAbility: EffectInvocation = {
      handlerKey: "PutCounter",
      params: {
        Defined: { kind: "literal", raw: "Self" },
        CounterType: { kind: "literal", raw: "charge" },
        CounterNum: { kind: "literal", raw: "1" },
      },
    };
    const svars = new Map<string, SVarAst>([
      ["TemptingOfferCopy", { kind: "ability", raw: "", ability: copyAbility }],
    ]);
    const paper = mkCreaturePaperWithSVars("Offering Source", svars);
    const source = new Card(sourceId, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    const gen = TemptingOfferKeywordHandler.runOffer(game, sourceId, ALICE);
    let next = gen.next();
    while (!next.done) {
      const y = next.value as YieldEnvelope;
      if (y.kind === "decision" && y.request?.kind === "confirmAction") {
        next = gen.next({ kind: "confirmAction", confirmed: true });
      } else {
        next = gen.next();
      }
    }
    expect(source.temptingOfferAcceptedCount).toBe(1);
    // One accepting opponent → one Charge counter on the source.
    expect(source.counters.get(CounterType.Charge) ?? 0).toBe(1);
  });
});

// -----------------------------------------------------------------------
// Step 2.D — Backup BackupGrant SVar dispatch on chosen target.
// -----------------------------------------------------------------------

describe("Wave 94 — Backup BackupGrant SVar dispatch", () => {
  it("when target !== source, dispatches BackupGrant SVar with target as SA target", () => {
    const game = mkGame();
    const sourceId = mkEntityId(94040);
    const otherId = mkEntityId(94041);

    // BackupGrant = put a Loyalty counter on the targeted creature (the
    // target list is the SA's `targets` field). PutCounter with
    // Defined=Targeted picks the SA's first target.
    const grant: EffectInvocation = {
      handlerKey: "PutCounter",
      params: {
        Defined: { kind: "literal", raw: "Targeted" },
        CounterType: { kind: "literal", raw: "loyalty" },
        CounterNum: { kind: "literal", raw: "1" },
      },
    };
    const svars = new Map<string, SVarAst>([["BackupGrant", { kind: "ability", raw: "", ability: grant }]]);
    const paper = mkCreaturePaperWithSVars("Backup Source", svars);
    const source = new Card(sourceId, paper, ALICE, ALICE, ZoneType.Battlefield);
    const other = new Card(
      otherId,
      mkCreaturePaperWithSVars("Backup Target", new Map()),
      ALICE,
      ALICE,
      ZoneType.Battlefield,
    );
    game.cards.set(sourceId, source);
    game.cards.set(otherId, other);
    game.getPlayer(ALICE).zones.get(ZoneType.Battlefield)?.add(sourceId);
    game.getPlayer(ALICE).zones.get(ZoneType.Battlefield)?.add(otherId);

    new BackupKeywordHandler().activate(
      { keyword: "backup", params: { amount: { kind: "literal", raw: "1" } } },
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
      if (y.kind === "decision" && y.request?.kind === "chooseCard") {
        next = gen.next({ kind: "chooseCard", chosen: [otherId] });
      } else {
        next = gen.next();
      }
    }
    // +1/+1 counter on the chosen target (Backup core).
    expect(other.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(1);
    // Plus the BackupGrant SVar dispatched and applied a Loyalty counter
    // to the target (proves the SVar dispatch route fired with the SA's
    // targets list set).
    expect(other.counters.get(CounterType.Loyalty) ?? 0).toBe(1);
  });

  it("when target === source, BackupGrant SVar is NOT dispatched (CR 702.165a 'if that's another creature')", () => {
    const game = mkGame();
    const sourceId = mkEntityId(94042);
    const grant: EffectInvocation = {
      handlerKey: "PutCounter",
      params: {
        Defined: { kind: "literal", raw: "Targeted" },
        CounterType: { kind: "literal", raw: "loyalty" },
        CounterNum: { kind: "literal", raw: "1" },
      },
    };
    const svars = new Map<string, SVarAst>([["BackupGrant", { kind: "ability", raw: "", ability: grant }]]);
    const paper = mkCreaturePaperWithSVars("Backup Solo", svars);
    const source = new Card(sourceId, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.getPlayer(ALICE).zones.get(ZoneType.Battlefield)?.add(sourceId);

    new BackupKeywordHandler().activate(
      { keyword: "backup", params: { amount: { kind: "literal", raw: "1" } } },
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
      if (y.kind === "decision" && y.request?.kind === "chooseCard") {
        next = gen.next({ kind: "chooseCard", chosen: [sourceId] });
      } else {
        next = gen.next();
      }
    }
    expect(source.counters.get(CounterType.PlusOnePlusOne) ?? 0).toBe(1);
    // No Loyalty counter — BackupGrant was not dispatched on self-target.
    expect(source.counters.get(CounterType.Loyalty) ?? 0).toBe(0);
  });
});

// Touch-test that AbilityAst type import resolves; otherwise unused.
const _astTypeProbe: AbilityAst | undefined = undefined;
void _astTypeProbe;
