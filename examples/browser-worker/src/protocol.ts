// SPDX-License-Identifier: GPL-3.0-or-later
//
// Shared message protocol between the main thread and the parser worker.
// Kept tiny on purpose — the goal of this example is to prove the engine
// loads in a Web Worker context, not to define a real RPC layer.

export interface ParseRequest {
  readonly type: "parse";
  /** Stable id used to correlate request/response pairs. */
  readonly id: number;
  /** Forge `.txt` card script source. */
  readonly source: string;
  /** Synthetic filename used for parser diagnostics. */
  readonly file: string;
}

export interface ParseSuccess {
  readonly type: "parse:ok";
  readonly id: number;
  /**
   * Structured summary of the parsed CardDefinition. We avoid posting the
   * full AST because some nodes (e.g. ManaCostAst) carry symbol-keyed maps
   * which are not structured-clone friendly across the worker boundary in
   * every browser. The summary is enough to demonstrate parsing happened.
   */
  readonly summary: CardSummary;
}

export interface ParseFailure {
  readonly type: "parse:err";
  readonly id: number;
  readonly message: string;
}

export type WorkerResponse = ParseSuccess | ParseFailure;

export interface CardSummary {
  readonly name: string;
  readonly typeLine: string;
  readonly manaCost: string;
  readonly power: string | null;
  readonly toughness: string | null;
  readonly loyalty: string | null;
  readonly defense: string | null;
  readonly colors: string;
  readonly counts: {
    readonly abilities: number;
    readonly triggers: number;
    readonly replacements: number;
    readonly statics: number;
    readonly keywords: number;
    readonly svars: number;
  };
  readonly oracle: string;
}
