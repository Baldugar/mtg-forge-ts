// SPDX-License-Identifier: GPL-3.0-or-later
// ReplacementHandlerRegistry — singleton that maps eventKind strings to their
// concrete ReplacementHandler constructor. Mirrors triggerHandlerRegistry /
// effectRegistry in the same package.
import type { ReplacementHandler } from "./replacement-handler.js";

/** Constructor interface for ReplacementHandler subclasses. */
export interface ReplacementHandlerCtor {
  readonly eventKind: string;
  new (): ReplacementHandler;
}

class ReplacementHandlerRegistry {
  private readonly byEventKind = new Map<string, ReplacementHandlerCtor>();

  /**
   * Register a concrete ReplacementHandler subclass.
   * Throws if the class has an empty eventKind string (defence against
   * copy-paste errors where the subclass forgets to declare
   * `static override readonly eventKind`).
   */
  register(cls: ReplacementHandlerCtor): void {
    if (!cls.eventKind) throw new Error("ReplacementHandlerRegistry.register: eventKind must be non-empty");
    this.byEventKind.set(cls.eventKind, cls);
  }

  /** Look up a handler constructor by eventKind string. Returns undefined if not registered. */
  lookup(kind: string): ReplacementHandlerCtor | undefined {
    return this.byEventKind.get(kind);
  }

  /** Returns true if the given eventKind has a registered handler. */
  has(kind: string): boolean {
    return this.byEventKind.has(kind);
  }

  /** Test-only: clear all registrations so tests can start fresh. */
  clear(): void {
    this.byEventKind.clear();
  }
}

export const replacementHandlerRegistry = new ReplacementHandlerRegistry();
