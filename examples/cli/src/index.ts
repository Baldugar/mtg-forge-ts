#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
//
// mtg-forge-ts-cli — reference CLI consumer for downstream developers.
//
// Demonstrates the public surface of the @mtg-forge-ts packages by:
//   1. parsing a Forge .txt card script via parseCard() from @mtg-forge-ts/cards
//      and printing a structured summary of the resulting AST,
//   2. reading a deck JSON file and running validateDeck() against a chosen
//      sanctioned format, then printing the legality verdict + violations,
//   3. constructing a minimal Game instance from @mtg-forge-ts/game so
//      consumers can see how the lobby/rules/meta/Rng wiring fits together.
//
// This package is `private: true` and lives under examples/. It is not
// published to npm — copy and adapt freely.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCard, validateDeck } from "@mtg-forge-ts/cards";
import type { DeckEntry, FormatId } from "@mtg-forge-ts/cards";
import type { CardDefinition, ColorSet } from "@mtg-forge-ts/core";
import { Color, SeededRng } from "@mtg-forge-ts/core";
import { GAME_VERSION, Game } from "@mtg-forge-ts/game";

// ---------------------------------------------------------------------------
// usage / dispatch
// ---------------------------------------------------------------------------

const USAGE = `mtg-forge-ts-cli — reference CLI for @mtg-forge-ts

Usage:
  mtg-forge-ts-cli parse <card.txt>
  mtg-forge-ts-cli validate-deck <deck.json> <format>
  mtg-forge-ts-cli demo-game

Commands:
  parse           Parse a Forge .txt card script and print the AST summary.
  validate-deck   Validate a deck JSON against a sanctioned format. Format is
                  one of: standard, modern, legacy, vintage, pioneer, pauper,
                  commander.
  demo-game       Build a minimal 2-player Game instance and print its meta.
`;

