// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { Rarity } from "../card/types.js";
import type { FormatDefinition, FormatDefinitionSnapshot, MulliganRule } from "./format-definition.js";

const mkModern = (): FormatDefinition => ({
  id: "modern",
  displayName: "Modern",
  category: "constructed",
  setLegality: { kind: "sets-as-of-date", asOfDate: "2003-07-28" },
  banlist: {
    entries: [
      {
        effectiveDate: "2024-09-01",
        banned: ["Grief", "Fury"],
      },
    ],
  },
  deckConstruction: {
    minMain: 60,
    maxSideboard: 15,
    maxCopiesNonBasic: 4,
    mustHaveCommander: false,
  },
  gameRules: {
    startingLife: 20,
    startingHandSize: 7,
    mulliganRule: "london",
    firstPlayerSkipsDraw: true,
  },
  source: "wotc-official",
  lastUpdated: "2024-09-01",
});

const mkPauper = (): FormatDefinition => ({
  id: "pauper",
  displayName: "Pauper",
  category: "constructed",
  setLegality: { kind: "all-sets" },
  rarityRestriction: [Rarity.Common],
  banlist: { entries: [] },
  deckConstruction: {
    minMain: 60,
    maxSideboard: 15,
    maxCopiesNonBasic: 4,
    mustHaveCommander: false,
  },
  gameRules: {
    startingLife: 20,
    startingHandSize: 7,
    mulliganRule: "london",
    firstPlayerSkipsDraw: true,
  },
  source: "wotc-official",
  lastUpdated: "2024-01-01",
});

const mkCommander = (): FormatDefinition => ({
  id: "commander",
  displayName: "Commander",
  category: "casual",
  setLegality: { kind: "all-sets" },
  banlist: { entries: [] },
  deckConstruction: {
    minMain: 99,
    maxMain: 99,
    maxSideboard: 0,
    maxCopiesNonBasic: 1,
    mustHaveCommander: true,
    commanderSlot: {
      kind: "single",
      colorIdentityEnforced: true,
      allowPartners: true,
      allowBackground: true,
    },
    colorIdentityConstraint: true,
  },
  gameRules: {
    startingLife: 40,
    startingHandSize: 7,
    mulliganRule: "london",
    firstPlayerSkipsDraw: false,
    playerCount: { min: 2, max: 6 },
  },
  source: "wotc-official",
  lastUpdated: "2024-09-23",
});

describe("FormatDefinition — shape + JSON round-trip", () => {
  it("Modern literal round-trips through JSON", () => {
    const f = mkModern();
    const rt = JSON.parse(JSON.stringify(f)) as FormatDefinition;
    expect(rt).toEqual(f);
  });

  it("Pauper literal honors rarityRestriction", () => {
    const f = mkPauper();
    expect(f.rarityRestriction).toEqual([Rarity.Common]);
    const rt = JSON.parse(JSON.stringify(f)) as FormatDefinition;
    expect(rt).toEqual(f);
  });

  it("Commander literal carries commanderSlot + colorIdentityConstraint", () => {
    const f = mkCommander();
    expect(f.deckConstruction.mustHaveCommander).toBe(true);
    expect(f.deckConstruction.commanderSlot?.colorIdentityEnforced).toBe(true);
    const rt = JSON.parse(JSON.stringify(f)) as FormatDefinition;
    expect(rt).toEqual(f);
  });

  it("FormatDefinitionSnapshot pairs a definition with validAsOf", () => {
    const snap: FormatDefinitionSnapshot = {
      format: mkModern(),
      validAsOf: "2025-06-10",
    };
    const rt = JSON.parse(JSON.stringify(snap)) as FormatDefinitionSnapshot;
    expect(rt).toEqual(snap);
  });

  it("banlist entry with restricted + added lists", () => {
    const f: FormatDefinition = {
      ...mkModern(),
      banlist: {
        entries: [
          {
            effectiveDate: "2025-01-01",
            banned: ["X"],
            restricted: ["Y"],
            added: ["Z"],
          },
        ],
      },
    };
    const rt = JSON.parse(JSON.stringify(f)) as FormatDefinition;
    expect(rt).toEqual(f);
  });

  it("set-list setLegality round-trips with explicit set codes", () => {
    const f: FormatDefinition = {
      ...mkModern(),
      setLegality: { kind: "set-list", sets: ["LEA", "LEB", "2ED"] },
    };
    const rt = JSON.parse(JSON.stringify(f)) as FormatDefinition;
    expect(rt).toEqual(f);
  });
});

describe("MulliganRule", () => {
  it("accepts all five WOTC rules plus the TS-native 'free' rule", () => {
    const rules: MulliganRule[] = ["london", "vancouver", "paris", "original", "houston", "free"];
    expect(rules).toHaveLength(6);
  });
});
