// SPDX-License-Identifier: GPL-3.0-or-later
// Shell class; payload type (rule-override patch) is defined by SP2.
import { GenericRegistry } from "./generic-registry.js";

export class RuleOverrideRegistry extends GenericRegistry<unknown> {}

export const ruleOverrideRegistry = new RuleOverrideRegistry();
