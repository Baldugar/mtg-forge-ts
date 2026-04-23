// SPDX-License-Identifier: GPL-3.0-or-later
declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

export type EntityId = Brand<number, "EntityId">;
export type DecisionId = Brand<number, "DecisionId">;
export type PlayerSeat = Brand<number, "PlayerSeat">;

export const mkEntityId = (n: number): EntityId => {
  // WHY: validates at the branded constructor so wire-format deserializers
  // (ManaProduced.fromJSON, future Card/Entity loaders) fail loud on bad data.
  if (!Number.isInteger(n) || n < 0)
    throw new RangeError(`EntityId must be a non-negative integer, got ${n}`);
  return n as EntityId;
};
export const mkDecisionId = (n: number): DecisionId => {
  if (!Number.isInteger(n) || n < 0)
    throw new RangeError(`DecisionId must be a non-negative integer, got ${n}`);
  return n as DecisionId;
};
export const mkPlayerSeat = (n: number): PlayerSeat => {
  if (!Number.isInteger(n) || n < 0)
    throw new RangeError(`PlayerSeat must be a non-negative integer, got ${n}`);
  return n as PlayerSeat;
};
