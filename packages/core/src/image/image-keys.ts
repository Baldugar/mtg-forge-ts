// SPDX-License-Identifier: GPL-3.0-or-later
// Ported verbatim from Forge's forge.ImageKeys (all public static String
// constants). Forge uses these as prefixes/suffixes on cache keys so the
// image layer can route each asset kind to its subdirectory. Names are
// mapped from Java's `X_PREFIX` to TS-idiomatic `PREFIX_X` to match the plan;
// string values are identical so cross-language keys interoperate.
//
// Source: F:/BACKUP/Programacion/forge/forge-core/src/main/java/forge/ImageKeys.java

import type { PaperCard } from "../card/paper-card.js";

// Prefixes — Forge's *_PREFIX constants, single-char mnemonics + colon.
export const PREFIX_CARD = "c:";
export const PREFIX_TOKEN = "t:";
export const PREFIX_ICON = "i:";
export const PREFIX_BOOSTER = "b:";
export const PREFIX_FATPACK = "f:";
export const PREFIX_BOOSTERBOX = "x:";
export const PREFIX_PRECON = "p:";
export const PREFIX_TOURNAMENTPACK = "o:";
export const PREFIX_ADVENTURECARD = "a:";

// Synthetic card image names (Forge uses these when a real printing image is
// unavailable — face-down morphs, revealed hidden cards, etc.).
export const HIDDEN_CARD = "hidden";
export const MORPH_IMAGE = "morph";
export const MANIFEST_IMAGE = "manifest";
export const CLOAKED_IMAGE = "cloaked";
export const FORETELL_IMAGE = "foretell";
export const BLESSING_IMAGE = "blessing";
export const INITIATIVE_IMAGE = "initiative";
export const MONARCH_IMAGE = "monarch";
export const THE_RING_IMAGE = "the_ring";
export const RADIATION_IMAGE = "radiation";
export const SPEED_IMAGE = "speed";
export const MAX_SPEED_IMAGE = "max_speed";
export const ADVENTURE_IMAGE = "adventure";

// Face postfixes — appended to a base key to select an alternate face.
export const BACKFACE_POSTFIX = "$alt";
export const SPECFACE_W = "$wspec";
export const SPECFACE_U = "$uspec";
export const SPECFACE_B = "$bspec";
export const SPECFACE_R = "$rspec";
export const SPECFACE_G = "$gspec";

/**
 * Deterministic image-cache key for a PaperCard. Matches Forge's
 * ImageUtil.getImageKey output format for the case `includeSet=true,
 * includeLang=true`. Exposed as a pure function so callers can derive keys
 * without the cache directory layer.
 */
export const imageKeyForCard = (p: PaperCard): string =>
  `${PREFIX_CARD}${p.name}|${p.edition}|${p.collectorNumber}|${p.language}`;

/** Same as imageKeyForCard but for token entries (Forge: TOKEN_PREFIX + name). */
export const imageKeyForToken = (tokenName: string): string => `${PREFIX_TOKEN}${tokenName}`;
