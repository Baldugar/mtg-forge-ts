// SPDX-License-Identifier: GPL-3.0-or-later
// CopySpellAbilityEffect — Forge `DB$ CopySpellAbility` (Probing Telepathy,
// Twincast, Reverberate / Reiterate). Copies a spell or activated ability
// currently on the stack via Stack.copy (CR 707.10).
//
// Forge DSL examples:
//   SVar:DBCopy:DB$ CopySpellAbility | Defined$ TriggeredSpellAbility | MayChooseTarget$ True
//
// MVP scope:
//   - Defined$ TriggeredSpellAbility — the stack item that triggered this
//     ability (looked up via SpellAbility.creationContext.triggerStackItemId
//     when present; otherwise the topmost stack item).
//   - Defined$ Targeted — the targeted spell on the stack (sa.targets[0]).
//   - NumCopies$ <number|SVar> — how many copies (default 1).
//   - MayChooseTarget$ True — caller can retarget. For MVP we preserve
//     original targets; SP4 retargeting is a follow-up.
//   - The new controller defaults to sa.controllerSeat (Twincast / Reverberate).
import type { EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { cantBeCopied } from "../../statics/wave70m-gate-helpers.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

export class CopySpellAbilityEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "CopySpellAbility";

  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const num = hasParam(sa, "NumCopies") ? evaluateParamNumber(sa, "NumCopies", game) : 1;

    let sourceItemId: EntityId | undefined;
    if (hasParam(sa, "Defined")) {
      const def = evaluateParamRaw(sa, "Defined").trim();
      if (def === "Targeted" && sa.targets.length > 0) {
        sourceItemId = sa.targets[0];
      }
    }
    // Fallback: the top non-current stack item. The ability being resolved
    // was already popped off the stack by the resolver, so `top` is now the
    // original spell that triggered this copy.
    if (sourceItemId === undefined) {
      const top = game.sharedZones.stack.top();
      if (top) sourceItemId = top.id;
    }
    if (sourceItemId === undefined) return;

    // Wave 70.M — CantBeCopied silent gate. When any active static
    // matches the source's underlying card (Display of Power / See
    // Double — "this spell can't be copied"), the copy attempt is
    // suppressed entirely. We resolve the underlying sourceCardId from
    // the live stack item BEFORE looping so all NumCopies attempts are
    // gated uniformly.
    const source = game.sharedZones.stack.toArray().find((it) => it.id === sourceItemId);
    if (source !== undefined && cantBeCopied(game, source.sourceCardId)) return;

    for (let i = 0; i < num; i++) {
      try {
        game.sharedZones.stack.copy(sourceItemId, sa.controllerSeat, game);
      } catch {
        // Source no longer on stack (e.g. fizzled mid-copy) — bail.
        return;
      }
    }
  }
}

effectRegistry.register(CopySpellAbilityEffect);
