// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 71 — Suspect mechanic (CR 701.58, Murders at Karlov Manor) smoke
// tests covering:
//   1. K:Suspect keyword handler registration + activate stamps the
//      keyword set entry and card.suspected = true.
//   2. AB$ Suspect resolver flips card.suspected = true and emits
//      CardSuspected.
//   3. Suspected creature reports menace via hasKeyword (Layer-6
//      synthesis).
//   4. Suspected creature can't block (canBlock returns false).
//   5. AB$ CeaseBeingSuspected resolver flips card.suspected = undefined
//      and emits CardUnsuspected.
//   6. Card.Suspected filter qualifier matches when the flag is true.
//   7. AlterAttribute | Attributes$ Suspected toggles the same flag
//      (Forge canonical surface).
//   8. CR 701.58d guard — re-suspecting a suspected creature is a no-op.
import "../../ability/effects/index.js";
import "../../altcost/index.js";
import "./index.js";
import type { LobbyPlayer, PaperCard, SVarAst } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { effectRegistry } from "../../ability/effect-registry.js";
import { SpellAbility } from "../../ability/spell-ability.js";
import { Card } from "../../card.js";
import { hasKeyword } from "../../combat/damage-assignment-helpers.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { canBlock } from "../../statics/wave65-combat-gates.js";
import { cardMatchesFilter } from "../../trigger/card-filter.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Hand } from "../../zone/zones/hand.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import { SuspectKeywordHandler } from "./suspect-keyword.js";

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
const paper: PaperCard = {
  name: "Test",
  edition: "MKM",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const ALICE = mkPlayerSeat(0);

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [aliceLP, bobLP], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
  }
  return game;
};

