// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 83 — Effect handler TODO sweep round 4.
//
// Closes inline TODO(advanced) tails on six effect handlers:
//   * wave-21:Manifest        — properly stamp `card.faceDown.kind = "manifest"`
//     on the canonical typed slot (instead of an `unknown` cast), bump the
//     layer-engine epoch so Layer 1's face-down override (CR 708.2)
//     re-derives the public characteristics to a 2/2 vanilla creature, and
//     emit FaceDownStateChanged so observers see the transition.
//   * wave-21:ManifestDread   — yield a typed `chooseCard` decision so the
//     controller picks which of the top 2 cards is manifested vs. milled.
//     Also stamp the canonical face-down slot + bump the epoch + emit
//     FaceDownStateChanged on the manifested card. On missing response the
//     legacy "first manifested, second milled" deterministic order holds.
//   * wave-21:StoreSVar       — alongside the prior raw-string slot
//     (`storedSVars`), evaluate the `Expression$` param to a number and
//     stash it on `storedSVarValues` so future SVar-driven calculations can
//     read the stored numeric result without re-evaluating each time.
//   * wave-19:BecomesBlocked  — register a one-shot delayed trigger per
//     target on game.delayedTriggerQueue that fires on the next
//     AttackerBecomesBlocked event whose attackerId matches. The match
//     stamps a `becomesBlockedTriggered` set on the source card so test
//     observers can correlate the firing without minting a new event kind.
//   * wave-19:FlipOntoBattlefield — honor `WinIfFlippedHeads$ True` /
//     `LoseIfTails$ True` flag params: route through game.action.gameWin /
//     game.action.gameLoss when set so PlayerWon / PlayerLost emit and
//     replacements (Platinum-Angel-style) can deny.
//   * wave-22:Clash           — peek the top of each player's library,
//     compare actual computed mana values via the LayerEngine, declare
//     the winner per CR 701.4d (ties → no winner), and yield chooseOption
//     so each revealing player picks keep-on-top vs. send-to-bottom.
import "./index.js";
import { parseCard } from "@mtg-forge-ts/cards";
import type { LobbyPlayer, PaperCard, SVarAst } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
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

const costPaper = (name: string, manaCost: string): PaperCard => ({
  name,
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: parseCard(
    `${[`Name:${name}`, `ManaCost:${manaCost}`, "Types:Creature Elf", "PT:1/1", "Oracle:Test"].join("\n")}\n`,
    `${name}.txt`,
  ),
});

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
  svars?: ReadonlyMap<string, SVarAst>,
) =>
  new SpellAbility(
    {
      kind: "spell",
      effect: { handlerKey, params: params as never },
      cost: { raw: "" },
    },
    sourceId,
    controllerSeat,
    svars ?? new Map(),
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

const seedLibraryCard = (
  game: Game,
  paper: PaperCard,
  seat: ReturnType<typeof mkPlayerSeat>,
  id: ReturnType<typeof mkEntityId>,
): Card => {
  const c = new Card(id, paper, seat, seat, ZoneType.Library);
  game.cards.set(id, c);
  const lib = game.getPlayer(seat).zones.get(ZoneType.Library);
  lib?.add(id);
  return c;
};

// ---------------------------------------------------------------------------
// (1) Manifest — face-down state + epoch bump + FaceDownStateChanged
// ---------------------------------------------------------------------------

describe("Wave 83 — Manifest: stamps face-down state + emits FaceDownStateChanged", () => {
  it("sets faceDown.kind to 'manifest' on the moved card and emits FaceDownStateChanged", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(2000));
    const seat0 = mkPlayerSeat(0);
    const cardId = mkEntityId(2001);
    seedLibraryCard(game, plainPaper, seat0, cardId);
    const sa = mkSa("Manifest", { Amount: { kind: "literal", raw: "1" } }, mkEntityId(2000), seat0);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const card = game.cards.get(cardId);
    expect(card?.faceDown.kind).toBe("manifest");
    expect(card?.zone).toBe(ZoneType.Battlefield);
    const fdsc = yields.filter(
      (y) => (y as { event?: { kind: string } }).event?.kind === "FaceDownStateChanged",
    );
    expect(fdsc.length).toBe(1);
    const payload = (fdsc[0] as { event: { payload: { cardId: unknown; faceDown: boolean } } }).event.payload;
    expect(payload.cardId).toBe(cardId);
    expect(payload.faceDown).toBe(true);
  });

  it("Layer 1 face-down override applies after Manifest (2/2 vanilla creature)", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(2010));
    const seat0 = mkPlayerSeat(0);
    const cardId = mkEntityId(2011);
    seedLibraryCard(game, costPaper("BigGuy", "5 G"), seat0, cardId);
    const sa = mkSa("Manifest", { Amount: { kind: "literal", raw: "1" } }, mkEntityId(2010), seat0);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const chars = game.layerEngine.computeCharacteristics(cardId);
    expect(chars.power).toBe(2);
    expect(chars.toughness).toBe(2);
    expect(chars.name).toBe("");
  });
});

