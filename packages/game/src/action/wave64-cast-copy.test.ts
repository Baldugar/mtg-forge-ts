// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 64 — game.action.castCopyOf tests + Cipher / Demonstrate / Replicate /
// Casualty integrations.
//
// CR 707.10 — copies on the stack: the helper must produce a kind:"copy"
// item, isCast:false, with a fresh id; controller is caller-chosen; targets
// are inherited or replaced based on the newTargets / retainTargets flags.
//
// Mechanic integrations exercised here:
//   1. Basic copy of a live spell on the stack.
//   2. newTargets: copy yields a chooseCastTargets decision.
//   3. retainTargets: copy keeps source targets verbatim.
//   4. freecast: no decision (cost) is yielded for the copy.
//   5. Synthesize path: card not on stack — uses spellAbilities[0].
//   6. Multiple copies stack up.
//   7. Cipher: combat-damage trigger pushes a copy.
//   8. Demonstrate: confirmAction yes → controller copy + opponent copy.
//   9. Demonstrate: confirmAction no → no copies.
//  10. Replicate: per-pay-count copies stack up.
import type {
  AbilityAst,
  EntityId,
  KeywordAst,
  LobbyPlayer,
  PaperCard,
  ParamValue,
  PlayerSeat,
} from "@mtg-forge-ts/core";
import {
  type CardType,
  DEFAULT_PAPER_CARD_FLAGS,
  ManaProduced,
  SeededRng,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { SpellAbility } from "../ability/spell-ability.js";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { CasualtyKeywordHandler } from "../keyword/handlers/casualty-keyword.js";
import { CipherKeywordHandler } from "../keyword/handlers/cipher-keyword.js";
import { DemonstrateKeywordHandler } from "../keyword/handlers/demonstrate-keyword.js";
import { ReplicateKeywordHandler } from "../keyword/handlers/replicate-keyword.js";
import { ManaPool } from "../mana/mana-pool.js";
import type { StackItem } from "../stack/stack-item.js";
import { Battlefield } from "../zone/zones/battlefield.js";
import { Graveyard } from "../zone/zones/graveyard.js";
import { Hand } from "../zone/zones/hand.js";
import { Library } from "../zone/zones/library.js";

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
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "01",
};

const paper: PaperCard = {
  name: "TestSpell",
  edition: "LEA",
  collectorNumber: "001",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

interface Fixture {
  game: Game;
  seat0: PlayerSeat;
  seat1: PlayerSeat;
}

const makeGame = (): Fixture => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
  }
  return { game, seat0: mkPlayerSeat(0), seat1: mkPlayerSeat(1) };
};

const addCardToZone = (
  game: Game,
  seat: PlayerSeat,
  zone: ZoneType,
  id: EntityId,
  customPaper: PaperCard = paper,
): Card => {
  const card = new Card(id, customPaper, seat, seat, zone);
  game.cards.set(id, card);
  if (zone === ZoneType.Exile) {
    game.sharedZones.exile.add(id);
  } else {
    const z = game.getPlayer(seat).zones.get(zone);
    if (!z) throw new Error("test: missing zone");
    z.add(id);
  }
  return card;
};

// Helper — push a fake spell-kind StackItem so castCopyOf can locate it via
// the live-item path. Uses kind: "spell" with isCast: true to mirror what
// the real cast pipeline produces.
const pushFakeSpellOnStack = (
  game: Game,
  cardId: EntityId,
  controllerSeat: PlayerSeat,
  targets: unknown = null,
): StackItem => {
  const id = game.newEntityId();
  const item: StackItem = {
    id,
    sourceCardId: cardId,
    controllerSeat,
    kind: "spell",
    isCast: true,
    targets,
    modes: [],
    xValue: null,
    costPaid: [],
    provenance: {
      originZone: ZoneType.Hand,
      altCostUsed: null,
      additionalCostsPaid: [],
    },
  };
  game.sharedZones.stack.push(item);
  return item;
};

const drainGenerator = <Y, R>(gen: Generator<Y, R, unknown>): { yields: Y[]; result: R } => {
  const yields: Y[] = [];
  let step = gen.next();
  while (!step.done) {
    yields.push(step.value);
    step = gen.next();
  }
  return { yields, result: step.value };
};

