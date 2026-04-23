// SPDX-License-Identifier: GPL-3.0-or-later
// CR 613.8 within-layer dependency resolver.
//
// Contract:
//   - Effect A depends on effect B if applying B alters what A does, what A
//     applies to, or makes A applicable to more/fewer objects, AND A has no
//     reciprocal effect on B (asymmetric).
//   - Non-dependent effects resolve by timestamp.
//   - Circular dependencies (any cycle involving 2+ effects in the same
//     layer) fall back to pure timestamp order per CR 613.8c.
//
// Algorithm: Kahn's topo sort with timestamp tie-breaking, guarded by a
// cycle-detection pass. Returned order is stable and deterministic.
export interface DepNode<T> {
  readonly id: string;
  readonly timestamp: number;
  readonly dependsOn: readonly string[];
  readonly raw?: T;
}

const detectCycle = (effects: readonly DepNode<unknown>[]): boolean => {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const adj = new Map<string, readonly string[]>();
  for (const e of effects) {
    color.set(e.id, WHITE);
    adj.set(e.id, e.dependsOn);
  }
  const dfs = (u: string): boolean => {
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      if (!adj.has(v)) continue;
      const cv = color.get(v) ?? WHITE;
      if (cv === GRAY) return true;
      if (cv === WHITE && dfs(v)) return true;
    }
    color.set(u, BLACK);
    return false;
  };
  for (const u of adj.keys()) {
    if ((color.get(u) ?? WHITE) === WHITE && dfs(u)) return true;
  }
  return false;
};

export const resolveDependencyOrder = <T, N extends DepNode<T>>(effects: readonly N[]): N[] => {
  if (effects.length <= 1) return [...effects];
  if (detectCycle(effects)) {
    return [...effects].sort((a, b) => a.timestamp - b.timestamp);
  }
  const byId = new Map(effects.map((e) => [e.id, e] as const));
  const indeg = new Map<string, number>();
  for (const e of effects) {
    indeg.set(e.id, e.dependsOn.filter((d) => byId.has(d)).length);
  }
  const ready: N[] = effects.filter((e) => (indeg.get(e.id) ?? 0) === 0);
  ready.sort((a, b) => a.timestamp - b.timestamp);
  const out: N[] = [];
  while (ready.length > 0) {
    const n = ready.shift();
    if (!n) break;
    out.push(n);
    for (const other of effects) {
      if (other.dependsOn.includes(n.id)) {
        const v = (indeg.get(other.id) ?? 0) - 1;
        indeg.set(other.id, v);
        if (v === 0 && !out.includes(other) && !ready.includes(other)) {
          ready.push(other);
          ready.sort((a, b) => a.timestamp - b.timestamp);
        }
      }
    }
  }
  // Safety: if topo fails to consume everyone (should not happen given cycle
  // detection), fall back to timestamp order over the unconsumed tail.
  if (out.length !== effects.length) {
    const missing = effects.filter((e) => !out.includes(e)).sort((a, b) => a.timestamp - b.timestamp);
    out.push(...missing);
  }
  return out;
};
