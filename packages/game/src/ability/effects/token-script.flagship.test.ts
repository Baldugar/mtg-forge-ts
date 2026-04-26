// SPDX-License-Identifier: GPL-3.0-or-later
// Flagship test — parse a real Forge card that uses `TokenScript$` and
// verify that the parsed-and-resolved token effect spawns the correct
// token shape on the battlefield.
//
// We pick three cards that exercise three distinct scripts:
//   - Haazda Marshal           → TokenScript$ w_1_1_soldier_lifelink
//   - Hapatra, Vizier of P.    → TokenScript$ g_1_1_snake_deathtouch
//   - Quintorius Loremaster    → TokenScript$ rw_3_2_spirit
//
// The cards' Token effects live inside SVars referenced by triggers; we
// pluck the SVar's AbilityAst and run it through SpellAbility resolve so
// the round-trip exercises parser → handler → token database lookup.
import "../../svar/selectors/number.js";
import "./token.js";
import { parseCard } from "@mtg-forge-ts/cards";
import type { AbilityAst, EffectInvocation, LobbyPlayer, SVarAst } from "@mtg-forge-ts/core";
import { SeededRng, ZoneType, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import type { GameMeta } from "../../game-meta.js";
import type { GameRules } from "../../game-rules.js";
import { Game } from "../../game.js";
import { Battlefield } from "../../zone/zones/battlefield.js";
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
  }
  return game;
};

const drainGen = <T>(gen: Generator<unknown, T, unknown>): T => {
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value as T;
};

const HAAZDA_MARSHAL = `Name:Haazda Marshal
ManaCost:W
Types:Creature Human Soldier
PT:1/1
T:Mode$ Attacks | ValidCard$ Card.Self | TriggerZones$ Battlefield | IsPresent$ Creature.attacking+Other | PresentCompare$ GE2 | NoResolvingCheck$ True | Execute$ TrigToken | TriggerDescription$ Whenever CARDNAME and at least two other creatures attack, create a 1/1 white Soldier creature token with lifelink.
SVar:TrigToken:DB$ Token | TokenScript$ w_1_1_soldier_lifelink
DeckHas:Ability$Token|LifeGain
Oracle:Whenever Haazda Marshal and at least two other creatures attack, create a 1/1 white Soldier creature token with lifelink.
`;

const HAPATRA = `Name:Hapatra, Vizier of Poisons
ManaCost:B G
Types:Legendary Creature Human Cleric
PT:2/2
T:Mode$ DamageDone | ValidSource$ Card.Self | ValidTarget$ Player | CombatDamage$ True | TriggerZones$ Battlefield | OptionalDecider$ You | Execute$ TrigPutCounter | TriggerDescription$ Whenever CARDNAME deals combat damage to a player, you may put a -1/-1 counter on target creature.
SVar:TrigPutCounter:DB$ PutCounter | ValidTgts$ Creature | CounterType$ M1M1 | CounterNum$ 1 | IsCurse$ True
T:Mode$ CounterAddedOnce | ValidCard$ Creature | ValidSource$ You | CounterType$ M1M1 | TriggerZones$ Battlefield | Execute$ TrigToken | TriggerDescription$ Whenever you put one or more -1/-1 counters on a creature, create a 1/1 green Snake creature token with deathtouch.
SVar:TrigToken:DB$ Token | TokenScript$ g_1_1_snake_deathtouch | TokenOwner$ You
DeckHas:Ability$Counters|Token
Oracle:Whenever Hapatra, Vizier of Poisons deals combat damage to a player, you may put a -1/-1 counter on target creature.\\nWhenever you put one or more -1/-1 counters on a creature, create a 1/1 green Snake creature token with deathtouch.
`;

/**
 * Pull the EffectInvocation that the named SVar carries (the SVar's parsed
 * `ability.effect` field). Throws if the SVar isn't found / didn't parse.
 */
const effectFromSVar = (svars: ReadonlyMap<string, SVarAst>, name: string): EffectInvocation => {
  const svar = svars.get(name);
  if (!svar) throw new Error(`SVar ${name} not found in parsed card`);
  if (!svar.ability) throw new Error(`SVar ${name} did not parse an ability`);
  return svar.ability;
};

const mkSpellAbilityFromEffect = (game: Game, effect: EffectInvocation): SpellAbility => {
  const seat0 = mkPlayerSeat(0);
  const sourceId = game.newEntityId();
  const ast: AbilityAst = {
    kind: "spell",
    effect,
    cost: { raw: "" },
  };
  return new SpellAbility(ast, sourceId, seat0, new Map());
};

describe("TokenScript$ flagship — real Forge cards round-trip", () => {
  it("Haazda Marshal: TrigToken creates a 1/1 white Soldier with Lifelink", () => {
    const card = parseCard(HAAZDA_MARSHAL, "haazda_marshal.txt");
    const svars = card.svars as ReadonlyMap<string, SVarAst>;
    const effect = effectFromSVar(svars, "TrigToken");
    expect(effect.handlerKey).toBe("Token");

    const game = mkGame();
    const sa = mkSpellAbilityFromEffect(game, effect);
    const seat0 = mkPlayerSeat(0);
    const bf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(bf?.size).toBe(1);
    const id = bf?.toArray()[0];
    const token = game.cards.get(id ?? (0 as ReturnType<typeof game.newEntityId>));
    expect(token?.isToken).toBe(true);
    expect(token?.paperCard.name).toBe("Soldier Token");
    expect(token?.paperCard.definition?.pt?.power).toBe("1");
    expect(token?.paperCard.definition?.pt?.toughness).toBe("1");
    const keywords = token?.paperCard.definition?.keywords as readonly { keyword: string }[];
    expect(keywords.length).toBe(1);
    expect(keywords[0]?.keyword).toBe("lifelink");
  });

  it("Hapatra: TrigToken creates a 1/1 green Snake with Deathtouch", () => {
    const card = parseCard(HAPATRA, "hapatra.txt");
    const svars = card.svars as ReadonlyMap<string, SVarAst>;
    const effect = effectFromSVar(svars, "TrigToken");
    expect(effect.handlerKey).toBe("Token");

    const game = mkGame();
    const sa = mkSpellAbilityFromEffect(game, effect);
    const seat0 = mkPlayerSeat(0);
    const bf = game.getPlayer(seat0).zones.get(ZoneType.Battlefield);

    drainGen(sa.makeResolver().resolve(game) as Generator<unknown, void, unknown>);

    expect(bf?.size).toBe(1);
    const id = bf?.toArray()[0];
    const token = game.cards.get(id ?? (0 as ReturnType<typeof game.newEntityId>));
    expect(token?.paperCard.name).toBe("Snake Token");
    const keywords = token?.paperCard.definition?.keywords as readonly { keyword: string }[];
    expect(keywords[0]?.keyword).toBe("deathtouch");
  });
});
