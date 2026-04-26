// SPDX-License-Identifier: GPL-3.0-or-later
// DealDamageEffect — Forge SP$ DealDamage. Deals NumDmg$ to each target.
//
// Wave 53 broadens the Wave-1 MVP:
//   - Defined$ <selector>      — resolves to recipients without targeting.
//                                Supports `Targeted` (alias for sa.targets),
//                                `Self`, `You`, `Opponent`, `Player.Opponent`,
//                                `TargetedPlayer`, `TargetedCard`. Mirrors
//                                Forge's AbilityUtils.getDefinedObjects().
//   - RememberDamaged$ True   — push damaged ids onto the source card's
//                                `remembered` slot (Inferno Titan-style
//                                "deal damage to N targets, then …").
//   - DivideOnResolution$ True — placeholder that records the divide intent
//                                so SP3's decision subsystem can split the
//                                amount across targets. MVP splits evenly.
//
// X-amount damage continues to read sa.xValue through evaluateParamNumber.
import type { EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import { mkPlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import { parseValidTgts } from "../../cast/valid-targets.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";
import { enumerateOverloadedTargets } from "./overload-enumerate.js";

const isTrue = (raw: string | undefined): boolean => raw !== undefined && raw.trim().toLowerCase() === "true";

/**
 * Resolve a Defined$ selector to a list of EntityIds (cards) and/or seats.
 * Returns a discriminated array so the damage loop knows which flavour to
 * emit.
 */
type Recipient =
  | { readonly kind: "card"; readonly id: EntityId }
  | { readonly kind: "player"; readonly seat: PlayerSeat };

function resolveDefined(raw: string, sa: SpellAbility): readonly Recipient[] {
  const tok = raw.trim();
  if (tok === "Targeted" || tok === "TargetedCard" || tok === "TargetedPlayer") {
    // Targeted may include both cards and players; we discriminate by
    // looking each id up below in the caller (not here — we just emit
    // card-kind as the safe default; the damage call will misroute to
    // creatures otherwise. Caller handles the polymorphism instead).
    return sa.targets.map((id) => ({ kind: "card", id }) as const);
  }
  if (tok === "Self") return [{ kind: "card", id: sa.sourceCardId }];
  if (tok === "You" || tok === "Player.You") return [{ kind: "player", seat: sa.controllerSeat }];
  if (tok === "Opponent" || tok === "Player.Opponent") {
    const n = sa.controllerSeat as unknown as number;
    return [{ kind: "player", seat: mkPlayerSeat(n === 0 ? 1 : 0) }];
  }
  return [];
}

export class DealDamageEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "DealDamage";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const totalAmount = evaluateParamNumber(sa, "NumDmg", game);

    // Overload path is unchanged — overloaded spells enumerate their own
    // targets (creature-only) regardless of Defined$ / DivideOnResolution$.
    if (sa.tags.has("overloaded")) {
      const ids = enumerateOverloadedTargets(sa, game, parseValidTgts);
      for (const targetId of ids) {
        yield* game.action.damage(sa.sourceCardId, "creature", targetId, totalAmount, false);
      }
      return;
    }

    // ---- Recipients --------------------------------------------------
    let targets: readonly EntityId[] = sa.targets;
    if (sa.targets.length === 0 && hasParam(sa, "Defined")) {
      const defined = resolveDefined(evaluateParamRaw(sa, "Defined"), sa);
      targets = defined.filter((r) => r.kind === "card").map((r) => r.id);
      // For player-flavour Defined$ recipients we damage them inline below
      // to avoid the card/player ambiguity the targets array implies.
      const playerRecipients = defined.filter((r) => r.kind === "player");
      const damaged: EntityId[] = [];
      const splitTargets = isTrue(
        hasParam(sa, "DivideOnResolution") ? evaluateParamRaw(sa, "DivideOnResolution") : undefined,
      );
      const splitTotal = playerRecipients.length + targets.length;
      const perRecipient =
        splitTargets && splitTotal > 0 ? Math.floor(totalAmount / splitTotal) : totalAmount;

      for (const r of playerRecipients) {
        yield* game.action.damage(
          sa.sourceCardId,
          "player",
          r.seat as unknown as EntityId,
          perRecipient,
          false,
        );
      }
      for (const targetId of targets) {
        const asCard = game.cards.get(targetId);
        const targetKind = asCard ? ("creature" as const) : ("player" as const);
        yield* game.action.damage(sa.sourceCardId, targetKind, targetId, perRecipient, false);
        damaged.push(targetId);
      }
      this.maybeStampRemembered(sa, game, damaged);
      return;
    }

    // ---- Standard targeted path -------------------------------------
    const splitTargets = isTrue(
      hasParam(sa, "DivideOnResolution") ? evaluateParamRaw(sa, "DivideOnResolution") : undefined,
    );
    const perRecipient =
      splitTargets && targets.length > 0 ? Math.floor(totalAmount / targets.length) : totalAmount;
    const damaged: EntityId[] = [];
    for (const targetId of targets) {
      const asCard = game.cards.get(targetId);
      const targetKind = asCard ? ("creature" as const) : ("player" as const);
      yield* game.action.damage(sa.sourceCardId, targetKind, targetId, perRecipient, false);
      damaged.push(targetId);
    }
    this.maybeStampRemembered(sa, game, damaged);
  }

  private maybeStampRemembered(sa: SpellAbility, game: Game, ids: readonly EntityId[]): void {
    if (!isTrue(hasParam(sa, "RememberDamaged") ? evaluateParamRaw(sa, "RememberDamaged") : undefined))
      return;
    const src = game.cards.get(sa.sourceCardId);
    if (!src) return;
    for (const id of ids) {
      if (!src.remembered.includes(id)) src.remembered.push(id);
    }
  }
}

effectRegistry.register(DealDamageEffect);