const drainWithResponses = <Y extends { kind: string }, R>(
  gen: Generator<Y, R, unknown>,
  responses: readonly unknown[],
): { yields: Y[]; result: R } => {
  const yields: Y[] = [];
  let step = gen.next();
  let respIdx = 0;
  while (!step.done) {
    yields.push(step.value);
    if (step.value.kind === "decision" && respIdx < responses.length) {
      step = gen.next(responses[respIdx]);
      respIdx += 1;
    } else {
      step = gen.next();
    }
  }
  return { yields, result: step.value };
};

const makeNoopAst = (): AbilityAst => ({
  kind: "spell",
  effect: { handlerKey: "TestNoopWave64", params: {} },
  cost: { raw: "0" },
});

describe("game.action.castCopyOf — Wave 64", () => {
  it("basic copy: live spell on stack → kind:'copy', isCast:false, fresh id", () => {
    const { game, seat0 } = makeGame();
    const cardId = mkEntityId(100);
    addCardToZone(game, seat0, ZoneType.Hand, cardId);
    const live = pushFakeSpellOnStack(game, cardId, seat0);

    const { result: copyId } = drainGenerator(
      game.action.castCopyOf(cardId, { controllerSeat: seat0, freecast: true }),
    );
    expect(typeof copyId).toBe("number");
    expect(copyId).not.toBe(live.id);

    expect(game.sharedZones.stack.size).toBe(2);
    const top = game.sharedZones.stack.top();
    expect(top?.kind).toBe("copy");
    expect(top?.isCast).toBe(false);
    expect(top?.id).toBe(copyId);
    expect(top?.controllerSeat).toBe(seat0);
  });

  it("retainTargets: copy preserves source targets", () => {
    const { game, seat0 } = makeGame();
    const cardId = mkEntityId(110);
    const targetId = mkEntityId(111);
    addCardToZone(game, seat0, ZoneType.Hand, cardId);
    addCardToZone(game, seat0, ZoneType.Battlefield, targetId);
    const sourceTargets = [{ kind: "card", id: targetId }];
    pushFakeSpellOnStack(game, cardId, seat0, sourceTargets);

    drainGenerator(
      game.action.castCopyOf(cardId, {
        controllerSeat: seat0,
        retainTargets: true,
        freecast: true,
      }),
    );
    const top = game.sharedZones.stack.top();
    expect(top?.kind).toBe("copy");
    expect(top?.targets).toBe(sourceTargets);
  });

  it("newTargets: yields chooseCastTargets and applies the new target", () => {
    const { game, seat0 } = makeGame();
    const restriction = {
      controllerScope: "any" as const,
      permitZones: new Set([ZoneType.Battlefield]),
      permitTypes: new Set<CardType>(),
      forbidTypes: new Set<CardType>(),
      minTargets: 1,
      maxTargets: 1,
      mayTargetPlayers: false,
    };
    const customPaper: PaperCard & { targetRestriction: typeof restriction } = {
      ...paper,
      targetRestriction: restriction,
    };
    const cardId = mkEntityId(120);
    const oldTgt = mkEntityId(121);
    const newTgt = mkEntityId(122);
    addCardToZone(game, seat0, ZoneType.Hand, cardId, customPaper);
    addCardToZone(game, seat0, ZoneType.Battlefield, oldTgt);
    addCardToZone(game, seat0, ZoneType.Battlefield, newTgt);
    pushFakeSpellOnStack(game, cardId, seat0, [{ kind: "card", id: oldTgt }]);

    const newTargets = [{ kind: "card" as const, id: newTgt }];
    const { yields } = drainWithResponses(
      game.action.castCopyOf(cardId, {
        controllerSeat: seat0,
        newTargets: true,
        freecast: true,
      }),
      [{ kind: "chooseCastTargets", targets: newTargets }],
    );
    const decision = yields.find((y) => (y as { kind: string }).kind === "decision") as
      | { kind: "decision"; request: { kind: string } }
      | undefined;
    expect(decision?.request.kind).toBe("chooseCastTargets");

    const top = game.sharedZones.stack.top();
    expect(top?.kind).toBe("copy");
    expect(top?.targets).toEqual(newTargets);
  });

  it("freecast: no decision (no cost prompt) is yielded for the copy", () => {
    const { game, seat0 } = makeGame();
    const cardId = mkEntityId(130);
    addCardToZone(game, seat0, ZoneType.Hand, cardId);
    pushFakeSpellOnStack(game, cardId, seat0);

    const { yields } = drainGenerator(
      game.action.castCopyOf(cardId, { controllerSeat: seat0, freecast: true }),
    );
    const decisionYields = yields.filter((y) => (y as { kind: string }).kind === "decision");
    expect(decisionYields).toHaveLength(0);
  });

  it("synthesize path: card not on stack — uses spellAbilities[0] to build a fresh copy", () => {
    const { game, seat0 } = makeGame();
    const cardId = mkEntityId(140);
    const card = addCardToZone(game, seat0, ZoneType.Exile, cardId);
    card.spellAbilities = [new SpellAbility(makeNoopAst(), cardId, seat0, new Map())];

    const { result: copyId } = drainGenerator(
      game.action.castCopyOf(cardId, { controllerSeat: seat0, freecast: true }),
    );
    expect(typeof copyId).toBe("number");
    expect(game.sharedZones.stack.size).toBe(1);
    const top = game.sharedZones.stack.top();
    expect(top?.kind).toBe("copy");
    expect(top?.isCast).toBe(false);
    expect(top?.sourceCardId).toBe(cardId);
    expect(top?.controllerSeat).toBe(seat0);
    expect(top?.provenance.originZone).toBe(ZoneType.Exile);
  });

  it("multiple copies stack up: 3 successive castCopyOf calls produce 3 distinct copy items", () => {
    const { game, seat0 } = makeGame();
    const cardId = mkEntityId(150);
    addCardToZone(game, seat0, ZoneType.Hand, cardId);
    pushFakeSpellOnStack(game, cardId, seat0);

    const ids: EntityId[] = [];
    for (let i = 0; i < 3; i++) {
      const { result } = drainGenerator(
        game.action.castCopyOf(cardId, {
          controllerSeat: seat0,
          retainTargets: true,
          freecast: true,
        }),
      );
      // Wave 70.M — castCopyOf return widened to EntityId | undefined
      // (silent CantBeCopied gate). The test path doesn't trigger that
      // gate, so we assert defined and unwrap.
      if (result === undefined) throw new Error("expected castCopyOf to produce a copy id");
      ids.push(result);
    }
    expect(new Set(ids).size).toBe(3);
    expect(game.sharedZones.stack.size).toBe(4); // 1 original + 3 copies
  });

  it("controllerSeat option assigns the new copy's controller to a different seat", () => {
    const { game, seat0, seat1 } = makeGame();
    const cardId = mkEntityId(160);
    addCardToZone(game, seat0, ZoneType.Hand, cardId);
    pushFakeSpellOnStack(game, cardId, seat0);

    drainGenerator(game.action.castCopyOf(cardId, { controllerSeat: seat1, freecast: true }));
    const top = game.sharedZones.stack.top();
    expect(top?.controllerSeat).toBe(seat1);
  });
});