// ---------------------------------------------------------------------------
// (2) ManifestDread — chooseCard decision picks which is manifested vs milled
// ---------------------------------------------------------------------------

describe("Wave 83 — ManifestDread: yields chooseCard decision", () => {
  it("yields chooseCard; controller's response pins the manifested id, mills the other", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(2100));
    const seat0 = mkPlayerSeat(0);
    const id1 = mkEntityId(2101);
    const id2 = mkEntityId(2102);
    seedLibraryCard(game, plainPaper, seat0, id1);
    seedLibraryCard(game, plainPaper, seat0, id2);
    const sa = mkSa("ManifestDread", {}, mkEntityId(2100), seat0);
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    const r = gen.next();
    expect(r.done).toBe(false);
    const decision = r.value as { kind: string; request: { kind: string } };
    expect(decision.kind).toBe("decision");
    expect(decision.request.kind).toBe("chooseCard");
    // Pick id2 (the second top card) as the manifested one.
    let r2 = gen.next({ kind: "chooseCard", chosen: [id2] });
    while (!r2.done) r2 = gen.next();
    const c1 = game.cards.get(id1);
    const c2 = game.cards.get(id2);
    expect(c2?.zone).toBe(ZoneType.Battlefield);
    expect(c2?.faceDown.kind).toBe("manifest");
    expect(c1?.zone).toBe(ZoneType.Graveyard);
  });

  it("falls back to first-manifested / second-milled on missing response", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(2110));
    const seat0 = mkPlayerSeat(0);
    const id1 = mkEntityId(2111);
    const id2 = mkEntityId(2112);
    seedLibraryCard(game, plainPaper, seat0, id1);
    seedLibraryCard(game, plainPaper, seat0, id2);
    const sa = mkSa("ManifestDread", {}, mkEntityId(2110), seat0);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const c1 = game.cards.get(id1);
    const c2 = game.cards.get(id2);
    expect(c1?.zone).toBe(ZoneType.Battlefield);
    expect(c1?.faceDown.kind).toBe("manifest");
    expect(c2?.zone).toBe(ZoneType.Graveyard);
  });
});

// ---------------------------------------------------------------------------
// (3) StoreSVar — evaluates Expression to numeric in storedSVarValues
// ---------------------------------------------------------------------------

