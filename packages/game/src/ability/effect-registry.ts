// SPDX-License-Identifier: GPL-3.0-or-later
import type { SpellAbilityEffect } from "./spell-ability-effect.js";

export interface EffectCtor {
  readonly handlerKey: string;
  new (): SpellAbilityEffect;
}

class EffectRegistry {
  private readonly byKey = new Map<string, EffectCtor>();
  register(cls: EffectCtor): void {
    if (!cls.handlerKey) throw new Error("EffectRegistry.register: handlerKey empty");
    this.byKey.set(cls.handlerKey, cls);
  }
  lookup(key: string): EffectCtor | undefined {
    return this.byKey.get(key);
  }
  has(key: string): boolean {
    return this.byKey.has(key);
  }
  clear(): void {
    this.byKey.clear();
  }
}

export const effectRegistry = new EffectRegistry();
