// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 59 — smoke tests for Affinity (cost-mod static), the final niche
// keyword cleanup batch 3 (Unearth, Read ahead, More Than Meets the Eye,
// For Mirrodin, Job select, Spectacle, Freerunning, Frenzy, Aura swap,
// Ascend, Decayed, Compleated, Double team, Visit, Web-slinging,
// Firebending, Enlist, Ravenous), and the parser keyword cleanup.
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
import { Hand } from "../../zone/zones/hand.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import { AffinityKeywordHandler } from "./affinity-keyword.js";
import { AscendKeywordHandler } from "./ascend-keyword.js";
import { AuraSwapKeywordHandler } from "./aura-swap-keyword.js";
import { CompleatedKeywordHandler } from "./compleated-keyword.js";
import { DecayedKeywordHandler } from "./decayed-keyword.js";
import { DoubleTeamKeywordHandler } from "./double-team-keyword.js";
import { EnlistKeywordHandler } from "./enlist-keyword.js";
import { ForMirrodinKeywordHandler } from "./for-mirrodin-keyword.js";
import { FreerunningKeywordHandler } from "./freerunning-keyword.js";
import { FrenzyKeywordHandler } from "./frenzy-keyword.js";
import { JobSelectKeywordHandler } from "./job-select-keyword.js";
import { MoreThanMeetsTheEyeKeywordHandler } from "./more-than-meets-the-eye-keyword.js";
import { RavenousKeywordHandler } from "./ravenous-keyword.js";
import { ReadAheadKeywordHandler } from "./read-ahead-keyword.js";
import { SpectacleKeywordHandler } from "./spectacle-keyword.js";
import { UnearthKeywordHandler } from "./unearth-keyword.js";
import { VisitKeywordHandler } from "./visit-keyword.js";
import { FirebendingKeywordHandler, WebSlingingKeywordHandler } from "./web-slinging-keyword.js";

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

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [aliceLP, bobLP], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
  }
  return game;
};

describe("Wave 59 keyword handlers — registration", () => {
  it("AffinityKeywordHandler is registered under 'affinity'", () => {
    expect(keywordHandlerRegistry.lookup("affinity")).toBe(AffinityKeywordHandler);
  });
  it("UnearthKeywordHandler is registered under 'unearth'", () => {
    expect(keywordHandlerRegistry.lookup("unearth")).toBe(UnearthKeywordHandler);
  });
  it("ReadAheadKeywordHandler is registered under 'read_ahead'", () => {
    expect(keywordHandlerRegistry.lookup("read_ahead")).toBe(ReadAheadKeywordHandler);
  });
  it("MoreThanMeetsTheEyeKeywordHandler is registered under 'more_than_meets_the_eye'", () => {
    expect(keywordHandlerRegistry.lookup("more_than_meets_the_eye")).toBe(MoreThanMeetsTheEyeKeywordHandler);
  });
  it("ForMirrodinKeywordHandler is registered under 'for_mirrodin'", () => {
    expect(keywordHandlerRegistry.lookup("for_mirrodin")).toBe(ForMirrodinKeywordHandler);
  });
  it("JobSelectKeywordHandler is registered under 'job_select'", () => {
    expect(keywordHandlerRegistry.lookup("job_select")).toBe(JobSelectKeywordHandler);
  });
  it("SpectacleKeywordHandler is registered under 'spectacle'", () => {
    expect(keywordHandlerRegistry.lookup("spectacle")).toBe(SpectacleKeywordHandler);
  });
  it("FreerunningKeywordHandler is registered under 'freerunning'", () => {
    expect(keywordHandlerRegistry.lookup("freerunning")).toBe(FreerunningKeywordHandler);
  });
  it("FrenzyKeywordHandler is registered under 'frenzy'", () => {
    expect(keywordHandlerRegistry.lookup("frenzy")).toBe(FrenzyKeywordHandler);
  });
  it("AuraSwapKeywordHandler is registered under 'aura_swap'", () => {
    expect(keywordHandlerRegistry.lookup("aura_swap")).toBe(AuraSwapKeywordHandler);
  });
  it("AscendKeywordHandler is registered under 'ascend'", () => {
    expect(keywordHandlerRegistry.lookup("ascend")).toBe(AscendKeywordHandler);
  });
  it("DecayedKeywordHandler is registered under 'decayed'", () => {
    expect(keywordHandlerRegistry.lookup("decayed")).toBe(DecayedKeywordHandler);
  });
  it("CompleatedKeywordHandler is registered under 'compleated'", () => {
    expect(keywordHandlerRegistry.lookup("compleated")).toBe(CompleatedKeywordHandler);
  });
  it("DoubleTeamKeywordHandler is registered under 'double_team'", () => {
    expect(keywordHandlerRegistry.lookup("double_team")).toBe(DoubleTeamKeywordHandler);
  });
  it("VisitKeywordHandler is registered under 'visit'", () => {
    expect(keywordHandlerRegistry.lookup("visit")).toBe(VisitKeywordHandler);
  });
  it("WebSlingingKeywordHandler is registered under 'web_slinging'", () => {
    expect(keywordHandlerRegistry.lookup("web_slinging")).toBe(WebSlingingKeywordHandler);
  });
  it("FirebendingKeywordHandler is registered under 'firebending'", () => {
    expect(keywordHandlerRegistry.lookup("firebending")).toBe(FirebendingKeywordHandler);
  });
  it("EnlistKeywordHandler is registered under 'enlist'", () => {
    expect(keywordHandlerRegistry.lookup("enlist")).toBe(EnlistKeywordHandler);
  });
  it("RavenousKeywordHandler is registered under 'ravenous'", () => {
    expect(keywordHandlerRegistry.lookup("ravenous")).toBe(RavenousKeywordHandler);
  });
});

