// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { DEFAULT_PAPER_CARD_FLAGS, type PaperCard } from "../card/paper-card.js";
import {
  ADVENTURE_IMAGE,
  BACKFACE_POSTFIX,
  BLESSING_IMAGE,
  CLOAKED_IMAGE,
  FORETELL_IMAGE,
  HIDDEN_CARD,
  INITIATIVE_IMAGE,
  MANIFEST_IMAGE,
  MAX_SPEED_IMAGE,
  MONARCH_IMAGE,
  MORPH_IMAGE,
  PREFIX_ADVENTURECARD,
  PREFIX_BOOSTER,
  PREFIX_BOOSTERBOX,
  PREFIX_CARD,
  PREFIX_FATPACK,
  PREFIX_ICON,
  PREFIX_PRECON,
  PREFIX_TOKEN,
  PREFIX_TOURNAMENTPACK,
  RADIATION_IMAGE,
  SPECFACE_B,
  SPECFACE_G,
  SPECFACE_R,
  SPECFACE_U,
  SPECFACE_W,
  SPEED_IMAGE,
  THE_RING_IMAGE,
  imageKeyForCard,
  imageKeyForToken,
} from "./image-keys.js";

const bolt: PaperCard = {
  name: "Lightning Bolt",
  set: "LEA",
  collectorNumber: "161",
  language: "en",
  foil: false,
  flags: DEFAULT_PAPER_CARD_FLAGS,
};

describe("ImageKeys — prefix constants", () => {
  it("matches Forge ImageKeys.java string values", () => {
    expect(PREFIX_CARD).toBe("c:");
    expect(PREFIX_TOKEN).toBe("t:");
    expect(PREFIX_ICON).toBe("i:");
    expect(PREFIX_BOOSTER).toBe("b:");
    expect(PREFIX_FATPACK).toBe("f:");
    expect(PREFIX_BOOSTERBOX).toBe("x:");
    expect(PREFIX_PRECON).toBe("p:");
    expect(PREFIX_TOURNAMENTPACK).toBe("o:");
    expect(PREFIX_ADVENTURECARD).toBe("a:");
  });

  it("matches Forge synthetic-image constant strings", () => {
    expect(HIDDEN_CARD).toBe("hidden");
    expect(MORPH_IMAGE).toBe("morph");
    expect(MANIFEST_IMAGE).toBe("manifest");
    expect(CLOAKED_IMAGE).toBe("cloaked");
    expect(FORETELL_IMAGE).toBe("foretell");
    expect(BLESSING_IMAGE).toBe("blessing");
    expect(INITIATIVE_IMAGE).toBe("initiative");
    expect(MONARCH_IMAGE).toBe("monarch");
    expect(THE_RING_IMAGE).toBe("the_ring");
    expect(RADIATION_IMAGE).toBe("radiation");
    expect(SPEED_IMAGE).toBe("speed");
    expect(MAX_SPEED_IMAGE).toBe("max_speed");
    expect(ADVENTURE_IMAGE).toBe("adventure");
  });

  it("matches Forge face-postfix strings", () => {
    expect(BACKFACE_POSTFIX).toBe("$alt");
    expect(SPECFACE_W).toBe("$wspec");
    expect(SPECFACE_U).toBe("$uspec");
    expect(SPECFACE_B).toBe("$bspec");
    expect(SPECFACE_R).toBe("$rspec");
    expect(SPECFACE_G).toBe("$gspec");
  });
});

describe("imageKeyForCard / imageKeyForToken", () => {
  it("produces c:<name>|<set>|<cn>|<lang> for a PaperCard", () => {
    expect(imageKeyForCard(bolt)).toBe("c:Lightning Bolt|LEA|161|en");
  });

  it("produces t:<name> for a token", () => {
    expect(imageKeyForToken("Goblin")).toBe("t:Goblin");
  });
});
