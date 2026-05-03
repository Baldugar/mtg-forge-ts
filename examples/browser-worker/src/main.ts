// SPDX-License-Identifier: GPL-3.0-or-later
//
// Main thread for the browser-worker reference consumer. Spawns a single
// long-lived parser worker, wires the textarea + button to postMessage,
// and renders the worker's reply into #result.
//
// We also import GAME_VERSION on the main thread to demonstrate that
// @mtg-forge-ts/game is browser-loadable too — the engine entry point ships
// no node-only side effects.

import { GAME_VERSION } from "@mtg-forge-ts/game";

import type { ParseRequest, WorkerResponse } from "./protocol.js";

const SAMPLE_CARD = `Name:Lightning Bolt
ManaCost:R
Types:Instant
A:SP$ DealDamage | Cost$ R | NumDmg$ 3 | ValidTgts$ Any | SpellDescription$ CARDNAME deals 3 damage to any target.
Oracle:Lightning Bolt deals 3 damage to any target.
`;

const input = requireEl<HTMLTextAreaElement>("card-input");
const button = requireEl<HTMLButtonElement>("parse-btn");
const status = requireEl<HTMLDivElement>("status");
const result = requireEl<HTMLPreElement>("result");

input.value = SAMPLE_CARD;
status.textContent = `Engine: ${GAME_VERSION}. Worker: starting...`;

// `new URL('./worker.ts', import.meta.url)` is the Vite-recommended pattern
// for spawning a module worker — Vite (and Rollup) detect this exact form
// and emit a separate worker chunk into dist/assets at build time.
const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
  name: "mtg-forge-ts-parser",
});

let nextId = 1;
const pending = new Map<number, (r: WorkerResponse) => void>();

worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
  const response = event.data;
  const resolver = pending.get(response.id);
  if (resolver !== undefined) {
    pending.delete(response.id);
    resolver(response);
  }
});

worker.addEventListener("error", (event) => {
  status.textContent = `Worker error: ${event.message}`;
});

status.textContent = `Engine: ${GAME_VERSION}. Worker: ready.`;

button.addEventListener("click", () => {
  void parseInWorker(input.value);
});

async function parseInWorker(source: string): Promise<void> {
  const id = nextId++;
  const req: ParseRequest = {
    type: "parse",
    id,
    source,
    file: `inline-${id}.txt`,
  };
  status.textContent = `Engine: ${GAME_VERSION}. Worker: parsing #${id}...`;
  result.textContent = "";

  const response = await new Promise<WorkerResponse>((resolve) => {
    pending.set(id, resolve);
    worker.postMessage(req);
  });

  if (response.type === "parse:ok") {
    status.textContent = `Engine: ${GAME_VERSION}. Worker: parsed #${id} ok.`;
    result.textContent = JSON.stringify(response.summary, null, 2);
  } else {
    status.textContent = `Engine: ${GAME_VERSION}. Worker: parse #${id} failed.`;
    result.textContent = `Error: ${response.message}`;
  }
}

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) {
    throw new Error(`Missing #${id} in DOM.`);
  }
  return el as T;
}
