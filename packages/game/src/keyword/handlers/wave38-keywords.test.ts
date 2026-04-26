// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 38 — smoke tests for Channel / Transmute / Replicate / Recover /
// Scavenge / Reinforce / Strive keyword handlers and the Retrace
// AltCost. Each test exercises only the durable contract of its
// mechanic — handler registration, keyword stamping, and the data-layer
// side effect (synthesized SpellAbility, registered TriggeredAbility,
// or AltCost-registry presence).
import "../../ability/effects/index.js";
import "../../altcost/index.js";
import "./index.js";
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../../card.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { altCostRegistry } from "../../registries/alt-cost-registry.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import { ChannelKeywordHandler } from "./channel-keyword.js";
import { RecoverKeywordHandler } from "./recover-keyword.js";
import { ReinforceKeywordHandler } from "./reinforce-keyword.js";
import { ReplicateKeywordHandler } from "./replicate-keyword.js";
import { ScavengeKeywordHandler } from "./scavenge-keyword.js";
import { StriveKeywordHandler } from "./strive-keyword.js";
import { TransmuteKeywordHandler } from "./transmute-keyword.js";

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
  edition: "TST",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

const ALICE = mkPlayerSeat(0);

const mkGame = () => {
  const game = new Game({ lobbyPlayers: [aliceLP, bobLP], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
  }
  return game;
};

describe("Wave 38 keyword handlers — registration", () => {
  it("ChannelKeywordHandler is registered under 'channel'", () => {
    expect(keywordHandlerRegistry.has("channel")).toBe(true);
  });
  it("TransmuteKeywordHandler is registered under 'transmute'", () => {
    expect(keywordHandlerRegistry.has("transmute")).toBe(true);
  });
  it("ReplicateKeywordHandler is registered under 'replicate'", () => {
    expect(keywordHandlerRegistry.has("replicate")).toBe(true);
  });
  it("RecoverKeywordHandler is registered under 'recover'", () => {
    expect(keywordHandlerRegistry.has("recover")).toBe(true);
  });
  it("ScavengeKeywordHandler is registered under 'scavenge'", () => {
    expect(keywordHandlerRegistry.has("scavenge")).toBe(true);
  });
  it("ReinforceKeywordHandler is registered under 'reinforce'", () => {
    expect(keywordHandlerRegistry.has("reinforce")).toBe(true);
  });
  it("StriveKeywordHandler is registered under 'strive'", () => {
    expect(keywordHandlerRegistry.has("strive")).toBe(true);
  });
  it("Retrace AltCost is registered", () => {
    expect(altCostRegistry.lookup("Retrace")).not.toBeNull();
  });
});

describe("Wave 38 — Channel synthesizes a Hand-zone activated SpellAbility", () => {
  it("stamps `channel` keyword and pushes a SpellAbility with Hand activeInZone", () => {
    const game = mkGame();
    const id = mkEntityId(380);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new ChannelKeywordHandler().activate(
      {
        keyword: "channel",
        params: {
          cost: { kind: "literal", raw: "1 G" },
          effect: { kind: "literal", raw: "ChEff" },
        },
      },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("channel")).toBe(true);
    expect(card.spellAbilities.length).toBe(1);
    const sa = card.spellAbilities[0];
    expect(sa?.activeInZones.has(ZoneType.Hand)).toBe(true);
    expect(sa?.handlerKey).toBe("Channel");
    expect(sa?.tags.has("channel")).toBe(true);
  });
});

describe("Wave 38 — Transmute synthesizes a sorcery-speed Hand-zone SpellAbility", () => {
  it("stamps `transmute` keyword and pushes a sorcery-speed SpellAbility", () => {
    const game = mkGame();
    const id = mkEntityId(381);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new TransmuteKeywordHandler().activate(
      { keyword: "transmute", params: { cost: { kind: "literal", raw: "1 U U" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("transmute")).toBe(true);
    expect(card.spellAbilities.length).toBe(1);
    const sa = card.spellAbilities[0];
    expect(sa?.activeInZones.has(ZoneType.Hand)).toBe(true);
    expect(sa?.handlerKey).toBe("Transmute");
    expect(sa?.tags.has("sorcery_speed")).toBe(true);
  });
});

describe("Wave 38 — Replicate registers a SpellCast self-trigger", () => {
  it("stamps `replicate` keyword and registers a triggered ability on Stack", () => {
    const game = mkGame();
    const id = mkEntityId(382);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new ReplicateKeywordHandler().activate(
      { keyword: "replicate", params: { cost: { kind: "literal", raw: "1 R" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("replicate")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
    const ta = card.triggeredAbilities?.[0];
    expect(ta?.activeInZones.has(ZoneType.Stack)).toBe(true);
  });
});

describe("Wave 38 — Recover registers a Graveyard-zone LTB trigger", () => {
  it("stamps `recover` keyword and registers a triggered ability on Graveyard", () => {
    const game = mkGame();
    const id = mkEntityId(383);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Graveyard);
    game.cards.set(id, card);
    new RecoverKeywordHandler().activate(
      { keyword: "recover", params: { cost: { kind: "literal", raw: "2 B" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("recover")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
    const ta = card.triggeredAbilities?.[0];
    expect(ta?.activeInZones.has(ZoneType.Graveyard)).toBe(true);
  });
});

describe("Wave 38 — Scavenge synthesizes a Graveyard-zone activated SpellAbility", () => {
  it("stamps `scavenge` keyword and pushes a sorcery-speed Graveyard SpellAbility", () => {
    const game = mkGame();
    const id = mkEntityId(384);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Graveyard);
    game.cards.set(id, card);
    new ScavengeKeywordHandler().activate(
      { keyword: "scavenge", params: { cost: { kind: "literal", raw: "1 G G" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("scavenge")).toBe(true);
    expect(card.spellAbilities.length).toBe(1);
    const sa = card.spellAbilities[0];
    expect(sa?.activeInZones.has(ZoneType.Graveyard)).toBe(true);
    expect(sa?.handlerKey).toBe("Scavenge");
    expect(sa?.tags.has("sorcery_speed")).toBe(true);
  });
});

describe("Wave 38 — Reinforce synthesizes a Hand-zone activated SpellAbility", () => {
  it("stamps `reinforce` keyword and pushes a Hand SpellAbility with Amount param", () => {
    const game = mkGame();
    const id = mkEntityId(385);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new ReinforceKeywordHandler().activate(
      {
        keyword: "reinforce",
        params: {
          amount: { kind: "literal", raw: "2" },
          cost: { kind: "literal", raw: "1 G" },
        },
      },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("reinforce")).toBe(true);
    expect(card.spellAbilities.length).toBe(1);
    const sa = card.spellAbilities[0];
    expect(sa?.activeInZones.has(ZoneType.Hand)).toBe(true);
    expect(sa?.handlerKey).toBe("Reinforce");
    const amountParam = sa?.ast.effect.params.Amount;
    expect(amountParam?.kind).toBe("literal");
    expect(amountParam && amountParam.kind === "literal" ? amountParam.raw : null).toBe("2");
  });
});

describe("Wave 38 — Strive stamps the keyword and surcharge slot", () => {
  it("stamps `strive` keyword and the striveExtraCost slot on the card", () => {
    const game = mkGame();
    const id = mkEntityId(386);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new StriveKeywordHandler().activate(
      { keyword: "strive", params: { cost: { kind: "literal", raw: "1 W" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("strive")).toBe(true);
    const slot = (card as unknown as { striveExtraCost?: string }).striveExtraCost;
    expect(slot).toBe("1 W");
  });
});
