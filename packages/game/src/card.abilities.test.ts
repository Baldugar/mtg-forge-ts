import { parseCard } from "@mtg-forge-ts/cards";
// SPDX-License-Identifier: GPL-3.0-or-later
// Task 58: Card.activateAbilitiesFromDefinition — verify that calling this
// method on a Card backed by a PaperCard with a real CardDefinition populates
// card.spellAbilities with live SpellAbility instances whose handlerKey and
// effect params match the parsed AbilityAst.
import type { PaperCard } from "@mtg-forge-ts/core";
import { DEFAULT_PAPER_CARD_FLAGS, ZoneType, mkEntityId, mkPlayerSeat } from "@mtg-forge-ts/core";
import { describe, expect, it } from "vitest";
import { Card } from "./card.js";

// Ensure SVar selectors are registered so evaluateParamNumber works inside
// SpellAbility.makeResolver() even if called later in the same suite.
import "./svar/selectors/number.js";

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
