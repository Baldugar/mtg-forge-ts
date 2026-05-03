// SPDX-License-Identifier: GPL-3.0-or-later
//
// Web Worker that hosts the @mtg-forge-ts/cards parser. Importing the engine
// packages here proves they are bundleable (and run) in a non-Node, ESM
// browser worker context without pulling in node:fs / node:path.

import { parseCard } from "@mtg-forge-ts/cards";
import type { CardDefinition, ColorSet } from "@mtg-forge-ts/core";
import { Color } from "@mtg-forge-ts/core";

import type { CardSummary, ParseRequest, WorkerResponse } from "./protocol.js";

// Vite emits this worker as an ES module (worker.format = 'es' in
// vite.config.ts), so the standard DedicatedWorkerGlobalScope API applies.
const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener("message", (event: MessageEvent<ParseRequest>) => {
  const req = event.data;
  if (req?.type !== "parse") {
    // Unknown messages are ignored — keeps the contract loose so consumers
    // can extend the protocol without breaking older workers.
    return;
  }
  try {
    const card = parseCard(req.source, req.file);
    const response: WorkerResponse = {
      type: "parse:ok",
      id: req.id,
      summary: summarize(card),
    };
    ctx.postMessage(response);
  } catch (err) {
    const response: WorkerResponse = {
      type: "parse:err",
      id: req.id,
      message: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(response);
  }
});

function summarize(card: CardDefinition): CardSummary {
  return {
    name: card.name,
    typeLine: formatTypeLine(card.types),
    manaCost: formatManaCost(card.manaCost),
    power: card.pt?.power ?? null,
    toughness: card.pt?.toughness ?? null,
    loyalty: card.loyalty ?? null,
    defense: card.defense ?? null,
    colors: formatColors(card.colors),
    counts: {
      abilities: card.abilities.length,
      triggers: card.triggers.length,
      replacements: card.replacements.length,
      statics: card.statics.length,
      keywords: card.keywords.length,
      svars: card.svars.size,
    },
    oracle: card.oracle,
  };
}

function formatTypeLine(t: CardDefinition["types"]): string {
  const left = [...t.supertypes, ...t.types].join(" ");
  const right = t.subtypes.length > 0 ? ` — ${t.subtypes.join(" ")}` : "";
  return `${left}${right}`;
}

function formatManaCost(mc: CardDefinition["manaCost"]): string {
  if (mc === null) return "(none)";
  if (typeof mc === "object" && mc !== null && "raw" in mc) {
    const raw = (mc as { raw: unknown }).raw;
    if (typeof raw === "string") return raw;
  }
  return JSON.stringify(mc);
}

function formatColors(colors: ColorSet | undefined): string {
  if (colors === undefined) return "(none)";
  const letters: string[] = [];
  if (colors.has(Color.White)) letters.push("W");
  if (colors.has(Color.Blue)) letters.push("U");
  if (colors.has(Color.Black)) letters.push("B");
  if (colors.has(Color.Red)) letters.push("R");
  if (colors.has(Color.Green)) letters.push("G");
  return letters.length === 0 ? "Colorless" : letters.join("");
}
