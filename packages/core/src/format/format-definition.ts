// SPDX-License-Identifier: GPL-3.0-or-later
// FormatDefinition is the shape-only interface that `@mtg-forge-ts/formats`
// (SP6) populates with concrete format definitions (Standard, Modern, ...).
// Core owns the interface so engine-side code can reference formats without
// depending on the formats package.
//
// Source of truth for this shape: docs/superpowers/specs/
//   2026-04-23-mtg-forge-ts-sp6-formats-legality.md §2.
//
// Every child interface (BanlistHistory, DeckConstructionRules, etc.) is
// declared here because SP6 depends on `@mtg-forge-ts/core`'s FormatDefinition
// having a closed transitive shape — SP6 can extend with concrete data but
// cannot change the core contract.

import type { CardDefinition } from "../card/card-definition.js";
import type { PaperCard } from "../card/paper-card.js";
import type { Rarity } from "../card/types.js";

export type FormatCategory = "constructed" | "limited" | "casual";

/**
 * Strategy tag for how the format's card pool is computed. Kind-specific
 * fields are held on the union variants below rather than on this type.
 */
export type SetLegalityKind = "all-sets" | "set-list" | "sets-as-of-date" | "arena-only" | "custom-predicate";

export type SetLegalityRule =
  | { readonly kind: "all-sets" }
  | { readonly kind: "set-list"; readonly sets: readonly string[] }
  | { readonly kind: "sets-as-of-date"; readonly asOfDate: string }
  | { readonly kind: "arena-only" }
  | { readonly kind: "custom-predicate"; readonly predicateName: string };

/**
 * A card-legality predicate. SP6 passes both the rules-level `CardDefinition`
 * and the printing-level `PaperCard` plus a query date so callers can make
 * release-date-aware decisions. Pure function — no I/O, no engine state.
 */
export type CardPredicate = (card: CardDefinition, print: PaperCard, date: Date) => boolean;

export interface BanlistEntry {
  readonly effectiveDate: string;
  readonly banned: readonly string[];
  readonly restricted?: readonly string[];
  /** Cards unbanned at this date. */
  readonly added?: readonly string[];
}

export interface BanlistHistory {
  /** Sorted by effectiveDate ascending; SP6 enforces this invariant. */
  readonly entries: readonly BanlistEntry[];
}

export type MulliganRule = "london" | "vancouver" | "paris" | "free";

export type CommanderSlotKind = "single" | "partners" | "background" | "oathbreaker" | "pauperCommander";

export interface CommanderSlotSpec {
  readonly kind: CommanderSlotKind;
  readonly colorIdentityEnforced: boolean;
  readonly allowPartners?: boolean;
  readonly allowBackground?: boolean;
  readonly allowFriendsForever?: boolean;
}

export type ExtraZoneKind =
  | "sideboard"
  | "planar"
  | "scheme"
  | "conspiracy"
  | "attractions"
  | "contraptions"
  | "sticker";

export interface DeckConstructionRules {
  readonly minMain: number;
  readonly maxMain?: number;
  readonly maxSideboard: number;
  readonly maxCopiesNonBasic: number;
  readonly mustHaveCommander: boolean;
  readonly commanderSlot?: CommanderSlotSpec;
  readonly extraZones?: readonly ExtraZoneKind[];
  readonly colorIdentityConstraint?: boolean;
  readonly companionAllowed?: boolean;
}

export interface GameRuleModifications {
  readonly startingLife: number;
  readonly startingHandSize: number;
  readonly mulliganRule: MulliganRule;
  readonly firstPlayerSkipsDraw: boolean;
  /** Names of RuleOverrides registered in @mtg-forge-ts/game. */
  readonly ruleOverrides?: readonly string[];
  readonly playerCount?: { readonly min: number; readonly max: number };
}

export type FormatSource = "wotc-official" | "forge" | "custom";

export interface RotationSchedule {
  /** Human-readable policy name (e.g. "annual-fall-three-blocks"). SP6 registers handlers. */
  readonly policy: string;
  /** Parameters consumed by the named policy (e.g. blocks retained). */
  readonly params?: Readonly<Record<string, string | number>>;
}

/**
 * Shape-only interface. SP6 populates concrete definitions in
 * `@mtg-forge-ts/formats/data/formats/*.txt`.
 */
export interface FormatDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly category: FormatCategory;

  readonly setLegality: SetLegalityRule;
  readonly rarityRestriction?: readonly Rarity[];
  readonly cardPredicate?: CardPredicate;

  readonly banlist: BanlistHistory;
  readonly deckConstruction: DeckConstructionRules;
  readonly gameRules: GameRuleModifications;

  readonly source: FormatSource;
  readonly rotationSchedule?: RotationSchedule;
  /** ISO 8601 date string; bumped whenever the format definition changes. */
  readonly lastUpdated: string;
}

/**
 * A FormatDefinition paired with the effective-date for which it is the
 * canonical shape. SP6 returns these from `getFormatAsOf(id, date)` queries.
 */
export interface FormatDefinitionSnapshot {
  readonly format: FormatDefinition;
  readonly validAsOf: string;
}
