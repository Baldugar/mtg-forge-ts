// SPDX-License-Identifier: GPL-3.0-or-later
// Lexer — raw card .txt → array of LexedLine. Stage 1 of the five-stage
// parser pipeline (lexer → line parsers → AST assembler → resolver →
// CardDefinition). Forge-compatible: \| and \$ escape sequences, #
// comments skipped (but 1-indexed lineNumber preserved), whitespace
// trimmed at token boundaries.

export interface LexedLine {
  readonly lineNumber: number;
  readonly prefix: string;
  readonly content: string;
  readonly tokens: readonly ReadonlyMap<string, string>[];
}

// Unicode control-code sentinels for escape round-trip. Card scripts
// never contain these bytes in practice (Forge's DSL is 7-bit ASCII).
const PIPE_ESCAPE = "\x01";
const DOLLAR_ESCAPE = "\x02";

export const lex = (source: string): readonly LexedLine[] => {
  const lines = source.split(/\r?\n/);
  const out: LexedLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const lineNumber = i + 1;
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const colonIdx = raw.indexOf(":");
    if (colonIdx < 0) {
      throw new Error(`lex: line ${lineNumber}: missing prefix colon`);
    }
    const prefix = raw.slice(0, colonIdx).trim();
    const rest = raw.slice(colonIdx + 1);
    const escaped = rest.replaceAll("\\|", PIPE_ESCAPE).replaceAll("\\$", DOLLAR_ESCAPE);
    const segments = escaped.split("|");
    const tokens: ReadonlyMap<string, string>[] = [];
    // All segments (including segment 0) may be $-keyed tokens.
    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s] ?? "";
      const dollarIdx = seg.indexOf("$");
      if (s === 0 && dollarIdx < 0) {
        // Segment 0 with no $ is free-text content — not a token.
        continue;
      }
      if (dollarIdx < 0) {
        // Tokens without $ are positional flags (rare in Forge scripts —
        // treated as key-only, empty value).
        const key = seg.replaceAll(PIPE_ESCAPE, "|").replaceAll(DOLLAR_ESCAPE, "$").trim();
        if (key !== "") tokens.push(new Map([[key, ""]]));
        continue;
      }
      const key = seg.slice(0, dollarIdx).trim();
      const value = seg
        .slice(dollarIdx + 1)
        .replaceAll(PIPE_ESCAPE, "|")
        .replaceAll(DOLLAR_ESCAPE, "$")
        .trim();
      tokens.push(new Map([[key, value]]));
    }
    out.push({
      lineNumber,
      prefix,
      content: (segments[0] ?? "").replaceAll(PIPE_ESCAPE, "|").replaceAll(DOLLAR_ESCAPE, "$").trim(),
      tokens,
    });
  }
  return out;
};
