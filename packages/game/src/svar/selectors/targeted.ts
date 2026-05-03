// SPDX-License-Identifier: GPL-3.0-or-later
import { selectorRegistry } from "../selector-registry.js";

selectorRegistry.register("Targeted", (ast, ctx) => {
  const arg = ast.args?.[0]?.raw ?? "0";
  // Numeric index: returns the EntityId at that position.
  const idx = Number(arg);
  if (!Number.isNaN(idx) && idx >= 0 && /^\d+$/.test(arg)) {
    if (!ctx.targets || idx >= ctx.targets.length) {
      throw new Error(`Targeted$ selector: no target at index ${idx}`);
    }
    return ctx.targets[idx] as unknown as number;
  }
  // Property accessor: Targeted$CardPower / Targeted$CardToughness /
  // Targeted$CMC. Used by Forge SVars that compute numbers off a target's
  // characteristics (e.g. Swords to Plowshares' GainLife uses
  // SVar:X:Targeted$CardPower so the target's controller gains life equal
  // to its power; CR 614 LKI snapshot is taken at sub-ability creation
  // before the parent ChangeZone moves the card to Exile).
  if (!ctx.targets || ctx.targets.length === 0) {
    throw new Error(`Targeted$${arg}: no targets in context`);
  }
  const targetId = ctx.targets[0];
  if (targetId === undefined) {
    throw new Error(`Targeted$${arg}: undefined target id`);
  }
  const card = ctx.game.cards.get(targetId);
  if (!card) {
    throw new Error(`Targeted$${arg}: target ${targetId} not a card`);
  }
  const chars = ctx.game.layerEngine.computeCharacteristics(targetId);
  switch (arg) {
    case "CardPower":
      return chars.power ?? 0;
    case "CardToughness":
      return chars.toughness ?? 0;
    case "CMC": {
      const def = card.paperCard.definition;
      const mc = def?.manaCost;
      if (mc !== undefined && mc !== null) {
        const symbols = (mc as unknown as { symbols?: ReadonlyArray<unknown> }).symbols;
        if (Array.isArray(symbols)) return symbols.length;
        const cmc = (mc as unknown as { cmc?: number }).cmc;
        if (typeof cmc === "number") return cmc;
      }
      return 0;
    }
    default:
      throw new Error(`Targeted$${arg}: unsupported property accessor`);
  }
});
