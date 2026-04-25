// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 6 — cost-mod filter language tests. Hits each documented filter
// dimension: ValidCard$ bases + qualifiers, comma-OR alternatives, dot-AND
// chains, Type$ Spell vs Ability, Activator$ You / Opponent.
import type { LobbyPlayer, ManaCostAst, PaperCard, ParamValue } from "@mtg-forge-ts/core";
import {
  CardType,
  Color,
  ColorSet,
  DEFAULT_PAPER_CARD_FLAGS,
  SeededRng,
  type Supertype,
  TypeLine,
  ZoneType,
  mkEntityId,
  mkPlayerSeat,
} from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "../card.js";
import type { GameMeta } from "../game-meta.js";
import type { GameRules } from "../game-rules.js";
import { Game } from "../game.js";
import { type SpellCostModItem, buildCostModFilter } from "./cost-mod-filter.js";

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
const makeGame = (): Game => new Game({ lobbyPlayers: [alice, bob], rules, meta, rng: new SeededRng(1n) });

const lit = (raw: string): ParamValue => ({ kind: "literal", raw });

interface FixtureOpts {
  readonly types: readonly CardType[];
  readonly subtypes?: readonly string[];
  readonly supertypes?: readonly Supertype[];
  readonly colors?: ColorSet;
  readonly manaCostSymbols?: ManaCostAst["symbols"];
}

const mkPaper = (name: string, opts: FixtureOpts): PaperCard => {
  const types = new TypeLine(opts.supertypes ?? [], opts.types, opts.subtypes ?? []);
  const manaCost: ManaCostAst | null = opts.manaCostSymbols
    ? { raw: "fixture", symbols: opts.manaCostSymbols }
    : null;
  return {
    name,
    edition: "TST",
    collectorNumber: "1",
    language: "en",
    foil: false,
    flags: DEFAULT_PAPER_CARD_FLAGS,
    definition: {
      name,
      oracle: "",
      types,
      manaCost,
      ...(opts.colors ? { colors: opts.colors } : {}),
      abilities: [],
      triggers: [],
      replacements: [],
      statics: [],
      keywords: [],
      svars: new Map(),
    },
  };
};