function main(argv: readonly string[]): number {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "parse":
      return runParse(rest);
    case "validate-deck":
      return runValidateDeck(rest);
    case "demo-game":
      return runDemoGame();
    case undefined:
    case "-h":
    case "--help":
    case "help":
      process.stdout.write(USAGE);
      return 0;
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n${USAGE}`);
      return 2;
  }
}

// ---------------------------------------------------------------------------
// `parse <card.txt>`
// ---------------------------------------------------------------------------

function runParse(args: readonly string[]): number {
  const file = args[0];
  if (file === undefined) {
    process.stderr.write("parse: missing <card.txt>\n");
    return 2;
  }
  const abs = resolve(process.cwd(), file);
  const source = readFileSync(abs, "utf8");
  const card = parseCard(source, abs);

  process.stdout.write(`Parsed: ${abs}\n`);
  printCardSummary(card, "");
  if (card.faces && card.faces.length > 0) {
    process.stdout.write("\nAlternate faces:\n");
    card.faces.forEach((face, idx) => {
      process.stdout.write(`  Face ${idx + 1}:\n`);
      printCardSummary(face, "    ");
    });
  }
  return 0;
}

function printCardSummary(card: CardDefinition, indent: string): void {
  const out = process.stdout;
  out.write(`${indent}Name:         ${card.name}\n`);
  out.write(`${indent}Types:        ${formatTypeLine(card.types)}\n`);
  out.write(`${indent}Mana cost:    ${formatManaCost(card.manaCost)}\n`);
  if (card.pt) {
    out.write(`${indent}Power/Tough:  ${card.pt.power}/${card.pt.toughness}\n`);
  }
  if (card.loyalty !== undefined) {
    out.write(`${indent}Loyalty:      ${card.loyalty}\n`);
  }
  if (card.defense !== undefined) {
    out.write(`${indent}Defense:      ${card.defense}\n`);
  }
  if (card.colors !== undefined) {
    out.write(`${indent}Colors:       ${formatColors(card.colors)}\n`);
  }
  out.write(`${indent}Abilities:    ${card.abilities.length}\n`);
  out.write(`${indent}Triggers:     ${card.triggers.length}\n`);
  out.write(`${indent}Replacements: ${card.replacements.length}\n`);
  out.write(`${indent}Statics:      ${card.statics.length}\n`);
  out.write(`${indent}Keywords:     ${card.keywords.length}\n`);
  out.write(`${indent}SVars:        ${card.svars.size}\n`);
  if (card.oracle.length > 0) {
    out.write(`${indent}Oracle:       ${card.oracle}\n`);
  }
}

// TypeLine.toString() format: "Legendary Creature — Human Wizard". We rebuild
// it inline so the example doesn't depend on TypeLine's internals.
function formatTypeLine(t: CardDefinition["types"]): string {
  const left = [...t.supertypes, ...t.types].join(" ");
  const right = t.subtypes.length > 0 ? ` — ${t.subtypes.join(" ")}` : "";
  return `${left}${right}`;
}

function formatManaCost(mc: CardDefinition["manaCost"]): string {
  if (mc === null) return "(none)";
  // ManaCostAst carries `raw` (the original DSL token) and a `symbols` array.
  // We narrow defensively because manaCost is typed as `unknown | null` on
  // CardDefinition (the AST shape lives in @mtg-forge-ts/core).
  if (typeof mc === "object" && mc !== null && "raw" in mc) {
    const raw = (mc as { raw: unknown }).raw;
    if (typeof raw === "string") return raw;
  }
  return JSON.stringify(mc);
}

function formatColors(colors: ColorSet | undefined): string {
  if (colors === undefined) return "(none)";
  // ColorSet has no iterator; query each color flag explicitly. WUBRG order
  // mirrors Forge's canonical color presentation.
  const letters: string[] = [];
  if (colors.has(Color.White)) letters.push("W");
  if (colors.has(Color.Blue)) letters.push("U");
  if (colors.has(Color.Black)) letters.push("B");
  if (colors.has(Color.Red)) letters.push("R");
  if (colors.has(Color.Green)) letters.push("G");
  return letters.length === 0 ? "Colorless" : letters.join("");
}

// ---------------------------------------------------------------------------
// `validate-deck <deck.json> <format>`
// ---------------------------------------------------------------------------

const VALID_FORMATS: readonly FormatId[] = [
  "standard",
  "modern",
  "legacy",
  "vintage",
  "pioneer",
  "pauper",
  "commander",
];

function runValidateDeck(args: readonly string[]): number {
  const [file, fmt] = args;
  if (file === undefined || fmt === undefined) {
    process.stderr.write("validate-deck: usage: validate-deck <deck.json> <format>\n");
    return 2;
  }
  if (!isFormatId(fmt)) {
    process.stderr.write(`validate-deck: unknown format '${fmt}'. Valid: ${VALID_FORMATS.join(", ")}\n`);
    return 2;
  }
  const abs = resolve(process.cwd(), file);
  const raw = readFileSync(abs, "utf8");
  const parsed: unknown = JSON.parse(raw);
  const deck = coerceDeck(parsed);

  const result = validateDeck(deck, fmt);
  const out = process.stdout;
  out.write(`Deck:    ${abs}\n`);
  out.write(`Format:  ${fmt}\n`);
  out.write(`Status:  ${result.legal ? "LEGAL" : "ILLEGAL"}\n`);
  if (result.violations.length > 0) {
    out.write("Violations:\n");
    for (const v of result.violations) {
      out.write(`  - ${v}\n`);
    }
  }
  return result.legal ? 0 : 1;
}

function isFormatId(s: string): s is FormatId {
  return (VALID_FORMATS as readonly string[]).includes(s);
}

// Accept either a bare DeckEntry[] or a `{ entries: DeckEntry[] }` wrapper so
// downstream consumers can pick whichever JSON shape suits them.
function coerceDeck(input: unknown): DeckEntry[] {
  if (Array.isArray(input)) return input as DeckEntry[];
  if (typeof input === "object" && input !== null && "entries" in input) {
    const entries = (input as { entries: unknown }).entries;
    if (Array.isArray(entries)) return entries as DeckEntry[];
  }
  throw new Error("Deck JSON must be a DeckEntry[] or { entries: DeckEntry[] }.");
}

// ---------------------------------------------------------------------------
// `demo-game` — minimal Game construction
// ---------------------------------------------------------------------------

function runDemoGame(): number {
  // A Game needs four things: lobby participants, GameRules, GameMeta, and an
  // Rng. None of these depend on the cards package — the engine and the card
  // DSL are intentionally decoupled at the type level.
  const game = new Game({
    lobbyPlayers: [
      { id: "alice", name: "Alice", controllerKind: "human" },
      { id: "bob", name: "Bob", controllerKind: "ai" },
    ],
    rules: {
      formatId: "modern",
      startingLife: 20,
      startingHandSize: 7,
      mulliganRule: "london",
      firstPlayerSkipsDraw: true,
      ruleOverrides: [],
      playerCount: { min: 2, max: 2 },
      poisonCountersToLose: 10,
      playForAnte: false,
      manaBurn: false,
      gamesPerMatch: 3,
      gamesToWinMatch: 2,
      appliedVariants: [],
    },
    meta: {
      engineVersion: GAME_VERSION,
      forgeSha: "unknown",
      cardDataSyncedAt: "1970-01-01T00:00:00Z",
      crVersion: "unknown",
      seed: "0x2a",
    },
    rng: new SeededRng(0x2an),
  });

  const out = process.stdout;
  out.write("Constructed Game:\n");
  out.write(`  engine version: ${game.meta.engineVersion}\n`);
  out.write(`  format:         ${game.rules.formatId}\n`);
  out.write(`  players:        ${game.players.length}\n`);
  for (const p of game.players) {
    const seat = p.seat as unknown as number;
    const { name, controllerKind } = p.lobbyPlayer;
    out.write(`    seat ${seat}: ${name} (${controllerKind})\n`);
  }
  out.write(`  turn:           ${game.turn}\n`);
  out.write(`  phase:          ${game.phase}\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

const exitCode = main(process.argv.slice(2));
process.exit(exitCode);