describe("Cipher integration — castCopyOf via combat-damage trigger", () => {
  it("damage trigger fires castCopyOf and pushes a copy on the stack", () => {
    const { game, seat0 } = makeGame();
    const cipherCardId = mkEntityId(200);
    const encodedCreatureId = mkEntityId(201);
    const cipherCard = addCardToZone(game, seat0, ZoneType.Exile, cipherCardId);
    addCardToZone(game, seat0, ZoneType.Battlefield, encodedCreatureId);

    cipherCard.spellAbilities = [new SpellAbility(makeNoopAst(), cipherCardId, seat0, new Map())];
    cipherCard.cipherEncodedOnId = encodedCreatureId;

    const handler = new CipherKeywordHandler();
    const ast: KeywordAst = { keyword: "cipher", params: {} };
    handler.activate(ast, { game, sourceCardId: cipherCardId, controllerSeat: seat0 });

    const trig = cipherCard.triggeredAbilities?.find((t) => t.activeInZones.has(ZoneType.Graveyard));
    expect(trig).toBeDefined();
    if (!trig) throw new Error("no damage trigger");
    const resolver = (
      trig as unknown as {
        resolver: { resolve: (g: unknown) => Generator<unknown> };
      }
    ).resolver;
    const gen = resolver.resolve(game);
    let step = gen.next();
    expect((step.value as { kind: string }).kind).toBe("decision");
    step = gen.next({ kind: "confirmAction", confirmed: true });
    while (!step.done) step = gen.next();

    expect(game.sharedZones.stack.size).toBe(1);
    const top = game.sharedZones.stack.top();
    expect(top?.kind).toBe("copy");
    expect(top?.sourceCardId).toBe(cipherCardId);
  });
});