describe("Wave 83 — StoreSVar: evaluates Expression to numeric slot", () => {
  it("populates storedSVarValues with the parsed numeric value alongside the raw map", () => {
    const game = mkGame();
    const source = seedSourceCard(game, mkEntityId(2200));
    const sa = mkSa(
      "StoreSVar",
      {
        SVar: { kind: "literal", raw: "Damage" },
        Expression: { kind: "literal", raw: "7" },
      },
      mkEntityId(2200),
      mkPlayerSeat(0),
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const raw = (source as unknown as { storedSVars?: Map<string, string> }).storedSVars;
    const numeric = (source as unknown as { storedSVarValues?: Map<string, number> }).storedSVarValues;
    expect(raw?.get("Damage")).toBe("7");
    expect(numeric?.get("Damage")).toBe(7);
  });

  it("omits the numeric slot for unparseable expressions (back-compat raw still set)", () => {
    const game = mkGame();
    const source = seedSourceCard(game, mkEntityId(2210));
    const sa = mkSa(
      "StoreSVar",
      {
        SVar: { kind: "literal", raw: "Mystery" },
        Expression: { kind: "literal", raw: "NotANumber" },
      },
      mkEntityId(2210),
      mkPlayerSeat(0),
    );
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const raw = (source as unknown as { storedSVars?: Map<string, string> }).storedSVars;
    const numeric = (source as unknown as { storedSVarValues?: Map<string, number> }).storedSVarValues;
    expect(raw?.get("Mystery")).toBe("NotANumber");
    expect(numeric?.has("Mystery")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (4) BecomesBlocked — registers a one-shot delayed trigger
// ---------------------------------------------------------------------------

describe("Wave 83 — BecomesBlocked: registers a one-shot delayed trigger", () => {
  it("queue size grows by 1 per target; AttackerBecomesBlocked fire matches and stamps source", () => {
    const game = mkGame();
    const source = seedSourceCard(game, mkEntityId(2300));
    const seat1 = mkPlayerSeat(1);
    const attackerId = mkEntityId(2301);
    const c = new Card(attackerId, plainPaper, seat1, seat1, ZoneType.Battlefield);
    game.cards.set(attackerId, c);
    const bf = game.getPlayer(seat1).zones.get(ZoneType.Battlefield);
    bf?.add(attackerId);
    const sizeBefore = game.delayedTriggerQueue.size();
    const sa = mkSa("BecomesBlocked", {}, mkEntityId(2300), mkPlayerSeat(0), [attackerId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.delayedTriggerQueue.size()).toBe(sizeBefore + 1);
    // Simulate the AttackerBecomesBlocked event firing — drives queue.onEvent.
    const event = {
      kind: "AttackerBecomesBlocked" as const,
      version: 1 as const,
      turn: game.turn,
      phase: game.phase,
      payload: { attackerId },
    };
    game.delayedTriggerQueue.onEvent(event, game.triggerRegistry);
    // One-shot — queue size returns to the pre-register baseline.
    expect(game.delayedTriggerQueue.size()).toBe(sizeBefore);
    const stamped = (source as unknown as { becomesBlockedTriggered?: Set<unknown> }).becomesBlockedTriggered;
    expect(stamped?.has(attackerId)).toBe(true);
  });

  it("non-matching attackerId does not fire / consume the delayed trigger", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(2310));
    const seat1 = mkPlayerSeat(1);
    const attackerId = mkEntityId(2311);
    const otherAttackerId = mkEntityId(2312);
    const c = new Card(attackerId, plainPaper, seat1, seat1, ZoneType.Battlefield);
    game.cards.set(attackerId, c);
    const bf = game.getPlayer(seat1).zones.get(ZoneType.Battlefield);
    bf?.add(attackerId);
    const sizeBefore = game.delayedTriggerQueue.size();
    const sa = mkSa("BecomesBlocked", {}, mkEntityId(2310), mkPlayerSeat(0), [attackerId]);
    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(game.delayedTriggerQueue.size()).toBe(sizeBefore + 1);
    const event = {
      kind: "AttackerBecomesBlocked" as const,
      version: 1 as const,
      turn: game.turn,
      phase: game.phase,
      payload: { attackerId: otherAttackerId },
    };
    game.delayedTriggerQueue.onEvent(event, game.triggerRegistry);
    // Non-matching predicate — queue still has the trigger.
    expect(game.delayedTriggerQueue.size()).toBe(sizeBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// (5) FlipOntoBattlefield — honors WinIfFlippedHeads / LoseIfTails flags
// ---------------------------------------------------------------------------

describe("Wave 83 — FlipOntoBattlefield: honors WinIfFlippedHeads / LoseIfTails flags", () => {
  it("WinIfFlippedHeads=True + heads emits PlayerWon for the controller", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(2400));
    const sa = mkSa(
      "FlipOntoBattlefield",
      { WinIfFlippedHeads: { kind: "literal", raw: "True" } },
      mkEntityId(2400),
      mkPlayerSeat(0),
    );
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const flips = yields.filter((y) => (y as { event?: { kind: string } }).event?.kind === "FlipCoin");
    expect(flips.length).toBe(1);
    const heads = (flips[0] as { event: { payload: { resultHeads: boolean } } }).event.payload.resultHeads;
    if (heads) {
      const won = yields.filter((y) => (y as { event?: { kind: string } }).event?.kind === "PlayerWon");
      expect(won.length).toBeGreaterThanOrEqual(1);
    } else {
      // Tails branch — no win, but no loss either since LoseIfTails wasn't set.
      const won = yields.filter((y) => (y as { event?: { kind: string } }).event?.kind === "PlayerWon");
      const lost = yields.filter((y) => (y as { event?: { kind: string } }).event?.kind === "PlayerLost");
      expect(won.length).toBe(0);
      expect(lost.length).toBe(0);
    }
  });

  it("LoseIfTails=True + tails emits PlayerLost for the controller", () => {
    // Drive both branches by running until at least one of each appears.
    let observedLoss = false;
    let observedNoOp = false;
    for (let seedNum = 0; seedNum < 16 && (!observedLoss || !observedNoOp); seedNum++) {
      const localGame = new Game({
        lobbyPlayers: [alice, bob],
        rules,
        meta,
        rng: new SeededRng(BigInt(seedNum + 100)),
      });
      for (const p of localGame.players) {
        p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
        p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
        p.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, p.seat));
        p.zones.set(ZoneType.Library, new Library(ZoneType.Library, p.seat));
        p.zones.set(ZoneType.Exile, new Exile(ZoneType.Exile, p.seat));
      }
      const sourceId = mkEntityId(2410 + seedNum);
      const seat0 = mkPlayerSeat(0);
      const c = new Card(sourceId, plainPaper, seat0, seat0, ZoneType.Battlefield);
      localGame.cards.set(sourceId, c);
      localGame.getPlayer(seat0).zones.get(ZoneType.Battlefield)?.add(sourceId);
      const sa = mkSa(
        "FlipOntoBattlefield",
        { LoseIfTails: { kind: "literal", raw: "True" } },
        sourceId,
        seat0,
      );
      const yields = drainGen(sa.makeResolver().resolve(localGame) as Generator<unknown, void, unknown>);
      const flip = yields.find((y) => (y as { event?: { kind: string } }).event?.kind === "FlipCoin") as
        | { event: { payload: { resultHeads: boolean } } }
        | undefined;
      const heads = flip?.event.payload.resultHeads ?? false;
      const lost = yields.some((y) => (y as { event?: { kind: string } }).event?.kind === "PlayerLost");
      if (!heads && lost) observedLoss = true;
      if (heads && !lost) observedNoOp = true;
    }
    expect(observedLoss).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (6) Clash — actual MV comparison + chooseOption keep-vs-bottom
// ---------------------------------------------------------------------------

describe("Wave 83 — Clash: peeks libraries, compares mana value, yields chooseOption", () => {
  it("higher MV on the controller's top wins the clash", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(2500));
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    // Controller top: cost 5G (CMC 6); opponent top: cost 1G (CMC 2).
    seedLibraryCard(game, costPaper("Big", "5 G"), seat0, mkEntityId(2501));
    seedLibraryCard(game, costPaper("Small", "1 G"), seat1, mkEntityId(2502));
    const sa = mkSa("Clash", {}, mkEntityId(2500), seat0);
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    let winner: unknown;
    while (!r.done) {
      const v = r.value as { kind?: string; event?: { kind: string; payload: unknown } };
      if (v.event?.kind === "CardClashed") {
        winner = (v.event.payload as { winner: unknown }).winner;
      }
      if (v.kind === "decision") {
        // Each chooser defaults to keep-on-top.
        r = gen.next({ kind: "chooseOption", optionId: "keep" });
      } else {
        r = gen.next();
      }
    }
    expect(winner).toBe(seat0);
  });

  it("ties yield no winner-bottom decisions and CardClashed fires once", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(2510));
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    seedLibraryCard(game, costPaper("EqA", "1 G"), seat0, mkEntityId(2511));
    seedLibraryCard(game, costPaper("EqB", "1 G"), seat1, mkEntityId(2512));
    const sa = mkSa("Clash", {}, mkEntityId(2510), seat0);
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    const decisions: unknown[] = [];
    const events: { kind: string }[] = [];
    let r = gen.next();
    while (!r.done) {
      const v = r.value as { kind?: string; event?: { kind: string } };
      if (v.event) events.push(v.event);
      if (v.kind === "decision") {
        decisions.push(v);
        r = gen.next({ kind: "chooseOption", optionId: "keep" });
      } else {
        r = gen.next();
      }
    }
    // No tie-breaker bottom decisions on a tie.
    expect(decisions.length).toBe(0);
    expect(events.filter((e) => e.kind === "CardClashed").length).toBe(1);
  });

  it("winner can send their revealed card to the bottom of their library", () => {
    const game = mkGame();
    seedSourceCard(game, mkEntityId(2520));
    const seat0 = mkPlayerSeat(0);
    const seat1 = mkPlayerSeat(1);
    // Controller wins, send their top to bottom; opponent keeps on top.
    const winnerTopId = mkEntityId(2521);
    const winnerSecondId = mkEntityId(2522);
    const oppTopId = mkEntityId(2523);
    seedLibraryCard(game, costPaper("Big", "5 G"), seat0, winnerTopId);
    seedLibraryCard(game, plainPaper, seat0, winnerSecondId);
    seedLibraryCard(game, costPaper("Small", "1 G"), seat1, oppTopId);
    const sa = mkSa("Clash", {}, mkEntityId(2520), seat0);
    const gen = sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>;
    let r = gen.next();
    let pickIdx = 0;
    while (!r.done) {
      const v = r.value as { kind?: string };
      if (v.kind === "decision") {
        // First decision is the winner (controller); send to bottom.
        // Second is opponent; keep on top.
        r = gen.next({
          kind: "chooseOption",
          optionId: pickIdx === 0 ? "bottom" : "keep",
        });
        pickIdx++;
      } else {
        r = gen.next();
      }
    }
    // Winner card moved out of slot 0; the originally-second card is now on top.
    const lib = game.getPlayer(seat0).zones.get(ZoneType.Library);
    const ids = lib?.toArray() ?? [];
    expect(ids[0]).toBe(winnerSecondId);
    expect(ids[ids.length - 1]).toBe(winnerTopId);
  });
});
