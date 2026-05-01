// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 85 — Effect handler TODO sweep round 6.
//
// Closes inline TODO(advanced) tails on six effect handlers:
//   * discard:Defined — resolves the canonical token forms RememberedCards
//     and TargetedCard alongside the literal-id list. Each token expands
//     against the source's `remembered` array (RememberedCards) or the
//     SA's `targets` (TargetedCard); hits intersected with the discarder's
//     hand are queued for discard.
//   * wave-21:EndTurn — exiles every other stack item per CR 723.4. The
//     stack is drained and a StackItemCountered pulse is emitted per
//     popped item with byEffectId = the EndTurn source so observers can
//     correlate the wipe to its origin.
//   * wave-21:BidLife — routes the 1-life bid through game.action.changeLife
//     instead of mutating player.life directly, so LifeChanged + LifeLost
//     fire and any "whenever you lose life" triggers / Platinum-Angel
//     replacements engage.
//   * wave-18:Airbend — alongside the canonical tap, registers a Layer 6
//     kw-grant (Flying) with an untilEndOfTurn duration on each target.
//     The grant flows through the same store as CopyPermanent's
//     AddKeywords$ / debuff's kw-remove, so effectiveKeywords picks it up.
//   * wave-22:GainControlVariant — honors `Until$ EOT` /
//     `Until$ YourNextTurn` by passing the canonical EffectDuration through
//     to game.action.changeControl. The ControlChangeLedger records the
//     prior controller and reverts the change on duration expiry.
//   * wave-19:DigMultiple — wires the canonical DestinationZone$ /
//     ChangeNum$ ladder. Each iteration moves the first ChangeNum peeked
//     cards to the destination zone via game.action.moveTo so zone-change
//     triggers / replacements engage.
import "./index.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import type { ContinuousEffect } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import type { StackItem } from "../../stack/stack-item.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Exile } from "../../zone/zones/exile.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";
import { SpellAbility } from "../spell-ability.js";

const alice: LobbyPlayer = { id: "p-alice", name: "Alice", controllerKind: "human" };
const bob: LobbyPlayer = { id: "p-bob", name: "Bob", controllerKind: "ai" };
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
const plainPaper: PaperCard = {
  name: "Test",
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
    p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
    p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
    p.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, p.seat));
  }
  return game;
};

const drainGen = (gen: Generator<unknown, void, unknown>): unknown[] => {
  const out: unknown[] = [];
  let r = gen.next();
  while (!r.done) {
    out.push(r.value);
    r = gen.next();
  }
  return out;
};

const mkSa = (
  handlerKey: string,
  params: Record<string, { kind: string; raw: string }>,
  sourceId = mkEntityId(10),
  controllerSeat = mkPlayerSeat(0),
  targets: ReturnType<typeof mkEntityId>[] = [],
) =>
  new SpellAbility(
    {
      kind: "spell",
      effect: { handlerKey, params: params as never },
      cost: { raw: "" },
    },
    sourceId,
    controllerSeat,
    new Map(),
    targets,
  );

const seedSourceCard = (game: Game, sourceId = mkEntityId(10)): Card => {
  const seat0 = mkPlayerSeat(0);
  const c = new Card(sourceId, plainPaper, seat0, seat0, ZoneType.Battlefield);
  game.cards.set(sourceId, c);
  const bf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);
  bf?.add(sourceId);
  return c;
};

// ---------------------------------------------------------------------------
// (1) Discard:Defined — resolves RememberedCards + TargetedCard token forms
// ---------------------------------------------------------------------------

