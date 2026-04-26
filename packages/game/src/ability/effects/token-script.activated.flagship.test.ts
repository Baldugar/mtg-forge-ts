// SPDX-License-Identifier: GPL-3.0-or-later
// Flagship test — Wave 17b. Spawn a Treasure token via the TokenScript$
// form and activate its `{T}, Sacrifice this token: Add one mana of any
// color` ability. Verifies the round-trip: token-database AbilityAst →
// Card.activateAbilitiesFromDefinition → activateAbility → Mana effect →
// pool delta + sacrifice.
//
// Sister coverage: smoke tests for Food / Clue / Blood / Powerstone
// activations. We don't run the full activation path on every variant
// (the cost-payment flow is shared), but we verify each token has the
// expected number of populated `spellAbilities`.
import "../../svar/selectors/number.js";
import "../../cost/parts/cost-mana.js";
import "../../cost/parts/cost-pay-life.js";
import "../../cost/parts/cost-sacrifice.js";
import "../../cost/parts/cost-tap.js";
import "../../cost/parts/cost-discard.js";
import "./mana.js";
import "./gain-life.js";
import "./draw.js";
import "./token.js";
import { tokenDatabase } from "@mtg-forge-ts/cards";
import type { EntityId, LobbyPlayer } from "@mtg-forge-ts/core";
import { type ManaProduced, SeededRng, ZoneType, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { activateAbility } from "../../ability/activate.js";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { ManaPool } from "../../mana/mana-pool.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
import { Graveyard } from "../../zone/zones/graveyard.js";
import { Hand } from "../../zone/zones/hand.js";
import { Library } from "../../zone/zones/library.js";

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

const mkGame = (): Game => {
  const game = new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });
  for (const player of game.players) {
    player.zones.set(ZoneType.Library, new Library(ZoneType.Library, player.seat));
    player.zones.set(ZoneType.Hand, new Hand(ZoneType.Hand, player.seat));
    player.zones.set(ZoneType.Graveyard, new Graveyard(ZoneType.Graveyard, player.seat));
    player.zones.set(ZoneType.Battlefield, new Battlefield(ZoneType.Battlefield, player.seat));
    player.manaPool = new ManaPool();
  }
  return game;
};

const drainGen = <T>(gen: Generator<unknown, T, unknown>): T => {
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value as T;
};

describe("TokenScript$ activated abilities (Wave 17b)", () => {
  it("Treasure: spellAbilities populated, {T} + Sac → mana pool gains one atom", () => {
    const game = mkGame();
    const seat0 = mkPlayerSeat(0);
    const treasureEntry = tokenDatabase.get("c_a_treasure_sac");
    expect(treasureEntry).toBeDefined();
    expect(treasureEntry?.abilities.length).toBe(1);

    // Spawn a treasure via createToken (mirrors what TokenEffect does for
    // the TokenScript$ form, but skips the surrounding effect to keep the
    // test focused on the activation round-trip).
    const ids = drainGen(
      game.action.createToken({
        paperCard: {
          name: "Treasure Token",
          edition: "TOK",
          collectorNumber: "0",
          language: "en",
          foil: false,
          flags: { isStarter: false, isReprint: false, isTimeshifted: false, isPromotional: false },
          definition: {
            name: treasureEntry?.name ?? "Treasure Token",
            oracle: treasureEntry?.oracle ?? "",
            types: treasureEntry?.types ?? (undefined as never),
            manaCost: treasureEntry?.manaCost ?? null,
            colors: treasureEntry?.colors,
            abilities: treasureEntry?.abilities ?? [],
            triggers: [],
            replacements: [],
            statics: [],
            keywords: treasureEntry?.keywords ?? [],
            svars: new Map(),
          },
        },
        controller: seat0,
        count: 1,
      }) as Generator<unknown, readonly EntityId[], unknown>,
    );
    expect(ids.length).toBe(1);
    const tokenId = ids[0];
    expect(tokenId).toBeDefined();
    if (tokenId === undefined) return;
    const token = game.cards.get(tokenId);
    expect(token).toBeDefined();
    if (!token) return;
    // Token's activated abilities populated from definition.
    expect(token.spellAbilities.length).toBe(1);
    expect(token.spellAbilities[0]?.ast.effect.handlerKey).toBe("Mana");

    // Activate the ability — pays {T} (the token isn't summoning-sick because
    // this MVP doesn't track it for non-creature tokens) and sacrifices.
    const player = game.getPlayer(seat0);
    const poolBefore = (player.manaPool as ManaPool).snapshot().length;
    expect(poolBefore).toBe(0);

    drainGen(activateAbility(game, tokenId, 0, seat0) as Generator<unknown, EntityId, unknown>);

    // After activation: stack has the ability, but the effect resolves
    // when the stack item resolves. For this test we directly drive the
    // top stack item's resolver since the outer driver loop isn't wired
    // here. The ManaEffect adds one ManaProduced; the cost-payment
    // already drove the sacrifice, so the token has moved to graveyard.
    const stackItem = game.sharedZones.stack.top();
    expect(stackItem).toBeDefined();
    if (!stackItem) return;
    const resolver = stackItem.resolver;
    expect(resolver).toBeDefined();
    if (!resolver) return;
    drainGen(resolver.resolve(game) as Generator<unknown, void, unknown>);

    // Pool now has one entry — TokenEffect produced "Any" → MVP colorless.
    const poolAfter = (player.manaPool as ManaPool).snapshot();
    expect(poolAfter.length).toBe(1);
    const atom = poolAfter[0] as ManaProduced;
    // "Any" maps to colorless in MVP (decision-system support pending).
    expect(atom.color).toBeNull();

    // Sacrifice already happened during cost payment: the token is in
    // its owner's graveyard.
    expect(token.zone).toBe(ZoneType.Graveyard);
  });

  it("Food / Clue / Blood / Powerstone all carry exactly one activated ability", () => {
    const expected: readonly { id: string; handlerKey: string }[] = [
      { id: "c_a_food_sac", handlerKey: "GainLife" },
      { id: "c_a_clue_draw", handlerKey: "Draw" },
      { id: "c_a_blood_draw", handlerKey: "Draw" },
      { id: "c_a_powerstone", handlerKey: "Mana" },
    ];
    for (const { id, handlerKey } of expected) {
      const entry = tokenDatabase.get(id);
      expect(entry).toBeDefined();
      expect(entry?.abilities.length).toBe(1);
      const ability = entry?.abilities[0];
      expect(ability?.kind).toBe("activated");
      expect(ability?.effect.handlerKey).toBe(handlerKey);
    }
  });
});