describe("Demonstrate integration — controller copy + opponent copy", () => {
  it("confirmAction yes → both copies pushed (opponent auto-picked when only 1)", () => {
    const { game, seat0, seat1 } = makeGame();
    const cardId = mkEntityId(300);
    addCardToZone(game, seat0, ZoneType.Hand, cardId);
    pushFakeSpellOnStack(game, cardId, seat0);

    const handler = new DemonstrateKeywordHandler();
    handler.activate(
      { keyword: "demonstrate", params: {} },
      { game, sourceCardId: cardId, controllerSeat: seat0 },
    );
    const trig = game.cards.get(cardId)?.triggeredAbilities?.[0];
    expect(trig).toBeDefined();
    if (!trig) return;
    const resolver = (
      trig as unknown as {
        resolver: { resolve: (g: unknown) => Generator<unknown> };
      }
    ).resolver;
    const gen = resolver.resolve(game);
    let step = gen.next();
    expect((step.value as { kind: string }).kind).toBe("decision");
    step = gen.next({ kind: "confirmAction", confirmed: true });
    while (!step.done) step = gen.next();

    expect(game.sharedZones.stack.size).toBe(3);
    const items = game.sharedZones.stack.toArray();
    const copies = items.filter((it) => it.kind === "copy");
    expect(copies).toHaveLength(2);
    const controllers = copies.map((c) => c.controllerSeat);
    expect(controllers).toContain(seat0);
    expect(controllers).toContain(seat1);
  });

  it("confirmAction no → no copies pushed", () => {
    const { game, seat0 } = makeGame();
    const cardId = mkEntityId(310);
    addCardToZone(game, seat0, ZoneType.Hand, cardId);
    pushFakeSpellOnStack(game, cardId, seat0);
    const handler = new DemonstrateKeywordHandler();
    handler.activate(
      { keyword: "demonstrate", params: {} },
      { game, sourceCardId: cardId, controllerSeat: seat0 },
    );
    const trig = game.cards.get(cardId)?.triggeredAbilities?.[0];
    if (!trig) throw new Error("no trigger");
    const resolver = (
      trig as unknown as {
        resolver: { resolve: (g: unknown) => Generator<unknown> };
      }
    ).resolver;
    const gen = resolver.resolve(game);
    let step = gen.next();
    step = gen.next({ kind: "confirmAction", confirmed: false });
    while (!step.done) step = gen.next();
    expect(game.sharedZones.stack.size).toBe(1);
  });
});

describe("Replicate integration — per-pay-count copies stack up", () => {
  it("3 confirms → 3 copies on the stack alongside original", () => {
    const { game, seat0 } = makeGame();
    const cardId = mkEntityId(400);
    addCardToZone(game, seat0, ZoneType.Hand, cardId);
    pushFakeSpellOnStack(game, cardId, seat0);

    // Wave 91 — replicate now charges its cost via parseCostString/payCost
    // on each confirmed iteration. Seed the mana pool with 3 generic mana
    // so the three confirms can pay {1} each.
    const pool = new ManaPool();
    pool.add(ManaProduced.colorless({ sourceId: mkEntityId(901) }));
    pool.add(ManaProduced.colorless({ sourceId: mkEntityId(902) }));
    pool.add(ManaProduced.colorless({ sourceId: mkEntityId(903) }));
    game.getPlayer(seat0).manaPool = pool;

    const handler = new ReplicateKeywordHandler();
    const ast: KeywordAst = {
      keyword: "replicate",
      params: { cost: { kind: "literal", raw: "1" } as ParamValue },
    };
    handler.activate(ast, { game, sourceCardId: cardId, controllerSeat: seat0 });
    const trig = game.cards.get(cardId)?.triggeredAbilities?.[0];
    if (!trig) throw new Error("no trigger");
    const resolver = (
      trig as unknown as {
        resolver: { resolve: (g: unknown) => Generator<unknown> };
      }
    ).resolver;
    const gen = resolver.resolve(game);
    let step = gen.next();
    let confirms = 0;
    while (!step.done) {
      const v = step.value as { kind?: string };
      if (v?.kind === "decision") {
        if (confirms < 3) {
          step = gen.next({ kind: "confirmAction", confirmed: true });
          confirms++;
        } else {
          step = gen.next({ kind: "confirmAction", confirmed: false });
        }
      } else {
        step = gen.next();
      }
    }

    expect(game.sharedZones.stack.size).toBe(4);
    const items = game.sharedZones.stack.toArray();
    expect(items.filter((it) => it.kind === "copy")).toHaveLength(3);
  });
});