describe("Wave 59 alt-costs — registration", () => {
  it("Unearth AltCost is registered", () => {
    expect(altCostRegistry.has("Unearth")).toBe(true);
  });
  it("Spectacle AltCost is registered", () => {
    expect(altCostRegistry.has("Spectacle")).toBe(true);
  });
  it("Freerunning AltCost is registered", () => {
    expect(altCostRegistry.has("Freerunning")).toBe(true);
  });
});

describe("Wave 59 — Affinity", () => {
  it("activate stamps keyword + affinityFilter + registers a costMod static", () => {
    const game = mkGame();
    const id = mkEntityId(5901);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    const before = game.staticEffectRegistry.byCategory("costModification").length;
    new AffinityKeywordHandler().activate(
      { keyword: "affinity", params: { detail: { kind: "literal", raw: "Card.Artifact" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("affinity")).toBe(true);
    expect(card.affinityFilter).toBe("Card.Artifact");
    expect(game.staticEffectRegistry.byCategory("costModification").length).toBe(before + 1);
  });
});

describe("Wave 59 — Unearth", () => {
  it("activate stamps keyword + unearthCost", () => {
    const game = mkGame();
    const id = mkEntityId(5902);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Graveyard);
    game.cards.set(id, card);
    new UnearthKeywordHandler().activate(
      { keyword: "unearth", params: { cost: { kind: "literal", raw: "1 R" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("unearth")).toBe(true);
    expect(card.unearthCost).toBe("1 R");
  });
});

describe("Wave 59 — Read ahead", () => {
  it("activate stamps keyword + readAhead flag", () => {
    const game = mkGame();
    const id = mkEntityId(5903);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new ReadAheadKeywordHandler().activate(
      { keyword: "read_ahead" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("read_ahead")).toBe(true);
    expect(card.readAhead).toBe(true);
  });
});

describe("Wave 59 — More Than Meets the Eye", () => {
  it("activate stamps keyword + cost", () => {
    const game = mkGame();
    const id = mkEntityId(5904);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new MoreThanMeetsTheEyeKeywordHandler().activate(
      { keyword: "more_than_meets_the_eye", params: { cost: { kind: "literal", raw: "2 W" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("more_than_meets_the_eye")).toBe(true);
    expect(card.moreThanMeetsTheEyeCost).toBe("2 W");
  });
});

describe("Wave 59 — For Mirrodin", () => {
  it("activate stamps keyword + 1 ETB trigger", () => {
    const game = mkGame();
    const id = mkEntityId(5905);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new ForMirrodinKeywordHandler().activate(
      { keyword: "for_mirrodin" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("for_mirrodin")).toBe(true);
    expect(card.forMirrodin).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 59 — Job select", () => {
  it("activate stamps keyword + jobSelectChoices", () => {
    const game = mkGame();
    const id = mkEntityId(5906);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new JobSelectKeywordHandler().activate(
      { keyword: "job_select", params: { detail: { kind: "literal", raw: "warrior,mage" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("job_select")).toBe(true);
    expect(card.jobSelectChoices).toBe("warrior,mage");
  });
});

describe("Wave 59 — Spectacle", () => {
  it("activate stamps keyword + spectacleCost", () => {
    const game = mkGame();
    const id = mkEntityId(5907);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new SpectacleKeywordHandler().activate(
      { keyword: "spectacle", params: { cost: { kind: "literal", raw: "R" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("spectacle")).toBe(true);
    expect(card.spectacleCost).toBe("R");
  });
});

describe("Wave 59 — Freerunning", () => {
  it("activate stamps keyword + freerunningCost", () => {
    const game = mkGame();
    const id = mkEntityId(5908);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new FreerunningKeywordHandler().activate(
      { keyword: "freerunning", params: { cost: { kind: "literal", raw: "1 B" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("freerunning")).toBe(true);
    expect(card.freerunningCost).toBe("1 B");
  });
});

describe("Wave 59 — Frenzy", () => {
  it("activate stamps keyword + 1 attacks-unblocked-trigger + frenzyAmount", () => {
    const game = mkGame();
    const id = mkEntityId(5909);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new FrenzyKeywordHandler().activate(
      { keyword: "frenzy", params: { amount: { kind: "literal", raw: "2" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("frenzy")).toBe(true);
    expect(card.frenzyAmount).toBe(2);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 59 — Aura swap", () => {
  it("activate stamps keyword + auraSwap cost", () => {
    const game = mkGame();
    const id = mkEntityId(5910);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new AuraSwapKeywordHandler().activate(
      { keyword: "aura_swap", params: { cost: { kind: "literal", raw: "1 W" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("aura_swap")).toBe(true);
    expect(card.auraSwap).toBe("1 W");
  });
});

describe("Wave 59 — Ascend", () => {
  it("activate stamps keyword + 1 trigger", () => {
    const game = mkGame();
    const id = mkEntityId(5911);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new AscendKeywordHandler().activate(
      { keyword: "ascend" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("ascend")).toBe(true);
    expect(card.ascend).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 59 — Decayed", () => {
  it("activate stamps keyword + decayed flag", () => {
    const game = mkGame();
    const id = mkEntityId(5912);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new DecayedKeywordHandler().activate(
      { keyword: "decayed" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("decayed")).toBe(true);
    expect(card.decayed).toBe(true);
  });
});

describe("Wave 59 — Compleated", () => {
  it("activate stamps keyword + compleated flag", () => {
    const game = mkGame();
    const id = mkEntityId(5913);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new CompleatedKeywordHandler().activate(
      { keyword: "compleated" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("compleated")).toBe(true);
    expect(card.compleated).toBe(true);
  });
});

describe("Wave 59 — Double team", () => {
  it("activate stamps keyword + 1 spellcast-self-trigger", () => {
    const game = mkGame();
    const id = mkEntityId(5914);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Stack);
    game.cards.set(id, card);
    new DoubleTeamKeywordHandler().activate(
      { keyword: "double_team" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("double_team")).toBe(true);
    expect(card.doubleTeam).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 59 — Visit", () => {
  it("activate stamps keyword + visit flag", () => {
    const game = mkGame();
    const id = mkEntityId(5915);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new VisitKeywordHandler().activate(
      { keyword: "visit" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("visit")).toBe(true);
    expect(card.visit).toBe(true);
  });
});

describe("Wave 59 — Web-slinging / Firebending", () => {
  it("Web-slinging activate stamps keyword + cost", () => {
    const game = mkGame();
    const id = mkEntityId(5916);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new WebSlingingKeywordHandler().activate(
      { keyword: "web_slinging", params: { cost: { kind: "literal", raw: "U" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("web_slinging")).toBe(true);
    expect(card.webSlingingCost).toBe("U");
  });
  it("Firebending activate stamps keyword + cost", () => {
    const game = mkGame();
    const id = mkEntityId(5917);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new FirebendingKeywordHandler().activate(
      { keyword: "firebending", params: { detail: { kind: "literal", raw: "R" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("firebending")).toBe(true);
    expect(card.firebendingCost).toBe("R");
  });
});

describe("Wave 59 — Enlist", () => {
  it("activate stamps keyword + 1 attacks-trigger", () => {
    const game = mkGame();
    const id = mkEntityId(5918);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new EnlistKeywordHandler().activate(
      { keyword: "enlist" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("enlist")).toBe(true);
    expect(card.enlist).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 59 — Ravenous", () => {
  it("activate stamps keyword + ravenous flag", () => {
    const game = mkGame();
    const id = mkEntityId(5919);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new RavenousKeywordHandler().activate(
      { keyword: "ravenous" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("ravenous")).toBe(true);
    expect(card.ravenous).toBe(true);
  });
});

describe("Wave 59 — Card slot defaults", () => {
  it("All Wave-59 slots default to undefined", () => {
    const game = mkGame();
    const id = mkEntityId(5920);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    expect(card.affinityFilter).toBeUndefined();
    expect(card.unearthCost).toBeUndefined();
    expect(card.unearthCast).toBeUndefined();
    expect(card.readAhead).toBeUndefined();
    expect(card.moreThanMeetsTheEyeCost).toBeUndefined();
    expect(card.forMirrodin).toBeUndefined();
    expect(card.jobSelectChoices).toBeUndefined();
    expect(card.spectacleCost).toBeUndefined();
    expect(card.freerunningCost).toBeUndefined();
    expect(card.frenzyAmount).toBeUndefined();
    expect(card.auraSwap).toBeUndefined();
    expect(card.ascend).toBeUndefined();
    expect(card.decayed).toBeUndefined();
    expect(card.compleated).toBeUndefined();
    expect(card.compleatedPaidLife).toBeUndefined();
    expect(card.doubleTeam).toBeUndefined();
    expect(card.doubleTeamCopyRequested).toBeUndefined();
    expect(card.visit).toBeUndefined();
    expect(card.webSlingingCost).toBeUndefined();
    expect(card.firebendingCost).toBeUndefined();
    expect(card.enlist).toBeUndefined();
    expect(card.ravenous).toBeUndefined();
  });
});
