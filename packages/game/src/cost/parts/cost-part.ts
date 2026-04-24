// SPDX-License-Identifier: GPL-3.0-or-later
// CostPart — the abstraction for a single atomic payment step (mana, tap,
// life, sacrifice, …). Each concrete CostPart is a singleton value with a
// unique handlerKey. The pay generator yields EngineYield (decisions /
// events) and returns a CostPartReceipt that carries enough state for undo.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";

export interface CostPaymentContext {
  readonly game: Game;
  readonly payerSeat: PlayerSeat;
  readonly sourceCardId: EntityId;
  /** The cost token being paid, e.g. "R", "T", "2 life", "Sac Creature". */
  readonly raw: string;
}

export interface CostPartReceipt {
  readonly handlerKey: string;
  readonly raw: string;
  /** Per-class payload used by undo (mana consumed, tapped card id, life paid, etc.). */
  readonly payload: unknown;
}

export interface CostPart {
  readonly handlerKey: string;
  canPay(ctx: CostPaymentContext): boolean;
  pay(ctx: CostPaymentContext): Generator<EngineYield, CostPartReceipt, unknown>;
  undo(receipt: CostPartReceipt, ctx: CostPaymentContext): void;
}
