// SPDX-License-Identifier: GPL-3.0-or-later
// KeywordHandlerRegistry — singleton that maps KeywordId strings to their
// concrete KeywordHandler constructor. Supports an optional fallback ("*")
// handler that matches any keyword not explicitly registered.
//
// Mirrors triggerHandlerRegistry / replacementHandlerRegistry in the same
// package.
import type { KeywordId } from "@mtg-forge-ts/core";
import type { KeywordHandler } from "./keyword-handler.js";

/** Constructor interface for KeywordHandler subclasses. */
export interface KeywordHandlerCtor {
  readonly keyword: string;
  new (): KeywordHandler;
}

class KeywordHandlerRegistry {
  private readonly byKeyword = new Map<string, KeywordHandlerCtor>();
  private fallback: KeywordHandlerCtor | null = null;

  /**
   * Register a concrete KeywordHandler subclass.
   *
   * If `cls.keyword === "*"` the class is registered as the catchall fallback;
   * it will be returned by `lookup()` for any keyword that has no specific
   * handler. At most one fallback may be active; later registrations overwrite.
   *
   * Throws if `cls.keyword` is the empty string (defence against copy-paste
   * errors where the subclass forgets to declare `static override readonly keyword`).
   */
  register(cls: KeywordHandlerCtor): void {
    if (cls.keyword === "") {
      throw new Error("KeywordHandlerRegistry.register: keyword must be non-empty");
    }
    if (cls.keyword === "*") {
      this.fallback = cls;
    } else {
      this.byKeyword.set(cls.keyword, cls);
    }
  }

  /**
   * Look up a handler constructor by KeywordId.
   * Returns the specific handler if registered, the fallback if one exists,
   * or `undefined` if neither is available.
   */
  lookup(keyword: KeywordId): KeywordHandlerCtor | undefined {
    return this.byKeyword.get(keyword) ?? this.fallback ?? undefined;
  }

  /**
   * Returns true if the given keyword has a registered handler OR if a
   * fallback ("*") handler is present.
   */
  has(keyword: KeywordId): boolean {
    return this.byKeyword.has(keyword) || this.fallback !== null;
  }

  /** Test-only: clear all registrations so tests can start fresh. */
  clear(): void {
    this.byKeyword.clear();
    this.fallback = null;
  }
}

export const keywordHandlerRegistry = new KeywordHandlerRegistry();
