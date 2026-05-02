// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 58 — smoke tests for the niche-keyword cleanup batch 2:
// Casualty, Squad, Escalate, Prototype, Spree, Offspring, Backup,
// Tribute, Amplify, Mobilize, Demonstrate, Encore, Reconfigure, Sneak,
// Transfigure, Living metal, Dethrone (keyword handlers) + Warp, Blitz,
// Surge, Emerge, Miracle (alt-costs). Plus regression tests for the
// mentor / provoke payload-field bug fix verifying the matchers now
// correctly read the canonical `attackers: [{attackerId, defender}]`
// AttackersDeclared payload shape.
import "../../ability/effects/index.js";
import "../../altcost/index.js";
import "./index.js";
import type { GameEvent, LobbyPlayer, PaperCard, PlayerSeat } from "@mtg-forge-ts/core";
import {
  DEFAULT_PAPER_CARD_FLAGS,
  PhaseStep,
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
import { altCostRegistry } from "../../registries/alt-cost-registry.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Hand } from "../../zone/zones/hand.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import { AmplifyKeywordHandler } from "./amplify-keyword.js";
import { BackupKeywordHandler } from "./backup-keyword.js";
import { CasualtyKeywordHandler } from "./casualty-keyword.js";
import { DemonstrateKeywordHandler } from "./demonstrate-keyword.js";
import { DethroneKeywordHandler } from "./dethrone-keyword.js";
import { EncoreKeywordHandler } from "./encore-keyword.js";
import { EscalateKeywordHandler } from "./escalate-keyword.js";
import { LivingMetalKeywordHandler } from "./living-metal-keyword.js";
import { MentorKeywordHandler } from "./mentor-keyword.js";
import { MobilizeKeywordHandler } from "./mobilize-keyword.js";
import { OffspringKeywordHandler } from "./offspring-keyword.js";
import { PrototypeKeywordHandler } from "./prototype-keyword.js";
import { ProvokeKeywordHandler } from "./provoke-keyword.js";
import { ReconfigureKeywordHandler } from "./reconfigure-keyword.js";
import { SneakKeywordHandler } from "./sneak-keyword.js";
import { SpreeKeywordHandler } from "./spree-keyword.js";
import { SquadKeywordHandler } from "./squad-keyword.js";
import { TransfigureKeywordHandler } from "./transfigure-keyword.js";
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

const ALICE: PlayerSeat = mkPlayerSeat(0);
const BOB: PlayerSeat = mkPlayerSeat(1);

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [aliceLP, bobLP], rules, meta, rng: new SeededRng(1n) });
  for (const p of game.players) {
    p.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, p.seat));
    p.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, p.seat));
  }
  return game;
};

describe("Wave 58 keyword handlers — registration", () => {
  it("CasualtyKeywordHandler is registered under 'casualty'", () => {
    expect(keywordHandlerRegistry.lookup("casualty")).toBe(CasualtyKeywordHandler);
  });
  it("SquadKeywordHandler is registered under 'squad'", () => {
    expect(keywordHandlerRegistry.lookup("squad")).toBe(SquadKeywordHandler);
  });
  it("EscalateKeywordHandler is registered under 'escalate'", () => {
    expect(keywordHandlerRegistry.lookup("escalate")).toBe(EscalateKeywordHandler);
  });
  it("PrototypeKeywordHandler is registered under 'prototype'", () => {
    expect(keywordHandlerRegistry.lookup("prototype")).toBe(PrototypeKeywordHandler);
  });
  it("SpreeKeywordHandler is registered under 'spree'", () => {
    expect(keywordHandlerRegistry.lookup("spree")).toBe(SpreeKeywordHandler);
  });
  it("OffspringKeywordHandler is registered under 'offspring'", () => {
    expect(keywordHandlerRegistry.lookup("offspring")).toBe(OffspringKeywordHandler);
  });
  it("BackupKeywordHandler is registered under 'backup'", () => {
    expect(keywordHandlerRegistry.lookup("backup")).toBe(BackupKeywordHandler);
  });
  it("TributeKeywordHandler is registered under 'tribute'", () => {
    expect(keywordHandlerRegistry.lookup("tribute")).toBe(TributeKeywordHandler);
  });
  it("AmplifyKeywordHandler is registered under 'amplify'", () => {
    expect(keywordHandlerRegistry.lookup("amplify")).toBe(AmplifyKeywordHandler);
  });
  it("MobilizeKeywordHandler is registered under 'mobilize'", () => {
    expect(keywordHandlerRegistry.lookup("mobilize")).toBe(MobilizeKeywordHandler);
  });
  it("DemonstrateKeywordHandler is registered under 'demonstrate'", () => {
    expect(keywordHandlerRegistry.lookup("demonstrate")).toBe(DemonstrateKeywordHandler);
  });
  it("EncoreKeywordHandler is registered under 'encore'", () => {
    expect(keywordHandlerRegistry.lookup("encore")).toBe(EncoreKeywordHandler);
  });
  it("ReconfigureKeywordHandler is registered under 'reconfigure'", () => {
    expect(keywordHandlerRegistry.lookup("reconfigure")).toBe(ReconfigureKeywordHandler);
  });
  it("SneakKeywordHandler is registered under 'sneak'", () => {
    expect(keywordHandlerRegistry.lookup("sneak")).toBe(SneakKeywordHandler);
  });
  it("TransfigureKeywordHandler is registered under 'transfigure'", () => {
    expect(keywordHandlerRegistry.lookup("transfigure")).toBe(TransfigureKeywordHandler);
  });
  it("LivingMetalKeywordHandler is registered under 'living_metal'", () => {
    expect(keywordHandlerRegistry.lookup("living_metal")).toBe(LivingMetalKeywordHandler);
  });
  it("DethroneKeywordHandler is registered under 'dethrone'", () => {
    expect(keywordHandlerRegistry.lookup("dethrone")).toBe(DethroneKeywordHandler);
  });
});