describe("buildCostModFilter (Wave 6)", () => {
  const game = makeGame();
  const aliceSeat = mkPlayerSeat(0);
  const bobSeat = mkPlayerSeat(1);
  const staticSourceId = mkEntityId(100);

  const blackCreaturePaper = mkPaper("Black Bear", {
    types: [CardType.Creature],
    subtypes: ["Bear"],
    colors: ColorSet.of(Color.Black),
    manaCostSymbols: [
      { kind: "generic", amount: 1 },
      { kind: "colored", color: Color.Black },
    ],
  });
  const redInstantPaper = mkPaper("Red Instant", {
    types: [CardType.Instant],
    colors: ColorSet.of(Color.Red),
    manaCostSymbols: [{ kind: "colored", color: Color.Red }],
  });
  const blackInstantPaper = mkPaper("Black Instant", {
    types: [CardType.Instant],
    colors: ColorSet.of(Color.Black),
    manaCostSymbols: [{ kind: "colored", color: Color.Black }],
  });

  const mkCard = (paper: PaperCard, owner = aliceSeat): Card =>
    new Card(mkEntityId(0), paper, owner, owner, ZoneType.Hand);

  const mkItem = (
    card: Card | undefined,
    controllerSeat = aliceSeat,
    kind: "spell" | "ability" = "spell",
  ): SpellCostModItem => ({
    sourceCardId: card?.id ?? mkEntityId(999),
    controllerSeat,
    card,
    kind,
  });

  it("ValidCard$ Card.Black matches a black spell", () => {
    const filter = buildCostModFilter({ ValidCard: lit("Card.Black") }, aliceSeat, staticSourceId);
    expect(filter(mkItem(mkCard(blackCreaturePaper)), game)).toBe(true);
    expect(filter(mkItem(mkCard(redInstantPaper)), game)).toBe(false);
  });

  it("ValidCard$ Creature matches a creature, rejects a non-creature", () => {
    const filter = buildCostModFilter({ ValidCard: lit("Creature") }, aliceSeat, staticSourceId);
    expect(filter(mkItem(mkCard(blackCreaturePaper)), game)).toBe(true);
    expect(filter(mkItem(mkCard(redInstantPaper)), game)).toBe(false);
  });

  it("ValidCard$ nonCreature negates Creature", () => {
    const filter = buildCostModFilter({ ValidCard: lit("Card.nonCreature") }, aliceSeat, staticSourceId);
    expect(filter(mkItem(mkCard(blackCreaturePaper)), game)).toBe(false);
    expect(filter(mkItem(mkCard(redInstantPaper)), game)).toBe(true);
  });

  it("ValidCard$ Card.YouCtrl gates on controller", () => {
    const filter = buildCostModFilter({ ValidCard: lit("Card.YouCtrl") }, aliceSeat, staticSourceId);
    const card = mkCard(blackCreaturePaper);
    expect(filter(mkItem(card, aliceSeat), game)).toBe(true);
    expect(filter(mkItem(card, bobSeat), game)).toBe(false);
  });

  it("ValidCard$ Card.OppCtrl is the inverse", () => {
    const filter = buildCostModFilter({ ValidCard: lit("Card.OppCtrl") }, aliceSeat, staticSourceId);
    const card = mkCard(blackCreaturePaper);
    expect(filter(mkItem(card, aliceSeat), game)).toBe(false);
    expect(filter(mkItem(card, bobSeat), game)).toBe(true);
  });

  it("ValidCard$ Card.Self matches only the static source card", () => {
    const filter = buildCostModFilter({ ValidCard: lit("Card.Self") }, aliceSeat, staticSourceId);
    const item: SpellCostModItem = {
      sourceCardId: staticSourceId,
      controllerSeat: aliceSeat,
      card: mkCard(blackCreaturePaper),
      kind: "spell",
    };
    expect(filter(item, game)).toBe(true);
    expect(filter({ ...item, sourceCardId: mkEntityId(999) }, game)).toBe(false);
  });

  it("ValidCard$ comma-OR alternatives accept any matching alt", () => {
    const filter = buildCostModFilter({ ValidCard: lit("Creature, Instant") }, aliceSeat, staticSourceId);
    expect(filter(mkItem(mkCard(blackCreaturePaper)), game)).toBe(true);
    expect(filter(mkItem(mkCard(redInstantPaper)), game)).toBe(true);
    const enchantPaper = mkPaper("Aura", { types: [CardType.Enchantment] });
    expect(filter(mkItem(mkCard(enchantPaper)), game)).toBe(false);
  });

  it("Type$ Spell rejects ability-kind items", () => {
    const filter = buildCostModFilter({ Type: lit("Spell") }, aliceSeat, staticSourceId);
    expect(filter(mkItem(mkCard(blackCreaturePaper), aliceSeat, "spell"), game)).toBe(true);
    expect(filter(mkItem(mkCard(blackCreaturePaper), aliceSeat, "ability"), game)).toBe(false);
  });

  it("Type$ Ability rejects spell-kind items", () => {
    const filter = buildCostModFilter({ Type: lit("Ability") }, aliceSeat, staticSourceId);
    expect(filter(mkItem(mkCard(blackCreaturePaper), aliceSeat, "spell"), game)).toBe(false);
    expect(filter(mkItem(mkCard(blackCreaturePaper), aliceSeat, "ability"), game)).toBe(true);
  });

  it("Activator$ You vs Opponent gates by controller seat", () => {
    const youFilter = buildCostModFilter({ Activator: lit("You") }, aliceSeat, staticSourceId);
    const oppFilter = buildCostModFilter({ Activator: lit("Opponent") }, aliceSeat, staticSourceId);
    const card = mkCard(blackInstantPaper);
    expect(youFilter(mkItem(card, aliceSeat), game)).toBe(true);
    expect(youFilter(mkItem(card, bobSeat), game)).toBe(false);
    expect(oppFilter(mkItem(card, aliceSeat), game)).toBe(false);
    expect(oppFilter(mkItem(card, bobSeat), game)).toBe(true);
  });

  it("rejects malformed item shapes (no card / non-object)", () => {
    const filter = buildCostModFilter({ ValidCard: lit("Card") }, aliceSeat, staticSourceId);
    expect(filter(undefined, game)).toBe(false);
    expect(filter(null, game)).toBe(false);
    expect(filter("nonsense", game)).toBe(false);
  });

  it("empty params accepts every well-shaped item", () => {
    const filter = buildCostModFilter({}, aliceSeat, staticSourceId);
    expect(filter(mkItem(mkCard(blackCreaturePaper)), game)).toBe(true);
    expect(filter(mkItem(mkCard(redInstantPaper)), game)).toBe(true);
  });

  it("color match falls back to mana-cost symbols when colors field is absent", () => {
    const noColorsField = mkPaper("Mono-B no Colors field", {
      types: [CardType.Instant],
      manaCostSymbols: [{ kind: "colored", color: Color.Black }],
    });
    const filter = buildCostModFilter({ ValidCard: lit("Card.Black") }, aliceSeat, staticSourceId);
    expect(filter(mkItem(mkCard(noColorsField)), game)).toBe(true);
  });
});
