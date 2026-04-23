// SPDX-License-Identifier: GPL-3.0-or-later
// Generic key→value registry used as the base for all engine registries
// (triggers, replacements, static effects, effects, keywords, altCosts,
// ruleOverrides). The engine uses small, typed wrappers on top of this so
// consumers get domain-specific classes without duplicating the storage logic.
export class GenericRegistry<T> {
  private readonly map = new Map<string, T>();

  register(key: string, value: T): void {
    this.map.set(key, value);
  }

  get(key: string): T | undefined {
    return this.map.get(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  list(): T[] {
    return [...this.map.values()];
  }

  listKeys(): string[] {
    return [...this.map.keys()];
  }

  remove(key: string): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }
}
