// SPDX-License-Identifier: GPL-3.0-or-later
// CostPartRegistry — maps handlerKey strings to their singleton CostPart
// implementations. Auto-populated by each CostPart module via
// `costPartRegistry.register(...)` at module load time.
import type { CostPart } from "./cost-part.js";

class CostPartRegistry {
  private readonly byKey = new Map<string, CostPart>();

  register(part: CostPart): void {
    this.byKey.set(part.handlerKey, part);
  }

  lookup(key: string): CostPart | undefined {
    return this.byKey.get(key);
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }
}

export const costPartRegistry = new CostPartRegistry();
