// SPDX-License-Identifier: GPL-3.0-or-later
export * from "./context.js";
export * from "./evaluator.js";
export * from "./selector-registry.js";
export * from "./ability-eval.js";
// Side-effect imports to register all selectors
import "./selectors/number.js";
import "./selectors/x-choice.js";
import "./selectors/life-total.js";
import "./selectors/player-count.js";
import "./selectors/count.js";
import "./selectors/sum-aggregates.js";
import "./selectors/targeted.js";
import "./selectors/arithmetic.js";
import "./selectors/domain.js";
import "./selectors/common-counts.js";
import "./selectors/wave42-selectors.js";
