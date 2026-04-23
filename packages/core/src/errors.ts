// SPDX-License-Identifier: GPL-3.0-or-later
// Typed error hierarchy for mtg-forge-ts. Every engine-surface error extends
// ForgeError so hosts can catch-and-classify with a single `instanceof`.
//
// ForgeError sets .name via `new.target.name`, so subclasses do NOT need their
// own name assignment. Subclasses with no extra fields inherit the (message)
// constructor; subclasses with typed payloads (e.g. InvalidDeckError.issues,
// IllegalDecisionError.legalOptions, DeckContainsUnknownCardError.names)
// declare their own constructor.
//
// WHY ES2022 target: `new.target.prototype` handling and `extends Error` work
// natively without the ES5-era Object.setPrototypeOf workaround.

/**
 * Abstract root of the mtg-forge-ts error hierarchy. Concrete subclasses
 * represent engine-surface failures (unknown card, parse error, illegal
 * decision, etc.). Never throw a ForgeError directly — always use a concrete
 * subclass so callers can discriminate.
 */
export abstract class ForgeError extends Error {
  constructor(message: string) {
    super(message);
    // WHY: new.target is the concrete subclass being instantiated; copying its
    // .name onto the instance makes stack traces and log output identify the
    // leaf class rather than the abstract root.
    this.name = new.target.name;
  }
}

/** Thrown when a card name cannot be resolved against the card database. */
export class UnknownCardError extends ForgeError {
  constructor(readonly cardName: string) {
    super(`Unknown card: ${cardName}`);
  }
}

/** Thrown when an AST / effect-handler key cannot be resolved to an implementation. */
export class UnknownHandlerError extends ForgeError {
  constructor(readonly handlerKey: string) {
    super(`Unknown handler: ${handlerKey}`);
  }
}

/**
 * Generic parse error with an optional source location. Concrete parsers
 * (mana, cost, AST) extend this to tag their domain; callers can catch
 * `ParseError` to handle any of them uniformly.
 */
export class ParseError extends ForgeError {
  constructor(
    message: string,
    readonly location?: { file: string; line: number; column: number },
  ) {
    super(message);
  }
}

/** Thrown by the mana-cost parser on invalid input. Carries optional location from ParseError. */
export class ManaParseError extends ParseError {}

/** Card-database schema/shape incompatibility (e.g., JSON row missing required field). */
export class IncompatibleCardDataError extends ForgeError {}

/** On-disk card-DB cache format version mismatch. */
export class IncompatibleCacheFormatError extends ForgeError {}

/** Snapshot was produced by an incompatible engine version. */
export class IncompatibleSnapshotVersionError extends ForgeError {}

/** Deck failed validation. `issues` carries per-rule diagnostics for the UI. */
export class InvalidDeckError extends ForgeError {
  constructor(
    message: string,
    readonly issues: unknown[],
  ) {
    super(message);
  }
}

/** Deck contains card names not present in the active card database. */
export class DeckContainsUnknownCardError extends ForgeError {
  constructor(readonly names: string[]) {
    super(`Deck contains unknown cards: ${names.join(", ")}`);
  }
}

/** Referenced format (Standard, Modern, etc.) is not registered. */
export class UnknownFormatError extends ForgeError {}

/** A rule-override key was requested that was never registered. */
export class UnregisteredRuleOverrideError extends ForgeError {}

/** Game-state invariant violated (zone inconsistency, orphaned reference, etc.). */
export class GameStateIntegrityError extends ForgeError {}

/**
 * Player/controller chose an option outside the legal-options set. `legalOptions`
 * is the set offered at decision-time so callers can report exactly what was
 * allowed versus what was returned.
 */
export class IllegalDecisionError extends ForgeError {
  constructor(
    message: string,
    readonly legalOptions?: unknown[],
  ) {
    super(message);
  }
}

/** Cast attempt violated a casting rule (timing, targets, costs, etc.). */
export class IllegalCastError extends ForgeError {}

/** Snapshot payload failed to restore (corrupt, truncated, post-schema-break). */
export class SnapshotRestoreError extends ForgeError {}

/** Decision-log replay detected a divergence or structural corruption. */
export class DecisionLogCorruptError extends ForgeError {}

/** Referenced AI profile name is not registered. */
export class UnknownAiProfileError extends ForgeError {}

/** AI exceeded its configured per-decision or per-match time budget. */
export class AiTimeBudgetExceededError extends ForgeError {}
