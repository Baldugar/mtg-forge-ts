// SPDX-License-Identifier: GPL-3.0-or-later
//
// Forge `.dck` deck-format loader.
//
// The `.dck` format is the on-disk representation Forge uses for every deck
// shipped with the game (precons, AI quest decks, adventure-mode encounters,
// starter commander decks, etc.). It is a small INI-flavoured text format:
//
//   [metadata]
//   Name=Akroma
//   [Main]
//   2 Akroma's Memorial|TSR|1
//   4 Akroma's Vengeance|C20|1
//   ...
//   [Sideboard]
//   2 Some Card
//   [Commander]
//   1 Tymaret, Chosen from Death|THB|1
//
// Section headers are bracketed identifiers, case-insensitive. Card lines are
// `<count> <name>` optionally followed by `|<set>|<art-index>` (and possibly
// further `|...|` fields that we ignore — Forge tacks on art-index, foil flag,
// etc.). Comments begin with `#` or `//` and are stripped. Blank lines are
// ignored. Forge also writes empty section blocks like `[Avatar]` /
// `[Planes]` / `[Schemes]` / `[Conspiracy]` / `[Dungeon]` — we tolerate any
// section name and silently drop entries we don't model.
//
// Reference: Forge's `DeckFileHeader` / `DeckSerializer` /
// `DeckRecognizer` (see Card-Forge/forge `forge-game/src/main/java/forge/deck`).
//
// The output `Deck` value is shaped to feed straight into `validateDeck()`
// from `./legality.ts`: each `DeckEntry` carries `name`, `count`, plus the
// optional `set` hint and (for the commander section) the `commander` flag.

import type { DeckEntry as LegalityDeckEntry } from "./legality.js";

/**
 * A single parsed line from a `.dck` file.
 *
 * Compatible with `DeckEntry` from `./legality.ts` — the parser returns
 * entries that can be passed directly into `validateDeck()`.
 */
export type DeckEntry = LegalityDeckEntry;

/**
 * A deck loaded from `.dck` format.
 *
 * - `name` mirrors `[metadata] Name=...` when present.
 * - `main` always exists; empty array if the file has no `[Main]` cards.
 * - `sideboard` and `commander` are populated only when the corresponding
 *   sections appear and contain at least one card.
 *
 * The shape is deliberately friendly to `validateDeck()`: callers can flatten
 * `[...deck.main, ...deck.sideboard?.map(s => ({...s, sideboard: true}))]`
 * to feed the legality validator, or pass `deck.main` straight in for a
 * mainboard-only check.
 */
export interface Deck {
  name?: string;
  main: DeckEntry[];
  sideboard?: DeckEntry[];
  commander?: DeckEntry[];
}

/**
 * Recognised Forge section names whose contents we want to surface on the
 * returned `Deck`. Any other section (e.g. `[Avatar]`, `[Planes]`,
 * `[Schemes]`, `[Conspiracy]`, `[Dungeon]`, `[Attractions]`,
 * `[Contraptions]`) is parsed but its entries are discarded.
 */
type KnownSection = "metadata" | "main" | "sideboard" | "commander";

/** Map a section header (case-insensitive) to its kind, or "ignored". */
function classifySection(header: string): KnownSection | "ignored" {
  const lower = header.trim().toLowerCase();
  if (lower === "metadata") return "metadata";
  if (lower === "main" || lower === "mainboard" || lower === "deck") return "main";
  if (lower === "sideboard" || lower === "side") return "sideboard";
  if (lower === "commander" || lower === "commanders") return "commander";
  return "ignored";
}

/**
 * Strip a leading comment marker (`#` or `//`) from a line. Forge's own
 * writer never emits these, but third-party deck files (and the manual
 * "import from clipboard" path) commonly include them, and our tests
 * exercise both forms.
 */
function stripComment(line: string): string {
  // `#` anywhere starts a line comment in INI tradition; `//` only when at
  // the start so we don't mangle card names with literal slashes
  // (split-cards use `//`, e.g. "Fire // Ice").
  const trimmed = line.trimStart();
  if (trimmed.startsWith("//")) return "";
  const hashIdx = line.indexOf("#");
  if (hashIdx >= 0) return line.slice(0, hashIdx);
  return line;
}

/** Parse a single card line: `"4 Lightning Bolt|MIR|1"` -> entry, or null. */
function parseCardLine(line: string): { count: number; name: string; set?: string } | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  // Match: leading integer, then whitespace, then the rest of the line.
  // We don't allow signed counts; Forge always writes a positive integer.
  const match = /^(\d+)\s+(.+)$/.exec(trimmed);
  if (!match) return null;
  const [, countStr, restRaw] = match;
  if (countStr === undefined || restRaw === undefined) return null;
  const count = Number.parseInt(countStr, 10);
  if (!Number.isFinite(count) || count <= 0) return null;
  const rest = restRaw.trim();
  // Split on `|` — first segment is the card name, second (if any) is the
  // set code, remaining segments (art index, foil flag, etc.) are ignored.
  const parts = rest.split("|");
  const name = (parts[0] ?? "").trim();
  if (name.length === 0) return null;
  const setRaw = parts[1]?.trim();
  const set = setRaw && setRaw.length > 0 ? setRaw : undefined;
  return set !== undefined ? { count, name, set } : { count, name };
}

/**
 * Parse a Forge `.dck` deck-list and return a structured `Deck`.
 *
 * Tolerant of:
 *   - Windows / Unix / mixed line endings.
 *   - BOM at the start of the file.
 *   - Blank lines and full-line comments (`#`, `//`).
 *   - Unknown section headers (silently ignored).
 *   - `[metadata]` keys other than `Name` (silently ignored).
 *   - Lines outside any section (treated as if they were in `[Main]`, which
 *     matches Forge's `DeckRecognizer` "no header" recovery behaviour).
 *
 * Throws on no recognisable input — for any file with at least one valid
 * card line we return a `Deck` even if it's structurally weird.
 */
export function parseDck(text: string): Deck {
  const deck: Deck = { main: [] };
  const sideboard: DeckEntry[] = [];
  const commander: DeckEntry[] = [];

  // Strip a UTF-8 BOM if present.
  const cleaned = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  // `\r?\n` would miss bare-`\r` Mac classic files; split on any line break.
  const lines = cleaned.split(/\r\n|\n|\r/);

  // Default to `main` so a header-less file still parses (Forge's recogniser
  // does the same — see `DeckRecognizer.tryParse`).
  let section: KnownSection | "ignored" = "main";

  for (const raw of lines) {
    const line = stripComment(raw).trim();
    if (line.length === 0) continue;

    // Section header? `[Main]`, `[Sideboard]`, `[metadata]`, ...
    if (line.startsWith("[") && line.endsWith("]")) {
      section = classifySection(line.slice(1, -1));
      continue;
    }

    if (section === "metadata") {
      // `Key=Value` lines. Only `Name` is meaningful for now.
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim().toLowerCase();
      const value = line.slice(eq + 1).trim();
      if (key === "name" && value.length > 0) {
        deck.name = value;
      }
      continue;
    }

    if (section === "ignored") continue;

    const card = parseCardLine(line);
    if (card === null) continue;

    if (section === "main") {
      deck.main.push(card);
    } else if (section === "sideboard") {
      sideboard.push(card);
    } else if (section === "commander") {
      // Commander entries get the `commander: true` flag so they're ready
      // for `validateDeck()` in the Commander format without the caller
      // having to remap them.
      commander.push({ ...card, commander: true });
    }
  }

  if (sideboard.length > 0) deck.sideboard = sideboard;
  if (commander.length > 0) deck.commander = commander;

  return deck;
}
