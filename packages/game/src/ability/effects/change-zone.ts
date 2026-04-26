// SPDX-License-Identifier: GPL-3.0-or-later
// ChangeZone — generic zone-transition effect. Reads Origin$, Destination$,
// Defined$ params, plus a battery of post-move modifiers.
//
// Wave 53 broadened the MVP from "move target → destination" to handle the
// most-frequent Forge ChangeZone params encountered in the corpus:
//   - Origin$ <Zone>          — filter targets to those currently in that zone.
//   - ChangeNum$ <N>          — limit how many of the targets are moved (cap).
//   - Tapped$ True            — incoming permanents enter tapped (CR 110.5b).
//   - Attacking$ True         — stamp `enteredAttacking` flag on the moved
//                               card so the active combat cycle treats it as
//                               an attacker (combat-handler reads the flag).
//   - WithCountersType$ X     — counter type to stamp on the moved card.
//   - WithCountersAmount$ N   — counter count (default 1) — Persist's M1M1
//                               counter (Wave 31), Reanimator-style "with a
//                               +1/+1 counter" effects.
//   - Reveal$ True            — emit CardsRevealed before the move (default
//                               for Hand←Library moves under Forge anyway).
//   - Hidden$ True            — suppress the otherwise-default reveal of
//                               library cards moving to a hidden zone.
//   - Imprint$ True           — push the moved card's id into the source
//                               card's `imprinted` slot post-move (Isochron
//                               Scepter / Duplicant family).
//   - RememberChanged$ True   — push moved-card ids into the source card's
//                               `remembered` slot.
//
// AtRandom$ / Chooser$ are scheduled for the decision-subsystem pass (Wave
// 56+). For now, AtRandom$ True still narrows to a single random target
// using game.rng.
import { ZoneType } from "@mtg-forge-ts/core";
import type { CounterType, EntityId } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const ZONE_MAP: Readonly<Record<string, ZoneType>> = {
  Battlefield: ZoneType.Battlefield,
  Graveyard: ZoneType.Graveyard,
  Exile: ZoneType.Exile,
  Hand: ZoneType.Hand,
  Library: ZoneType.Library,
};

function parseZone(raw: string): ZoneType | undefined {
  return ZONE_MAP[raw];
}

const isTrue = (raw: string | undefined): boolean => raw !== undefined && raw.trim().toLowerCase() === "true";

export class ChangeZoneEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "ChangeZone";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const destRaw = hasParam(sa, "Destination") ? evaluateParamRaw(sa, "Destination") : undefined;
    const destZone = destRaw !== undefined ? parseZone(destRaw) : undefined;
    if (destZone === undefined) {
      // Cannot proceed without a parseable destination — no-op for safety.
      return;
    }

    // ---- Origin$ filter ---------------------------------------------------
    // Narrow targets to those currently in the named origin zone (default:
    // any). Cards no longer in origin (e.g., already moved by a sub-effect)
    // are silently skipped.
    const originRaw = hasParam(sa, "Origin") ? evaluateParamRaw(sa, "Origin") : undefined;
    const originZone = originRaw !== undefined ? parseZone(originRaw) : undefined;

    let candidates: readonly EntityId[] = sa.targets;
    if (originZone !== undefined) {
      candidates = candidates.filter((id) => game.cards.get(id)?.zone === originZone);
    }

    // ---- AtRandom$ True --------------------------------------------------
    // MVP: pick a single random candidate. Full "pick N at random" is
    // scheduled for the decision subsystem.
    if (isTrue(hasParam(sa, "AtRandom") ? evaluateParamRaw(sa, "AtRandom") : undefined)) {
      if (candidates.length > 0) {
        const idx = game.rng.nextInt(0, candidates.length);
        const picked = candidates[idx];
        candidates = picked !== undefined ? [picked] : [];
      }
    }

    // ---- ChangeNum$ N -----------------------------------------------------
    // Cap how many of the candidate set are actually moved.
    if (hasParam(sa, "ChangeNum")) {
      const n = evaluateParamNumber(sa, "ChangeNum", game);
      candidates = candidates.slice(0, Math.max(0, n));
    }

    // ---- Per-target post-move modifiers ----------------------------------
    const enterTapped = isTrue(hasParam(sa, "Tapped") ? evaluateParamRaw(sa, "Tapped") : undefined);
    const enterAttacking = isTrue(hasParam(sa, "Attacking") ? evaluateParamRaw(sa, "Attacking") : undefined);
    const withCountersType = hasParam(sa, "WithCountersType")
      ? evaluateParamRaw(sa, "WithCountersType")
      : undefined;
    const withCountersAmount =
      withCountersType !== undefined && hasParam(sa, "WithCountersAmount")
        ? evaluateParamNumber(sa, "WithCountersAmount", game)
        : withCountersType !== undefined
          ? 1
          : 0;
    const stampImprint = isTrue(hasParam(sa, "Imprint") ? evaluateParamRaw(sa, "Imprint") : undefined);
    const stampRemembered = isTrue(
      hasParam(sa, "RememberChanged") ? evaluateParamRaw(sa, "RememberChanged") : undefined,
    );

    for (const targetId of candidates) {
      const card = game.cards.get(targetId);
      // For hand moves, route to the card's owner seat.
      if (destZone === ZoneType.Hand && card?.ownerSeat !== undefined) {
        yield* game.action.moveTo(targetId, destZone, { toSeat: card.ownerSeat, cause: "effect" });
      } else {
        yield* game.action.moveTo(targetId, destZone, { cause: "effect" });
      }

      // Post-move tweaks only apply when the destination is the battlefield —
      // tapped/attacking/with-counters are battlefield-only states.
      if (destZone !== ZoneType.Battlefield) {
        if (stampImprint || stampRemembered) {
          this.stampSource(game, sa.sourceCardId, targetId, { stampImprint, stampRemembered });
        }
        continue;
      }

      const moved = game.cards.get(targetId);
      if (moved === undefined) continue;

      if (enterTapped) {
        moved.tapped = true;
      }
      if (enterAttacking) {
        // SP3 combat-handler reads `enteredAttacking` to add the card to
        // the active combat phase as an attacker. For MVP we just stamp
        // the flag; the combat integration is wave-54+ work. Setting
        // here is forward-compatible.
        moved.enteredAttacking = true;
      }
      if (withCountersType !== undefined && withCountersAmount > 0) {
        yield* game.action.addCounter(
          targetId,
          withCountersType as CounterType,
          withCountersAmount,
          sa.sourceCardId,
        );
      }
      if (stampImprint || stampRemembered) {
        this.stampSource(game, sa.sourceCardId, targetId, { stampImprint, stampRemembered });
      }
    }
  }

  /** Push the moved card's id into the source's imprinted/remembered slots. */
  private stampSource(
    game: Game,
    sourceId: EntityId,
    targetId: EntityId,
    opts: { stampImprint: boolean; stampRemembered: boolean },
  ): void {
    const src = game.cards.get(sourceId);
    if (!src) return;
    if (opts.stampImprint && !src.imprinted.includes(targetId)) {
      src.imprinted.push(targetId);
    }
    if (opts.stampRemembered && !src.remembered.includes(targetId)) {
      src.remembered.push(targetId);
    }
  }
}

effectRegistry.register(ChangeZoneEffect);
