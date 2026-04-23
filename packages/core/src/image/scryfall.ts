// SPDX-License-Identifier: GPL-3.0-or-later
// Scryfall image URL builders, ported from Forge's
// forge.util.ImageUtil.getScryfallDownloadUrl plus the URL_PIC_SCRYFALL_DOWNLOAD
// constant in forge.localinstance.properties.ForgeConstants.
//
// Forge URL shape:
//   https://api.scryfall.com/cards/<setCode>/<collectorNumberURLEncoded>/<langCode>
//     ?format=image&version=<normal|art_crop>[&face=front|back]
//
// Forge's builder takes an explicit PaperCard + setCode override + langCode +
// useArtCrop flag, and derives faceParam from the card's CardSplitType. Our
// SP1 port reproduces the URL shape using the PaperCard fields available in
// core; split-type-aware meld / specialize adjustments are stubbed at the
// simple "front/back" level and deferred to SP2 when CardDefinition's split-
// type surface lands in the cards package.
//
// Sources:
//   - F:/BACKUP/Programacion/forge/forge-core/src/main/java/forge/util/ImageUtil.java
//       (getScryfallDownloadUrl, lines 209-279)
//   - F:/BACKUP/Programacion/forge/forge-gui/src/main/java/forge/localinstance/properties/ForgeConstants.java
//       (URL_PIC_SCRYFALL_DOWNLOAD = URL_SCRYFALL + "/cards/")

import type { PaperCard } from "../card/paper-card.js";
import { UnknownCardError } from "../errors.js";

/** Forge: URL_SCRYFALL + "/cards/". */
export const SCRYFALL_BASE = "https://api.scryfall.com/cards";

export type ScryfallFace = "front" | "back";
export type ScryfallCrop = "small" | "normal" | "large" | "png" | "art_crop" | "border_crop";

export interface ScryfallUrlOptions {
  readonly face?: ScryfallFace;
  readonly crop?: ScryfallCrop;
  readonly lang?: string;
}

// Forge's funny-card collector-number pattern: F123 → 123. Matches
// `^F\d+`. Kept private so callers get the adjusted number transparently.
const FUNNY_COLLECTOR = /^F\d+/;

// Forge planechase-setcode overrides: cards whose collector number carries a
// legacy prefix moved under a different Scryfall edition code.
const PLANECHASE_OVERRIDES: readonly { readonly prefix: string; readonly code: string }[] = [
  { prefix: "OHOP", code: "ohop" },
  { prefix: "OPCA", code: "opca" },
  { prefix: "OPC2", code: "opc2" },
];

/**
 * Build the Scryfall image URL for a PaperCard. Requires `p.scryfallId` to
 * be absent-or-present depending on whether Scryfall's UUID-based endpoint
 * or set+collector-number endpoint is desired; Forge uses set+collector so
 * we do too. If neither setcode nor collector number is available, throws
 * UnknownCardError.
 */
export const scryfallImageUrl = (p: PaperCard, opts: ScryfallUrlOptions = {}): string => {
  if (!p.set || !p.collectorNumber) {
    // Scryfall needs SOMETHING to identify the printing. Forge's builder
    // also assumes these are present (NullPointerException otherwise); we
    // raise a typed error so callers can catch-and-recover.
    throw new UnknownCardError(p.name ?? "<unnamed>");
  }
  const face: ScryfallFace = opts.face ?? "front";
  const crop: ScryfallCrop = opts.crop ?? "normal";
  const lang = opts.lang ?? p.language;
  let editionCode = p.set.toLowerCase();
  let collector = p.collectorNumber;

  // Planechase setcode overrides — identical to Forge.
  for (const { prefix, code } of PLANECHASE_OVERRIDES) {
    if (collector.startsWith(prefix)) {
      editionCode = code;
      collector = collector.substring(prefix.length);
      break;
    }
  }

  // Funny-card numbering: Scryfall drops the "F" prefix for Unstable etc.
  if (FUNNY_COLLECTOR.test(collector)) {
    collector = collector.substring(1);
  }

  // Flipped-back marker "☇" (U+2607): forces face=back on Scryfall.
  let effectiveFace: ScryfallFace = face;
  if (collector.endsWith("☇")) {
    effectiveFace = "back";
    collector = collector.substring(0, collector.length - 1);
  }

  const faceParam = effectiveFace === "back" ? "&face=back" : "";
  const encodedCollector = encodeURIComponent(collector);
  return `${SCRYFALL_BASE}/${editionCode}/${encodedCollector}/${lang}?format=image&version=${crop}${faceParam}`;
};

/**
 * Token variant — Forge's getScryfallTokenDownloadUrl. Uses the same
 * endpoint shape but with a caller-provided setCode + collectorNumber
 * instead of a PaperCard (tokens aren't first-class PaperCards in Forge).
 */
export const scryfallTokenImageUrl = (
  setCode: string,
  collectorNumber: string,
  langCode: string,
  face: ScryfallFace = "front",
): string => {
  let collector = collectorNumber;
  let effectiveFace: ScryfallFace = face;
  if (collector.endsWith("☇")) {
    effectiveFace = "back";
    collector = collector.substring(0, collector.length - 1);
  }
  const faceParam = effectiveFace === "back" ? "&face=back" : "";
  const encodedCollector = encodeURIComponent(collector);
  return `${SCRYFALL_BASE}/${setCode.toLowerCase()}/${encodedCollector}/${langCode}?format=image&version=normal${faceParam}`;
};
