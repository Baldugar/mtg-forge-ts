// SPDX-License-Identifier: GPL-3.0-or-later
import type { CostPart } from "./cost-part.js";

export { CostPart } from "./cost-part.js";

export class Cost {
  constructor(readonly parts: readonly CostPart[]) {}

  static of(...parts: CostPart[]): Cost {
    return new Cost(parts);
  }

  toJSON(): { parts: Array<{ kind: string; [k: string]: unknown }> } {
    return { parts: this.parts.map((p) => p.toJSON()) };
  }

  static fromJSON(s: {
    parts: Array<{ kind: string; [k: string]: unknown }>;
  }): Cost {
    return new Cost(s.parts.map((part) => CostPartRegistry.hydrate(part)));
  }
}

// Module-level registry state. Kept behind the CostPartRegistry facade so
// Task 16 call sites can use `CostPartRegistry.register(...)` /
// `CostPartRegistry.hydrate(...)` as specified by the plan.
const ctors = new Map<string, (data: { kind: string; [k: string]: unknown }) => CostPart>();

export const CostPartRegistry = {
  register(kind: string, ctor: (data: { kind: string; [k: string]: unknown }) => CostPart): void {
    ctors.set(kind, ctor);
  },
  hydrate(data: { kind: string; [k: string]: unknown }): CostPart {
    const ctor = ctors.get(data.kind);
    if (!ctor) throw new Error(`Unknown CostPart kind: ${data.kind}`);
    return ctor(data);
  },
  /** All registered CostPart kinds. Useful for DSL diagnostics and reflection. */
  list(): string[] {
    return [...ctors.keys()];
  },
  /** True iff the given kind has a registered constructor. */
  has(kind: string): boolean {
    return ctors.has(kind);
  },
  /** Remove a registration. Returns true iff a mapping was removed. */
  unregister(kind: string): boolean {
    return ctors.delete(kind);
  },
} as const;
