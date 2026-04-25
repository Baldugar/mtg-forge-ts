// SPDX-License-Identifier: GPL-3.0-or-later
// TriggerHandlerRegistry — singleton that maps trigger mode strings to their
// concrete TriggerHandler constructor. Mirrors effectRegistry / costRegistry
// in the same package.
import type { TriggerHandler } from "./trigger-handler.js";

/** Constructor interface for TriggerHandler subclasses. */
export interface TriggerHandlerCtor {
  readonly mode: string;
  new (): TriggerHandler;
}

class TriggerHandlerRegistry {
  private readonly byMode = new Map<string, TriggerHandlerCtor>();

  /**
   * Register a concrete TriggerHandler subclass.
   * Throws if the class has an empty mode string (defence against copy-paste
   * errors where the subclass forgets to declare `static override readonly mode`).
   */
  register(cls: TriggerHandlerCtor): void {
    if (!cls.mode) throw new Error("TriggerHandlerRegistry.register: mode must be non-empty");
    this.byMode.set(cls.mode, cls);
  }

  /** Look up a handler constructor by mode string. Returns undefined if not registered. */
  lookup(mode: string): TriggerHandlerCtor | undefined {
    return this.byMode.get(mode);
  }

  /** Returns true if the given mode has a registered handler. */
  has(mode: string): boolean {
    return this.byMode.has(mode);
  }

  /** Test-only: clear all registrations so tests can start fresh. */
  clear(): void {
    this.byMode.clear();
  }
}

export const triggerHandlerRegistry = new TriggerHandlerRegistry();
