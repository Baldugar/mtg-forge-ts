// SPDX-License-Identifier: GPL-3.0-or-later
// STUB: SumPower / SumToughness / SumCMC selectors require effective P/T
// via the LayerEngine, which is Part C (effect handlers + factory
// dispatch) scope. For Part B we register placeholder selectors that
// throw a clear "deferred" error when invoked. This ensures the
// dispatcher knows the selector KIND is legal but the IMPLEMENTATION
// isn't yet.
import { selectorRegistry } from "../selector-registry.js";

const stubFactory = (name: string) => () => {
  throw new Error(
    `${name}$ selector not yet implemented (deferred to SP3 Part C — needs LayerEngine effective P/T integration)`,
  );
};

selectorRegistry.register("SumPower", stubFactory("SumPower"));
selectorRegistry.register("SumToughness", stubFactory("SumToughness"));
selectorRegistry.register("SumCMC", stubFactory("SumCMC"));
