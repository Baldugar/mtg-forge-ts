import { parseCard } from "@mtg-forge-ts/cards";
// SPDX-License-Identifier: GPL-3.0-or-later
// Task 58: Card.activateAbilitiesFromDefinition — verify that calling this
// method on a Card backed by a PaperCard with a real CardDefinition populates
// card.spellAbilities with live SpellAbility instances whose handlerKey and
// effect params match the parsed AbilityAst.
//
// Task 4 (Part E): Card.activateTriggersFromDefinition — verify that calling
// this method produces live TriggeredAbility instances and registers them with
// game.triggerRegistry.
import type { LobbyPlayer, PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, SeededRng, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "./card.js";
import type { GameMeta } from "./game-meta.js";
import type { GameRules } from "./game-rules.js";
import { Game } from "./game.js";

// Ensure SVar selectors are registered so evaluateParamNumber works inside
// SpellAbility.makeResolver() even if called later in the same suite.
import "./svar/selectors/number.js";
// Ensure trigger handlers are registered for activateTriggersFromDefinition.
import "./trigger/index.js";
// Ensure replacement handlers are registered for activateReplacementsFromDefinition.
import "./replacement/index.js";

const boltSrc = `${[
  "Name:Lightning Bolt",
  "ManaCost:R",
  "Types:Instant",
  "A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ CARDNAME deals 3 damage to any target.",
  "Oracle:Lightning Bolt deals 3 damage to any target.",
].join("\n")}\n`;

const makePaperCard = (def: ReturnType<typeof parseCard>): PaperCard => ({
  name: def.name,
  edition: "LEA",
  collectorNumber: "161",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
  definition: def,
});

describe("Card.activateAbilitiesFromDefinition", () => {
  it("populates spellAbilities from a Lightning Bolt definition", () => {
    const def = parseCard(boltSrc, "lightning_bolt.txt");
    const paper = makePaperCard(def);
    const id = mkEntityId(1);
    const seat = mkPlayerSeat(0);
    const card = new Card(id, paper, seat, seat, ZoneType.Hand);

    expect(card.spellAbilities).toHaveLength(0);

    card.activateAbilitiesFromDefinition();

    expect(card.spellAbilities).toHaveLength(1);
    const sa = card.spellAbilities[0];
    expect(sa).toBeDefined();
    expect(sa?.handlerKey).toBe("DealDamage");
    expect(sa?.sourceCardId).toBe(id);
    expect(sa?.controllerSeat).toBe(seat);
  });

  it("reads NumDmg$ 3 from the AST params", () => {
    const def = parseCard(boltSrc, "lightning_bolt.txt");
    const paper = makePaperCard(def);
    const id = mkEntityId(2);
    const seat = mkPlayerSeat(0);
    const card = new Card(id, paper, seat, seat, ZoneType.Hand);
    card.activateAbilitiesFromDefinition();

    const sa = card.spellAbilities[0];
    const numDmgParam = sa?.ast.effect.params.NumDmg;
    expect(numDmgParam).toBeDefined();
    expect(numDmgParam).toMatchObject({ kind: "literal", raw: "3" });
  });

  it("is a no-op when PaperCard has no definition (token-like cards)", () => {
    const tokenPaper: PaperCard = {
      name: "Elf Token",
      edition: "TST",
      collectorNumber: "T001",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      // no definition field
    };
    const id = mkEntityId(3);
    const seat = mkPlayerSeat(0);
    const card = new Card(id, tokenPaper, seat, seat, ZoneType.Battlefield);
    card.activateAbilitiesFromDefinition();
    expect(card.spellAbilities).toHaveLength(0);
  });

  it("is idempotent — calling twice uses the latest definition", () => {
    const def = parseCard(boltSrc, "lightning_bolt.txt");
    const paper = makePaperCard(def);
    const id = mkEntityId(4);
    const seat = mkPlayerSeat(0);
    const card = new Card(id, paper, seat, seat, ZoneType.Hand);
    card.activateAbilitiesFromDefinition();
    card.activateAbilitiesFromDefinition();
    expect(card.spellAbilities).toHaveLength(1);
  });

  it("inherits svars from the definition (Fireball X-cost)", () => {
    const fireballSrc = `${[
      "Name:Fireball",
      "ManaCost:X R",
      "Types:Sorcery",
      "A:SP$ DealDamage | Cost$ X R | NumDmg$ X | ValidTgts$ Any",
      "SVar:X:Count$xPaid",
      "Oracle:Fireball deals X damage.",
    ].join("\n")}\n`;
    const def = parseCard(fireballSrc, "fireball.txt");
    const paper = makePaperCard(def);
    const id = mkEntityId(5);
    const seat = mkPlayerSeat(0);
    const card = new Card(id, paper, seat, seat, ZoneType.Hand);
    card.activateAbilitiesFromDefinition();

    const sa = card.spellAbilities[0];
    // The svars map should contain "X"
    expect(sa?.svars.has("X")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 4 (Part E) — Card.activateTriggersFromDefinition
// ---------------------------------------------------------------------------

const alice: LobbyPlayer = { id: "P0", name: "P0", controllerKind: "human" };
const bob: LobbyPlayer = { id: "P1", name: "P1", controllerKind: "human" };

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
  gamesPerMatch: 1,
  appliedVariants: [],
};

const meta: GameMeta = {
  engineVersion: "0.0.0",
  forgeSha: "test",
  cardDataSyncedAt: "2026-04-23T00:00:00Z",
  crVersion: "2024-11-08",
  seed: "deadbeef",
};

const mkGame = (): Game =>
  new Game({
    lobbyPlayers: [alice, bob],
    rules,
    meta,
    rng: new SeededRng(0xdeadbeefn),
  });

// Mulldrifter-like ETB draw trigger
const mulldrifterSrc = `${[
  "Name:Mulldrifter",
  "ManaCost:4 U",
  "Types:Creature - Elemental",
  "PT:2/2",
  "T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ TrigDraw | TriggerDescription$ When this enters, draw two cards.",
  "SVar:TrigDraw:AB$ Draw | Cost$ 0 | NumCards$ 2",
  "Oracle:When Mulldrifter enters, draw two cards.",
].join("\n")}\n`;

describe("Card.activateTriggersFromDefinition", () => {
  it("populates triggeredAbilities from a Mulldrifter-like ETB trigger definition", () => {
    const def = parseCard(mulldrifterSrc, "mulldrifter.txt");
    const paper: PaperCard = {
      name: def.name,
      edition: "LRW",
      collectorNumber: "056",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const game = mkGame();
    const id = mkEntityId(42);
    const seat = mkPlayerSeat(0);
    const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);

    expect(card.triggeredAbilities).toHaveLength(0);

    card.activateTriggersFromDefinition(game);

    expect(card.triggeredAbilities).toHaveLength(1);
    const ta = card.triggeredAbilities[0];
    expect(ta).toBeDefined();
    expect(ta?.kind).toBe("triggered");
    expect(ta?.sourceCardId).toBe(id);
    expect(ta?.controllerSeatAtReg).toBe(seat);
    expect(ta?.isDelayed).toBe(false);
  });

  it("registers the trigger with game.triggerRegistry", () => {
    const def = parseCard(mulldrifterSrc, "mulldrifter.txt");
    const paper: PaperCard = {
      name: def.name,
      edition: "LRW",
      collectorNumber: "056",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const game = mkGame();
    const id = mkEntityId(43);
    const seat = mkPlayerSeat(0);
    const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);

    // Registry should be empty before activation
    game.triggerRegistry.onEvent({
      // Craft a matching event — should produce no pending triggers yet
      kind: "CardChangedZone",
      version: 1,
      turn: 1,
      phase: "Main1" as never,
      payload: { cardId: id, fromZone: ZoneType.Hand, toZone: ZoneType.Battlefield },
    });
    expect(game.triggerRegistry.drain()).toHaveLength(0);

    card.activateTriggersFromDefinition(game);

    // Now fire the same event — trigger should fire
    game.triggerRegistry.onEvent({
      kind: "CardChangedZone",
      version: 1,
      turn: 1,
      phase: "Main1" as never,
      payload: { cardId: id, fromZone: ZoneType.Hand, toZone: ZoneType.Battlefield },
    });
    const pending = game.triggerRegistry.drain();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.sourceCardId).toBe(id);
  });

  it("is a no-op when PaperCard has no definition", () => {
    const tokenPaper: PaperCard = {
      name: "Elf Token",
      edition: "TST",
      collectorNumber: "T001",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
    };
    const game = mkGame();
    const id = mkEntityId(44);
    const seat = mkPlayerSeat(0);
    const card = new Card(id, tokenPaper, seat, seat, ZoneType.Battlefield);
    card.activateTriggersFromDefinition(game);
    expect(card.triggeredAbilities).toHaveLength(0);
  });

  it("silently skips trigger modes not yet registered", () => {
    const unknownTriggerSrc = `${[
      "Name:Unknown Trigger Card",
      "ManaCost:1",
      "Types:Creature",
      "PT:1/1",
      "T:Mode$ UnknownMode | Execute$ TrigX | TriggerDescription$ When something happens, do X.",
      "SVar:TrigX:AB$ Draw | Cost$ 0 | NumCards$ 1",
      "Oracle:When something happens, draw a card.",
    ].join("\n")}\n`;
    const def = parseCard(unknownTriggerSrc, "unknown.txt");
    const paper: PaperCard = {
      name: def.name,
      edition: "TST",
      collectorNumber: "001",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const game = mkGame();
    const id = mkEntityId(45);
    const seat = mkPlayerSeat(0);
    const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
    // Should not throw
    card.activateTriggersFromDefinition(game);
    expect(card.triggeredAbilities).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Task 4 (Part F) — Card.activateReplacementsFromDefinition
// ---------------------------------------------------------------------------

// A simple "if this would die, exile it instead" card — uses the Moved
// replacement handler registered by the replacement framework bootstrap.
// ReplaceWith$ must reference an SVar (resolver rule for replacements);
// we declare a stub SVar for DBExile to satisfy validation.
const exileOnDieSrc = `${[
  "Name:Exile On Die",
  "ManaCost:1",
  "Types:Creature",
  "PT:1/1",
  "R:Event$ Moved | Origin$ Any | Destination$ Graveyard | ValidCard$ Card.Self | ReplaceWith$ DBExile | Description$ If this would die, exile it instead.",
  "SVar:DBExile:AB$ Exile | Cost$ 0 | Defined$ ReplacedCard",
  "Oracle:If this would die, exile it instead.",
].join("\n")}\n`;

describe("Card.activateReplacementsFromDefinition", () => {
  it("populates replacementAbilities from a Moved replacement definition", () => {
    const def = parseCard(exileOnDieSrc, "exile-on-die.txt");
    const paper: PaperCard = {
      name: def.name,
      edition: "TST",
      collectorNumber: "001",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const game = mkGame();
    const id = mkEntityId(50);
    const seat = mkPlayerSeat(0);
    const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);

    expect(card.replacementAbilities).toHaveLength(0);

    card.activateReplacementsFromDefinition(game);

    expect(card.replacementAbilities).toHaveLength(1);
    const ra = card.replacementAbilities[0];
    expect(ra).toBeDefined();
    expect(ra?.kind).toBe("replacement");
    expect(ra?.sourceCardId).toBe(id);
    expect(ra?.controllerSeatAtReg).toBe(seat);
    expect(ra?.isSelfReplacement).toBe(false); // Self$ not set in this card
    expect(ra?.layer).toBe("other");
  });

  it("registers the replacement with game.replacementRegistry", () => {
    const def = parseCard(exileOnDieSrc, "exile-on-die.txt");
    const paper: PaperCard = {
      name: def.name,
      edition: "TST",
      collectorNumber: "001",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: def,
    };
    const game = mkGame();
    const id = mkEntityId(51);
    const seat = mkPlayerSeat(0);
    const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);

    // Registry should be empty before activation
    expect(game.replacementRegistry.size()).toBe(0);

    card.activateReplacementsFromDefinition(game);

    expect(game.replacementRegistry.size()).toBe(1);
    const regs = game.replacementRegistry.byCard(id);
    expect(regs).toHaveLength(1);
    expect(regs[0]?.sourceCardId).toBe(id);
  });

  it("is a no-op when PaperCard has no definition", () => {
    const tokenPaper: PaperCard = {
      name: "Elf Token",
      edition: "TST",
      collectorNumber: "T001",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
    };
    const game = mkGame();
    const id = mkEntityId(52);
    const seat = mkPlayerSeat(0);
    const card = new Card(id, tokenPaper, seat, seat, ZoneType.Battlefield);
    card.activateReplacementsFromDefinition(game);
    expect(card.replacementAbilities).toHaveLength(0);
  });

  it("silently skips replacement eventKinds not yet registered", () => {
    // Build a card with a manual replacement AST for an unknown eventKind
    // by using a definition without an R: line but patching the replacements.
    const blankSrc = `${["Name:Blank Card", "ManaCost:1", "Types:Creature", "PT:1/1", "Oracle:Blank."].join(
      "\n",
    )}\n`;
    const def = parseCard(blankSrc, "blank.txt");
    // Inject a fake replacement AST with an unknown eventKind
    const patchedDef = {
      ...def,
      replacements: [
        {
          eventKind: "UnknownEvent",
          params: {},
          effect: { handlerKey: "DBX", params: {} },
        },
      ],
    };
    const paper: PaperCard = {
      name: def.name,
      edition: "TST",
      collectorNumber: "002",
      language: "en",
      foil: false,
      flags: DEFAULT_PAPER_CARD_FLAGS,
      definition: patchedDef as never,
    };
    const game = mkGame();
    const id = mkEntityId(53);
    const seat = mkPlayerSeat(0);
    const card = new Card(id, paper, seat, seat, ZoneType.Battlefield);
    // Should not throw
    card.activateReplacementsFromDefinition(game);
    expect(card.replacementAbilities).toHaveLength(0);
  });
});
