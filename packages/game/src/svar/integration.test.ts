import { parseCard } from "@mtg-forge-ts/cards";
import type { AbilityAst, ParamValue, SVarAst } from "@mtg-forge-ts/core";
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Game } from "../game.js";
import type { SvarContext } from "./context.js";
import { evaluateSVar } from "./evaluator.js";
// Side-effect-load selectors
import "./selectors/number.js";
import "./selectors/x-choice.js";
import "./selectors/count.js";

describe("SVar evaluator integration", () => {
  it("resolves Fireball's NumDmg via Count$xPaid with xValue=3", () => {
    const src = `${[
      "Name:Fireball",
      "ManaCost:X R",
      "Types:Sorcery",
      "A:SP$ DealDamage | Cost$ X R | NumDmg$ X | ValidTgts$ Any",
      "SVar:X:Count$xPaid",
    ].join("\n")}\n`;
    const card = parseCard(src, "fireball.txt");
    const ability = card.abilities[0] as AbilityAst | undefined;
    expect(ability).toBeDefined();
    const numDmg = ability?.effect.params.NumDmg as ParamValue | undefined;
    expect(numDmg).toBeDefined();
    const svars = card.svars as ReadonlyMap<string, SVarAst>;
    const ctx: SvarContext = {
      game: {} as unknown as Game,
      svars,
      xValue: 3,
    };
    if (numDmg) {
      expect(evaluateSVar(numDmg, ctx)).toBe(3);
    }
  });

  it("Number$5 evaluates directly to 5", () => {
    const src = `${["Name:X", "Types:Instant", "A:SP$ Draw | Cost$ U | NumCards$ Number$5"].join("\n")}\n`;
    const card = parseCard(src, "x.txt");
    const abil = card.abilities[0] as AbilityAst;
    const numCards = abil.effect.params.NumCards as ParamValue | undefined;
    expect(numCards).toBeDefined();
    const ctx: SvarContext = {
      game: {} as unknown as Game,
      svars: card.svars as ReadonlyMap<string, SVarAst>,
    };
    if (numCards) {
      expect(evaluateSVar(numCards, ctx)).toBe(5);
    }
  });
});