describe("Casualty integration — handler registers a SpellCast trigger", () => {
  it("activate stamps the SpellCast trigger; controller can decline", () => {
    const { game, seat0 } = makeGame();
    const cardId = mkEntityId(500);
    addCardToZone(game, seat0, ZoneType.Hand, cardId);
    pushFakeSpellOnStack(game, cardId, seat0);

    const handler = new CasualtyKeywordHandler();
    handler.activate(
      {
        keyword: "casualty",
        params: { amount: { kind: "literal", raw: "2" } as ParamValue },
      },
      { game, sourceCardId: cardId, controllerSeat: seat0 },
    );
    const card = game.cards.get(cardId);
    expect(card?.casualtyAmount).toBe(2);
    const trig = card?.triggeredAbilities?.[0];
    expect(trig).toBeDefined();
    if (!trig) return;

    // No eligible creatures (no battlefield creatures with power ≥ 2). The
    // resolver should short-circuit to break without prompting.
    const resolver = (
      trig as unknown as {
        resolver: { resolve: (g: unknown) => Generator<unknown> };
      }
    ).resolver;
    const gen = resolver.resolve(game);
    let step = gen.next();
    while (!step.done) step = gen.next();

    // No copies pushed — only the original spell on the stack.
    expect(game.sharedZones.stack.size).toBe(1);
  });

  it("controller declines confirmAction → no copies pushed even when eligible creatures exist", () => {
    const { game, seat0 } = makeGame();
    const cardId = mkEntityId(510);
    addCardToZone(game, seat0, ZoneType.Hand, cardId);
    pushFakeSpellOnStack(game, cardId, seat0);

    // Add an eligible creature: livingMetal+setPower trick to make
    // chars.types.has(Creature) true and chars.power return ≥ 2 without
    // a full CardDefinition.
    const creatureId = mkEntityId(511);
    const creature = addCardToZone(game, seat0, ZoneType.Battlefield, creatureId);
    creature.livingMetal = true;
    // Force activePlayer to seat0 so livingMetal turns it into a creature.
    // The Game ctor sets activePlayer to the first seat by default.
    creature.tokenOverrides = { setPower: 3, setToughness: 3 };
    // Bump the layer epoch so the cache invalidates.
    game.layerEngine.bumpEpoch("test-setup");

    const handler = new CasualtyKeywordHandler();
    handler.activate(
      {
        keyword: "casualty",
        params: { amount: { kind: "literal", raw: "2" } as ParamValue },
      },
      { game, sourceCardId: cardId, controllerSeat: seat0 },
    );
    const trig = game.cards.get(cardId)?.triggeredAbilities?.[0];
    if (!trig) throw new Error("no trigger");
    const resolver = (
      trig as unknown as {
        resolver: { resolve: (g: unknown) => Generator<unknown> };
      }
    ).resolver;
    const gen = resolver.resolve(game);
    let step = gen.next();
    // First decision should be confirmAction. Decline.
    expect((step.value as { kind: string }).kind).toBe("decision");
    step = gen.next({ kind: "confirmAction", confirmed: false });
    while (!step.done) step = gen.next();

    expect(game.sharedZones.stack.size).toBe(1);
  });
});