describe("Wave 85 — Discard Defined: RememberedCards / TargetedCard tokens", () => {
  it("RememberedCards expands to the source's remembered ids (intersected with hand)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(4000);
    const source = seedSourceCard(game, sourceId);
    const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
    const inHandId = mkEntityId(4001);
    const inHandCard = new Card(inHandId, plainPaper, seat0, seat0, ZoneType.Hand);
    game.cards.set(inHandId, inHandCard);
    hand?.add(inHandId);
    const notInHandId = mkEntityId(4002);
    // Stamp both ids onto remembered; only the in-hand id should discard.
    source.remembered.push(inHandId);
    source.remembered.push(notInHandId);
    const sa = mkSa(
      "Discard",
      {
        Mode: { kind: "literal", raw: "Defined" },
        DefinedCards: { kind: "literal", raw: "RememberedCards" },
        NumCards: { kind: "literal", raw: "2" },
      },
      sourceId,
      seat0,
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    // The in-hand remembered card moved to graveyard; the not-in-hand id was filtered.
    expect(inHandCard.zone).toBe(ZoneType.Graveyard);
  });

  it("TargetedCard expands to the SA's targets (intersected with hand)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(4010);
    seedSourceCard(game, sourceId);
    const hand = game.getPlayer(seat0).zones.get(ZoneType.Hand);
    const inHandId = mkEntityId(4011);
    const inHandCard = new Card(inHandId, plainPaper, seat0, seat0, ZoneType.Hand);
    game.cards.set(inHandId, inHandCard);
    hand?.add(inHandId);
    // Discard's resolveDiscarderSeat treats sa.targets[0] as a PlayerSeat,
    // so cards built around TargetedCard typically pass [seat, cardId, ...].
    // Wave 85 follows that shape: targets[0] = seat0, targets[1] = the
    // in-hand card the TargetedCard token resolves against.
    const sa = new SpellAbility(
      {
        kind: "spell",
        effect: {
          handlerKey: "Discard",
          params: {
            Mode: { kind: "literal", raw: "Defined" },
            DefinedCards: { kind: "literal", raw: "TargetedCard" },
            NumCards: { kind: "literal", raw: "1" },
          } as never,
        },
        cost: { raw: "" },
      },
      sourceId,
      seat0,
      new Map(),
      [seat0 as unknown as ReturnType<typeof mkEntityId>, inHandId],
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(inHandCard.zone).toBe(ZoneType.Graveyard);
  });
});

// ---------------------------------------------------------------------------
// (2) EndTurn — exiles every stack item per CR 723.4
// ---------------------------------------------------------------------------

describe("Wave 85 — EndTurn: drains stack and emits StackItemCountered per item", () => {
  it("drains every stack item; emits one StackItemCountered per popped item", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(4100);
    seedSourceCard(game, sourceId);
    const stack = game.sharedZones.stack;
    const mkStack = (id: number, sourceCardId: number): StackItem => ({
      id: mkEntityId(id),
      sourceCardId: mkEntityId(sourceCardId),
      controllerSeat: seat0,
      kind: "spell",
      isCast: true,
      targets: null,
      modes: [],
      xValue: null,
      costPaid: null,
      provenance: {
        originZone: ZoneType.Hand,
        altCostUsed: null,
        additionalCostsPaid: [],
      },
    });
    stack.push(mkStack(4101, 4102));
    stack.push(mkStack(4103, 4104));
    expect(stack.size).toBe(2);
    const sa = mkSa("EndTurn", {}, sourceId, seat0);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(stack.size).toBe(0);
    const events = yields
      .filter(
        (
          y,
        ): y is {
          kind: "event";
          event: { kind: string; payload: { stackItemId: unknown; byEffectId?: unknown } };
        } => typeof y === "object" && y !== null && (y as { kind?: string }).kind === "event",
      )
      .map((y) => y.event)
      .filter((e) => e.kind === "StackItemCountered");
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.payload.byEffectId).toBe(sourceId);
    }
  });
});

// ---------------------------------------------------------------------------
// (3) BidLife — routes through game.action.changeLife so LifeLost fires
// ---------------------------------------------------------------------------

describe("Wave 85 — BidLife: routes through game.action.changeLife", () => {
  it("emits LifeChanged + LifeLost when the controller pays 1 life", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(4200);
    seedSourceCard(game, sourceId);
    const player = game.getPlayer(seat0);
    const lifeBefore = player.life;
    const sa = mkSa("BidLife", {}, sourceId, seat0);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(player.life).toBe(lifeBefore - 1);
    const eventKinds = yields
      .filter(
        (y): y is { kind: "event"; event: { kind: string } } =>
          typeof y === "object" && y !== null && (y as { kind?: string }).kind === "event",
      )
      .map((y) => y.event.kind);
    expect(eventKinds).toContain("LifeChanged");
    expect(eventKinds).toContain("LifeLost");
  });
});

// ---------------------------------------------------------------------------
// (4) Airbend — registers a Layer 6 kw-grant (Flying) per target, EOT-bounded
// ---------------------------------------------------------------------------