describe("Wave 58 alt-costs — registration", () => {
  it("Warp AltCost is registered", () => {
    expect(altCostRegistry.has("Warp")).toBe(true);
  });
  it("Blitz AltCost is registered", () => {
    expect(altCostRegistry.has("Blitz")).toBe(true);
  });
  it("Surge AltCost is registered", () => {
    expect(altCostRegistry.has("Surge")).toBe(true);
  });
  it("Emerge AltCost is registered", () => {
    expect(altCostRegistry.has("Emerge")).toBe(true);
  });
  it("Miracle AltCost is registered", () => {
    expect(altCostRegistry.has("Miracle")).toBe(true);
  });
});

describe("Wave 58 — Casualty", () => {
  it("activate stamps keyword + casualtyAmount", () => {
    const game = mkGame();
    const id = mkEntityId(5801);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new CasualtyKeywordHandler().activate(
      { keyword: "casualty", params: { amount: { kind: "literal", raw: "2" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("casualty")).toBe(true);
    expect(card.casualtyAmount).toBe(2);
  });
});

describe("Wave 58 — Squad", () => {
  it("activate stamps keyword + squadCost", () => {
    const game = mkGame();
    const id = mkEntityId(5802);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new SquadKeywordHandler().activate(
      { keyword: "squad", params: { cost: { kind: "literal", raw: "2 R" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("squad")).toBe(true);
    expect(card.squadCost).toBe("2 R");
  });
});

describe("Wave 58 — Escalate", () => {
  it("activate stamps keyword + escalateCost", () => {
    const game = mkGame();
    const id = mkEntityId(5803);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new EscalateKeywordHandler().activate(
      { keyword: "escalate", params: { detail: { kind: "literal", raw: "1" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("escalate")).toBe(true);
    expect(card.escalateCost).toBe("1");
  });
});

describe("Wave 58 — Prototype", () => {
  it("activate splits cost and P/T", () => {
    const game = mkGame();
    const id = mkEntityId(5804);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new PrototypeKeywordHandler().activate(
      { keyword: "prototype", params: { cost: { kind: "literal", raw: "2 R 2/3" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("prototype")).toBe(true);
    expect(card.prototypeCost).toBe("2 R");
    expect(card.prototypePT).toBe("2/3");
  });
});

describe("Wave 58 — Spree", () => {
  it("activate stamps keyword + isSpree", () => {
    const game = mkGame();
    const id = mkEntityId(5805);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new SpreeKeywordHandler().activate(
      { keyword: "spree" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("spree")).toBe(true);
    expect(card.isSpree).toBe(true);
  });
});

describe("Wave 58 — Offspring", () => {
  it("activate stamps keyword + offspringCost", () => {
    const game = mkGame();
    const id = mkEntityId(5806);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Hand);
    game.cards.set(id, card);
    new OffspringKeywordHandler().activate(
      { keyword: "offspring", params: { detail: { kind: "literal", raw: "1" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("offspring")).toBe(true);
    expect(card.offspringCost).toBe("1");
  });
});

describe("Wave 58 — Backup", () => {
  it("activate stamps keyword + 1 ETB trigger + backupAmount", () => {
    const game = mkGame();
    const id = mkEntityId(5807);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new BackupKeywordHandler().activate(
      { keyword: "backup", params: { amount: { kind: "literal", raw: "1" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("backup")).toBe(true);
    expect(card.backupAmount).toBe(1);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 58 — Tribute", () => {
  it("activate stamps keyword + tributeAmount (M6.26 — static replacement)", () => {
    const game = mkGame();
    const id = mkEntityId(5808);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new TributeKeywordHandler().activate(
      { keyword: "tribute", params: { amount: { kind: "literal", raw: "2" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("tribute")).toBe(true);
    expect(card.tributeAmount).toBe(2);
    // M6.26: Tribute no longer registers a triggered ability. The
    // interactive opt-in + counter-place runs through `applyEtbStamping`
    // → `applyTributeReplacement` (CR 614 replacement).
    expect(card.triggeredAbilities?.length ?? 0).toBe(0);
  });
});

describe("Wave 58 — Amplify", () => {
  it("activate stamps keyword + 1 ETB trigger + amplifyAmount", () => {
    const game = mkGame();
    const id = mkEntityId(5809);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new AmplifyKeywordHandler().activate(
      { keyword: "amplify", params: { detail: { kind: "literal", raw: "1" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("amplify")).toBe(true);
    expect(card.amplifyAmount).toBe(1);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 58 — Mobilize", () => {
  it("activate stamps keyword + 1 attacks-trigger + mobilizeAmount", () => {
    const game = mkGame();
    const id = mkEntityId(5810);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new MobilizeKeywordHandler().activate(
      { keyword: "mobilize", params: { amount: { kind: "literal", raw: "2" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("mobilize")).toBe(true);
    expect(card.mobilizeAmount).toBe(2);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 58 — Demonstrate", () => {
  it("activate stamps keyword + 1 spellcast-trigger", () => {
    const game = mkGame();
    const id = mkEntityId(5811);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Stack);
    game.cards.set(id, card);
    new DemonstrateKeywordHandler().activate(
      { keyword: "demonstrate" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("demonstrate")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 58 — Encore", () => {
  it("activate stamps keyword + adds 1 SpellAbility", () => {
    const game = mkGame();
    const id = mkEntityId(5812);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Graveyard);
    game.cards.set(id, card);
    const before = card.spellAbilities.length;
    new EncoreKeywordHandler().activate(
      { keyword: "encore", params: { detail: { kind: "literal", raw: "3" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("encore")).toBe(true);
    expect(card.spellAbilities.length).toBe(before + 1);
  });
});

describe("Wave 58 — Reconfigure", () => {
  it("activate stamps keyword + reconfigureCost + adds 1 SpellAbility", () => {
    const game = mkGame();
    const id = mkEntityId(5813);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    const before = card.spellAbilities.length;
    new ReconfigureKeywordHandler().activate(
      { keyword: "reconfigure", params: { cost: { kind: "literal", raw: "2" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("reconfigure")).toBe(true);
    expect(card.reconfigureCost).toBe("2");
    expect(card.spellAbilities.length).toBe(before + 1);
  });
});

describe("Wave 58 — Sneak", () => {
  it("activate stamps keyword + sneakCost", () => {
    const game = mkGame();
    const id = mkEntityId(5814);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new SneakKeywordHandler().activate(
      { keyword: "sneak", params: { cost: { kind: "literal", raw: "3 R" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("sneak")).toBe(true);
    expect(card.sneakCost).toBe("3 R");
  });
});

describe("Wave 58 — Transfigure", () => {
  it("activate stamps keyword + adds 1 SpellAbility", () => {
    const game = mkGame();
    const id = mkEntityId(5815);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    const before = card.spellAbilities.length;
    new TransfigureKeywordHandler().activate(
      { keyword: "transfigure", params: { cost: { kind: "literal", raw: "1 B" } } },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("transfigure")).toBe(true);
    expect(card.spellAbilities.length).toBe(before + 1);
  });
});

describe("Wave 58 — Living metal", () => {
  it("activate stamps keyword + livingMetal flag", () => {
    const game = mkGame();
    const id = mkEntityId(5816);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new LivingMetalKeywordHandler().activate(
      { keyword: "living_metal" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("living_metal")).toBe(true);
    expect(card.livingMetal).toBe(true);
  });
});

describe("Wave 58 — Dethrone", () => {
  it("activate stamps keyword + 1 attacks-trigger", () => {
    const game = mkGame();
    const id = mkEntityId(5817);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    new DethroneKeywordHandler().activate(
      { keyword: "dethrone" },
      { game, sourceCardId: id, controllerSeat: ALICE },
    );
    expect(card.keywords?.has("dethrone")).toBe(true);
    expect(card.triggeredAbilities?.length).toBe(1);
  });
});

describe("Wave 58 — Card slot defaults", () => {
  it("All Wave-58 slots default to undefined", () => {
    const game = mkGame();
    const id = mkEntityId(5818);
    const card = new Card(id, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(id, card);
    expect(card.casualtyAmount).toBeUndefined();
    expect(card.squadCost).toBeUndefined();
    expect(card.escalateCost).toBeUndefined();
    expect(card.prototypeCost).toBeUndefined();
    expect(card.prototypePT).toBeUndefined();
    expect(card.isSpree).toBeUndefined();
    expect(card.offspringCost).toBeUndefined();
    expect(card.backupAmount).toBeUndefined();
    expect(card.tributeAmount).toBeUndefined();
    expect(card.amplifyAmount).toBeUndefined();
    expect(card.mobilizeAmount).toBeUndefined();
    expect(card.reconfigureCost).toBeUndefined();
    expect(card.sneakCost).toBeUndefined();
    expect(card.livingMetal).toBeUndefined();
    expect(card.warpCast).toBeUndefined();
    expect(card.blitzCast).toBeUndefined();
    expect(card.emergeCast).toBeUndefined();
    expect(card.miracleCast).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// Mentor / Provoke payload-field bug fix (regression).
//
// Before Wave 58, both handlers' matchers read `p.attackerIds?.includes(
// sourceCardId)`. The canonical AttackersDeclared event payload uses
// `attackers: readonly { attackerId, defender }[]`, so the matchers
// silently never fired. The fix uses `p.attackers?.some((a) =>
// a.attackerId === sourceCardId)` against the canonical shape.
// ---------------------------------------------------------------------

const mkAttackersDeclared = (
  attackingSeat: PlayerSeat,
  attackerId: number,
  defendingSeat: PlayerSeat,
  turn = 1,
): GameEvent => ({
  kind: "AttackersDeclared",
  version: 1,
  turn,
  phase: PhaseStep.DeclareAttackers,
  payload: {
    attackingSeat,
    attackers: [
      {
        attackerId: mkEntityId(attackerId),
        defender: { kind: "player", seat: defendingSeat },
      },
    ],
  },
});

describe("Wave 58 — Mentor / Provoke matcher bug fix (regression)", () => {
  it("Mentor matcher fires on canonical AttackersDeclared payload", () => {
    const game = mkGame();
    const sourceId = mkEntityId(5901);
    const card = new Card(sourceId, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(sourceId, card);
    new MentorKeywordHandler().activate(
      { keyword: "mentor" },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const trigger = card.triggeredAbilities[0];
    expect(trigger).toBeDefined();
    if (!trigger) return;
    const event = mkAttackersDeclared(ALICE, 5901, BOB);
    expect(trigger.matches(event)).toBe(true);
    // Different attacker → no match.
    const otherEvent = mkAttackersDeclared(ALICE, 9999, BOB);
    expect(trigger.matches(otherEvent)).toBe(false);
  });

  it("Provoke matcher fires on canonical AttackersDeclared payload", () => {
    const game = mkGame();
    const sourceId = mkEntityId(5902);
    const card = new Card(sourceId, paper, ALICE, ALICE, ZoneType.Battlefield);
    game.cards.set(sourceId, card);
    new ProvokeKeywordHandler().activate(
      { keyword: "provoke" },
      { game, sourceCardId: sourceId, controllerSeat: ALICE },
    );
    const trigger = card.triggeredAbilities[0];
    expect(trigger).toBeDefined();
    if (!trigger) return;
    const event = mkAttackersDeclared(ALICE, 5902, BOB);
    expect(trigger.matches(event)).toBe(true);
    const otherEvent = mkAttackersDeclared(ALICE, 9999, BOB);
    expect(trigger.matches(otherEvent)).toBe(false);
  });
});
