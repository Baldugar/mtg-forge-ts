// SPDX-License-Identifier: GPL-3.0-or-later
// Shell class; payload type (trigger handler) is defined by SP2. Singleton
// pattern lets consumers call triggerRegistry.register(...) directly.
import { GenericRegistry } from "./generic-registry.js";

export class TriggerRegistry extends GenericRegistry<unknown> {}

export const triggerRegistry = new TriggerRegistry();