describe("Wave 85 — Airbend: grants Flying via Layer 6 untilEndOfTurn", () => {
  it("registers a kw-grant for Flying on each target with untilEndOfTurn duration", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(4300);
    seedSourceCard(game, sourceId);
    const targetId = mkEntityId(4301);
    const t = new Card(targetId, plainPaper, seat0, seat0, ZoneType.Battlefield);
    game.cards.set(targetId, t);
    game.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(targetId);
    const before = game.continuousEffectRegistry.all().length;
    const sa = mkSa("Airbend", {}, sourceId, seat0, [targetId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const after = game.continuousEffectRegistry.all();
    expect(after.length).toBe(before + 1);
    const newCe = after[after.length - 1] as ContinuousEffect;
    expect(newCe.duration.kind).toBe("untilEndOfTurn");
    // The card was tapped as part of Airbend's primary effect.
    expect(t.tapped).toBe(true);
    // The continuous effect's payload should be a kw-grant.
    expect((newCe.payload as { kind: string }).kind).toBe("kw-grant");
  });
});

// ---------------------------------------------------------------------------
// (5) GainControlVariant — Until$ EOT routes through ControlChangeLedger
// ---------------------------------------------------------------------------

describe("Wave 85 — GainControlVariant: Until$ EOT records prior controller", () => {
  it("Until$ EOT records the prior controller in the ControlChangeLedger", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(4400);
    seedSourceCard(game, sourceId);
    // Target is a creature controlled by seat1; seat0 takes control "until EOT".
    const targetId = mkEntityId(4401);
    const t = new Card(targetId, plainPaper, seat1, seat1, ZoneType.Battlefield);
    game.cards.set(targetId, t);
    game.getPlayer(seat1).zones.get(ZoneType.Battlefield)?.add(targetId);
    const sa = mkSa("GainControlVariant", { Until: { kind: "literal", raw: "EOT" } }, sourceId, seat0, [
      targetId,
    ]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(t.controllerSeat).toBe(seat0);
    // The ledger should have an entry for the target with the prior controller (seat1).
    const ledgerEntry = game.controlChangeLedger.get(targetId);
    expect(ledgerEntry).toBeDefined();
    expect(ledgerEntry?.priorController).toBe(seat1);
  });

  it("no Until$ leaves ledger empty (legacy permanent control change)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    const sourceId = mkEntityId(4410);
    seedSourceCard(game, sourceId);
    const targetId = mkEntityId(4411);
    const t = new Card(targetId, plainPaper, seat1, seat1, ZoneType.Battlefield);
    game.cards.set(targetId, t);
    game.getPlayer(seat1).zones.get(ZoneType.Battlefield)?.add(targetId);
    const sa = mkSa("GainControlVariant", {}, sourceId, seat0, [targetId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(t.controllerSeat).toBe(seat0);
    expect(game.controlChangeLedger.get(targetId)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (6) DigMultiple — DestinationZone$ + ChangeNum$ ladder
// ---------------------------------------------------------------------------

describe("Wave 85 — DigMultiple: ChangeNum$ moves cards to DestinationZone$", () => {
  it("moves ChangeNum cards per Repeat to the DestinationZone (Hand) via moveTo", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(4500);
    seedSourceCard(game, sourceId);
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    if (!lib) throw new Error("no library");
    // Seed 4 cards in the library.
    const ids: ReturnType<typeof mkEntityId>[] = [];
    for (let i = 0; i < 4; i++) {
      const id = mkEntityId(4510 + i);
      const c = new Card(id, plainPaper, seat0, seat0, ZoneType.Library);
      game.cards.set(id, c);
      lib.add(id);
      ids.push(id);
    }
    const handBefore = game.getPlayer(seat0).zones.get(ZoneType.Hand)?.size ?? 0;
    const sa = mkSa(
      "DigMultiple",
      {
        Repeat: { kind: "literal", raw: "1" },
        DigNum: { kind: "literal", raw: "3" },
        ChangeNum: { kind: "literal", raw: "2" },
        DestinationZone: { kind: "literal", raw: "Hand" },
      },
      sourceId,
      seat0,
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const handAfter = game.getPlayer(seat0).zones.get(ZoneType.Hand)?.size ?? 0;
    expect(handAfter).toBe(handBefore + 2);
  });

  it("ChangeNum=0 leaves the library untouched (legacy MVP shape)", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const sourceId = mkEntityId(4520);
    seedSourceCard(game, sourceId);
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    if (!lib) throw new Error("no library");
    for (let i = 0; i < 3; i++) {
      const id = mkEntityId(4530 + i);
      const c = new Card(id, plainPaper, seat0, seat0, ZoneType.Library);
      game.cards.set(id, c);
      lib.add(id);
    }
    const libBefore = lib.size;
    const sa = mkSa(
      "DigMultiple",
      {
        Repeat: { kind: "literal", raw: "1" },
        DigNum: { kind: "literal", raw: "2" },
      },
      sourceId,
      seat0,
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(lib.size).toBe(libBefore);
    // Still records the dug ids on remembered.
    const source = game.cards.get(sourceId);
    expect(source?.remembered.length).toBeGreaterThanOrEqual(2);
  });
});