const mkSa = (
  handlerKey: string,
  params: Record<string, { kind: string; raw: string }>,
  sourceId = mkEntityId(7100),
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

const drainGen = (gen: Generator<unknown, void, unknown>): unknown[] => {
  const out: unknown[] = [];
  let r = gen.next();
  while (!r.done) {
    out.push(r.value);
    r = gen.next();
  }
  return out;
};

describe("Wave 71 — Suspect keyword registration", () => {
  it("SuspectKeywordHandler is registered under 'suspect'", () => {
    expect(keywordHandlerRegistry.lookup("suspect")).toBe(SuspectKeywordHandler);
  });
  it("Suspect / CeaseBeingSuspected effect handlers are registered", () => {
    expect(effectRegistry.has("Suspect")).toBe(true);
    expect(effectRegistry.has("CeaseBeingSuspected")).toBe(true);
  });
});

describe("Wave 71 — K:Suspect keyword handler", () => {
  it("activate stamps the keyword set entry + flips card.suspected = true", () => {
    const game = mkGame();
    const id = mkEntityId(7110);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new SuspectKeywordHandler().activate(
      { keyword: "suspect" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("suspect")).toBe(true);
    expect(card.suspected).toBe(true);
  });
});

describe("Wave 71 — AB$ Suspect effect", () => {
  it("flips card.suspected = true on each target and emits CardSuspected", () => {
    const game = mkGame();
    const sourceId = mkEntityId(7120);
    const targetId = mkEntityId(7121);
    const source = new Card(sourceId, paper, ALICE, ALICE, ZoneType.Battlefield);
    const target = new Card(targetId, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(sourceId, source);
    game.cards.set(targetId, target);
    expect(target.suspected).toBeUndefined();

    const sa = mkSa("Suspect", {}, sourceId, ALICE, [targetId]);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(target.suspected).toBe(true);
    const events = yields.filter((y) => (y as { kind?: string }).kind === "event") as {
      event: { kind: string };
    }[];
    expect(events.some((e) => e.event.kind === "CardSuspected")).toBe(true);
  });
});

describe("Wave 71 — Suspected creature has menace (Layer-6 synthesis)", () => {
  it("hasKeyword(menace) returns true while card.suspected is set", () => {
    const game = mkGame();
    const id = mkEntityId(7130);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    // Pre-state: not suspected, no menace.
    expect(hasKeyword(game, id, "menace")).toBe(false);
    card.suspected = true;
    expect(hasKeyword(game, id, "menace")).toBe(true);
    // Other keywords not synthesized.
    expect(hasKeyword(game, id, "flying")).toBe(false);
  });
});

describe("Wave 71 — Suspected creature can't block", () => {
  it("canBlock returns false while card.suspected is set", () => {
    const game = mkGame();
    const id = mkEntityId(7140);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    expect(canBlock(game, id)).toBe(true);
    card.suspected = true;
    expect(canBlock(game, id)).toBe(false);
    card.suspected = undefined;
    expect(canBlock(game, id)).toBe(true);
  });
});

describe("Wave 71 — AB$ CeaseBeingSuspected effect", () => {
  it("flips card.suspected = undefined and emits CardUnsuspected", () => {
    const game = mkGame();
    const sourceId = mkEntityId(7150);
    const targetId = mkEntityId(7151);
    const source = new Card(sourceId, paper, ALICE, ALICE, ZoneType.Battlefield);
    const target = new Card(targetId, paper, ALICE, ALICE, ZoneType.Battlefield);
    target.suspected = true;
    game.cards.set(sourceId, source);
    game.cards.set(targetId, target);

    const sa = mkSa("CeaseBeingSuspected", {}, sourceId, ALICE, [targetId]);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(target.suspected).toBeUndefined();
    const events = yields.filter((y) => (y as { kind?: string }).kind === "event") as {
      event: { kind: string };
    }[];
    expect(events.some((e) => e.event.kind === "CardUnsuspected")).toBe(true);
  });
});

describe("Wave 71 — Card.Suspected filter qualifier", () => {
  it("matches when card.suspected === true; rejects otherwise", () => {
    const game = mkGame();
    const id = mkEntityId(7160);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    const ctx = { controllerSeat: ALICE, sourceCardId: id };
    // Not suspected — Card.Suspected rejects.
    expect(cardMatchesFilter(card, "Card.Suspected", ctx)).toBe(false);
    card.suspected = true;
    // Suspected — Card.Suspected matches.
    expect(cardMatchesFilter(card, "Card.Suspected", ctx)).toBe(true);
    // IsSuspected alias also accepted.
    expect(cardMatchesFilter(card, "Card.IsSuspected", ctx)).toBe(true);
    // Bare Card matches regardless.
    expect(cardMatchesFilter(card, "Card", ctx)).toBe(true);
  });
});

describe("Wave 71 — AlterAttribute | Attributes$ Suspected (Forge surface)", () => {
  it("activate=default flips card.suspected = true; Activate$ False clears it", () => {
    const game = mkGame();
    const sourceId = mkEntityId(7170);
    const source = new Card(sourceId, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(sourceId, source);

    // Suspect self via the Forge canonical surface.
    const saSet = mkSa("AlterAttribute", { Attributes: { kind: "literal", raw: "Suspected" } }, sourceId);
    drainGen(saSet.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(source.suspected).toBe(true);

    // Cease being suspected via Activate$ False.
    const saClear = mkSa(
      "AlterAttribute",
      {
        Attributes: { kind: "literal", raw: "Suspected" },
        Activate: { kind: "literal", raw: "False" },
      },
      sourceId,
    );
    drainGen(saClear.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    expect(source.suspected).toBeUndefined();
  });
});

describe("Wave 71 — CR 701.58d already-suspected guard", () => {
  it("Suspect on an already-suspected creature is a no-op (no duplicate event)", () => {
    const game = mkGame();
    const sourceId = mkEntityId(7180);
    const targetId = mkEntityId(7181);
    const source = new Card(sourceId, paper, ALICE, ALICE, ZoneType.Battlefield);
    const target = new Card(targetId, paper, ALICE, ALICE, ZoneType.Battlefield);
    target.suspected = true;
    game.cards.set(sourceId, source);
    game.cards.set(targetId, target);

    const sa = mkSa("Suspect", {}, sourceId, ALICE, [targetId]);
    const yields = drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);
    const events = yields.filter((y) => (y as { kind?: string }).kind === "event") as {
      event: { kind: string };
    }[];

    expect(target.suspected).toBe(true);
    expect(events.some((e) => e.event.kind === "CardSuspected")).toBe(false); // no extra event
  });
});

describe("Wave 71 — Card slot defaults", () => {
  it("card.suspected defaults to undefined", () => {
    const game = mkGame();
    const id = mkEntityId(7190);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    expect(card.suspected).toBeUndefined();
  });
});
