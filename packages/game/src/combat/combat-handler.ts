// SPDX-License-Identifier: GPL-3.0-or-later
// CombatHandler — the SOLE mutator of CombatState per the master spec's
// three-mutators architecture (GameAction / CombatHandler / subsystem-internal).
// GameAction must not touch CombatState directly. SP1 exposed the mutation
// surface; SP2 Task 46 added dealDamage(isFirstStrikeStep); Task 47 layered
// in lethal+trample+deathtouch validation (damage-assignment-validator.ts);
// Task 48 adds the first-strike / double-strike step split per CR 702.7 /
// 702.4:
//   - FS step: only creatures with first_strike or double_strike deal damage.
//   - Regular step: creatures without first_strike (first hit) PLUS creatures
//     with double_strike (second hit). First-strike-only creatures that
//     already dealt in the FS step do not deal again.
//
// `runCombatDamage()` drives the full split when any combatant has FS or DS;
// otherwise it falls through to a single dealDamage(false) call.
import { type EntityId, IllegalDecisionError, type PlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../action/engine-yield.js";
import { onCombatDamageToPlayer as onCombatDamageInitiative } from "../dnd/initiative-tracker.js";
import type { Game } from "../game.js";
import { onCombatDamageToPlayer as onCombatDamageMonarch } from "../monarch/monarch-tracker.js";
import {
  canAttack,
  canBlock,
  collectMustAttackSubjects,
  sweepEndOfCombat,
} from "../statics/wave65-combat-gates.js";
import { assignsCombatDamageAsUnblocked } from "../statics/wave70f-combat-gates.js";
import { collectMustBlockSubjects } from "../statics/wave70g-combat-gates.js";
import type { AttackerInfo, BlockerInfo, CombatState, DefenderTarget } from "./combat-state.js";
import { createCombatState } from "./combat-state.js";
import {
  attackerPower,
  defenderId,
  defenderKind,
  hasKeyword,
  isPhasedOut,
} from "./damage-assignment-helpers.js";
import { type CombatDamageAssignment, defaultAssignment } from "./damage-assignment-validator.js";
import { validateBlockDeclarations } from "./keywords/block-restrictions.js";

export class CombatHandler {
  readonly state: CombatState = createCombatState();

  // CR 702.4 / 702.7 — creatures that dealt damage in the first-strike step.
  // The regular step suppresses first-strike-only creatures that already
  // dealt (invariant holds trivially when nothing strips FS mid-combat, but
  // we track it so a SP3 layered FS-removal effect between the two steps
  // cannot cause a FS-only creature to double-hit).
  private readonly dealtFirstStrike = new Set<EntityId>();

  constructor(private readonly game: Game) {}

  declareAttackers(decls: readonly { attackerId: EntityId; defender: DefenderTarget }[]): void {
    // Wave 65.A — consult the static CantAttack registry (Wave 50). A
    // creature matched by an active CantAttack restriction (Propaganda-
    // shape "creatures can't attack") is illegal at declaration. Throw
    // IllegalDecisionError so the caller surfaces the reason; this
    // mirrors the declareBlockers I-13 path.
    const illegalAttackers: EntityId[] = [];
    for (const d of decls) {
      if (!canAttack(this.game, d.attackerId)) illegalAttackers.push(d.attackerId);
    }
    if (illegalAttackers.length > 0) {
      throw new IllegalDecisionError(
        `declareAttackers: cantAttack static rejects ${illegalAttackers.join(",")}`,
      );
    }
    for (const d of decls) {
      const info: AttackerInfo = { attackerId: d.attackerId, defender: d.defender, isTapped: false };
      this.state.attackers.set(d.attackerId, info);
      // Wave 65.A — stamp `attackedThisCombat` on the live card. Read by
      // the EOC sweep to drive Decayed (CR 702.176 — sacrifice at end of
      // combat if attacked).
      const card = this.game.cards.get(d.attackerId);
      if (card) card.attackedThisCombat = true;
    }
    // Wave 65.A — Read 4 (card.enteredAttacking, Wave 53). Scan the
    // battlefield for any creature stamped with enteredAttacking = true
    // that isn't already in the attackers list, and pull it in. Each ETB-
    // as-attacking source (Encore tokens, Mobilize tokens, "ETB attacking"
    // ChangeZone effects) sets attackingDefender alongside enteredAttacking
    // — that field carries the resolved defender (PlayerSeat for player /
    // EntityId for planeswalker). Clear both flags after add so the next
    // combat starts clean.
    this.applyEnteredAttacking();
    // Wave 65.A — Read 3 (Static MustAttack, Wave 50). Auto-correct: any
    // creature subject to an active MustAttack that wasn't already in the
    // attackers list gets pulled in. Defender defaults to "any opponent"
    // (the first non-active player); MustAttack$ <player> sub-param
    // payload is // TODO(advanced).
    this.applyMustAttack();
  }

  declareBlockers(decls: readonly { blockerId: EntityId; attackerIds: readonly EntityId[] }[]): void {
    // Audit I-13 — validate block restrictions (flying, reach, menace,
    // landwalk, protection, etc.) before storing declarations. Illegal
    // blocks throw IllegalDecisionError with the per-declaration reason.
    const illegal = validateBlockDeclarations(this.game, decls);
    if (illegal.length > 0) {
      const reasons = illegal.map((r) => r.reason ?? "unknown block restriction").join("; ");
      throw new IllegalDecisionError(`declareBlockers: ${reasons}`);
    }
    // Wave 65.A — Read 1 (card.decayed, Wave 59). CR 702.176 — "A creature
    // with decayed can't block." Reject decayed creatures BEFORE storing
    // declarations. The block-restrictions module already filters static
    // cantBlock; Decayed is a card-flag stamp, not a static, so it lives
    // here at the gate.
    const decayed: EntityId[] = [];
    for (const d of decls) {
      if (!canBlock(this.game, d.blockerId)) decayed.push(d.blockerId);
    }
    if (decayed.length > 0) {
      throw new IllegalDecisionError(
        `declareBlockers: decayed creature(s) cannot block: ${decayed.join(",")}`,
      );
    }
    for (const d of decls) {
      const info: BlockerInfo = { blockerId: d.blockerId, attackerIds: [...d.attackerIds] };
      this.state.blockers.set(d.blockerId, info);
    }
    // Wave 70.G — auto-correct: any creature subject to an active
    // MustBlock static that wasn't already declared as a blocker gets
    // pulled in, blocking the first attacker available (preferring the
    // attacker matched by the static's Attacker$ filter when present).
    // Mirror of applyMustAttack — same "if able" gating contract.
    this.applyMustBlock();
  }

  /**
   * Wave 65.A — pulls every battlefield card with `enteredAttacking = true`
   * + an `attackingDefender` stamp into the attackers list, then clears
   * both flags. Idempotent — running twice in the same combat is a no-op
   * after the first run.
   *
   * Defender resolution: `attackingDefender` carries either a PlayerSeat
   * (number stored as the seat's branded id) or an EntityId (planeswalker).
   * We disambiguate by checking if the value resolves to a live card
   * (planeswalker) vs. a player seat. The runtime stamp already carries
   * the right shape per the source effect; we duck-type into the same
   * DefenderTarget union.
   */
  private applyEnteredAttacking(): void {
    for (const card of this.game.cards.values()) {
      if (!card.enteredAttacking) continue;
      if (this.state.attackers.has(card.id)) {
        // Already declared — just clear the flag.
        card.enteredAttacking = false;
        const cu = card as unknown as { attackingDefender?: unknown };
        cu.attackingDefender = undefined;
        card.attackedThisCombat = true;
        continue;
      }
      const cu = card as unknown as { attackingDefender?: unknown };
      const stamp = cu.attackingDefender;
      const defender = this.resolveDefenderStamp(stamp);
      if (defender === null) {
        // No defender stamp → can't form an attacker; clear the flag so
        // we don't loop on a dead stamp next combat.
        card.enteredAttacking = false;
        continue;
      }
      const info: AttackerInfo = { attackerId: card.id, defender, isTapped: false };
      this.state.attackers.set(card.id, info);
      card.attackedThisCombat = true;
      card.enteredAttacking = false;
      cu.attackingDefender = undefined;
    }
  }

  /**
   * Wave 65.A — auto-add must-attack creatures (CR 506.5 attack
   * requirements; goad-shape statics from Wave 50). Walks the
   * mustAttack restriction registry, finds matching battlefield
   * creatures not already in the attackers list, and pulls them in
   * with a default-opponent defender.
   *
   * MVP — defender is the first non-active opponent. The MustAttack$
   * <player> sub-param (Forge's "must attack PLAYER if able") is
   * // TODO(advanced); same shape as goad's "must attack a player
   * other than the goader" — needs the static's payload to carry the
   * required-defender constraint.
   */
  private applyMustAttack(): void {
    const subjects = collectMustAttackSubjects(this.game);
    if (subjects.length === 0) return;
    const opponent = this.firstOpponent();
    if (opponent === null) return;
    for (const id of subjects) {
      if (this.state.attackers.has(id)) continue;
      // Respect CantAttack — if a creature is both must-attack and
      // cant-attack, the cant- side wins (CR 509.1d "if able"). Skip it.
      if (!canAttack(this.game, id)) continue;
      const card = this.game.cards.get(id);
      if (!card) continue;
      const info: AttackerInfo = {
        attackerId: id,
        defender: { kind: "player", seat: opponent },
        isTapped: false,
      };
      this.state.attackers.set(id, info);
      card.attackedThisCombat = true;
    }
  }

  /**
   * Wave 70.G — auto-add must-block creatures (CR 509.1g block
   * requirements; Provoke / Lure-shape statics + the Wave 70.G
   * MustBlock static-mode handler). Walks the mustBlock restriction
   * registry, finds matching battlefield creatures NOT already in
   * the blockers list, and pulls them in blocking the matched
   * attacker (when Attacker$ is supplied) or the first declared
   * attacker otherwise.
   *
   * MVP — defender is the first declared attacker; the
   * collectMustBlockSubjects helper carries the must-block-attacker id
   * via the second tuple element when the static specifies Attacker$.
   * "If able" gating: respects the existing canBlock gate (decayed) +
   * the static cantBlock registry (via gatherRestrictions sweep at
   * declareBlockers time). The full Forge "if able" check (tap state,
   * evasion vs the required attacker) is // TODO(advanced); same
   * contract as applyMustAttack.
   */
  private applyMustBlock(): void {
    const subjects = collectMustBlockSubjects(this.game);
    if (subjects.length === 0) return;
    // Pick a default attacker (first declared) for must-block entries
    // without a specific Attacker$ filter.
    const declaredAttackerIds = [...this.state.attackers.keys()];
    if (declaredAttackerIds.length === 0) return;
    const defaultAttackerId = declaredAttackerIds[0];
    if (defaultAttackerId === undefined) return;
    for (const subj of subjects) {
      if (this.state.blockers.has(subj.blockerId)) continue;
      // Respect canBlock — decayed / future cant-block-flagged creatures
      // are excluded (CR 509.1d "if able").
      if (!canBlock(this.game, subj.blockerId)) continue;
      const card = this.game.cards.get(subj.blockerId);
      if (!card) continue;
      // Resolve the required attacker. If the static targeted a specific
      // Attacker$ that matches a declared attacker, use that; otherwise
      // fall back to the default (first declared attacker).
      const requiredId = subj.mustBlockAttackerId;
      const targetAttackerId =
        requiredId !== undefined && this.state.attackers.has(requiredId) ? requiredId : defaultAttackerId;
      const info: BlockerInfo = {
        blockerId: subj.blockerId,
        attackerIds: [targetAttackerId],
      };
      this.state.blockers.set(subj.blockerId, info);
    }
  }

  /**
   * Wave 65.A — return the first non-active player seat (the canonical
   * "any opponent" choice for auto-correct must-attack). MVP only; full
   * multiplayer goad-shape "any opponent other than goader" needs payload
   * threading.
   */
  private firstOpponent(): PlayerSeat | null {
    const active = this.game.activePlayer;
    for (const p of this.game.players) {
      if (p.seat !== active) return p.seat;
    }
    return null;
  }

  /**
   * Wave 65.A — best-effort defender stamp normalization. The
   * `attackingDefender` slot is stamped by Encore / Mobilize / ChangeZone
   * Attacking$ True and carries either a PlayerSeat (number) or an
   * EntityId (planeswalker). We disambiguate by checking the live card
   * registry: if the stamp resolves to a live card, treat as
   * planeswalker; otherwise treat as player seat.
   */
  private resolveDefenderStamp(stamp: unknown): DefenderTarget | null {
    if (stamp === null || stamp === undefined) return null;
    if (typeof stamp !== "number") return null;
    // Try planeswalker first — if the stamp is a live card id, treat as
    // planeswalker defender.
    const card = this.game.cards.get(stamp as EntityId);
    if (card !== undefined) {
      return { kind: "planeswalker", id: stamp as EntityId };
    }
    // Otherwise treat as player seat.
    return { kind: "player", seat: stamp as PlayerSeat };
  }

  /**
   * Wave 65.A — End-of-Combat sweep. Sacrifice every decayed creature
   * that attacked this combat (CR 702.176 second sentence — "When this
   * creature attacks, sacrifice it at end of combat"); then clear
   * attackedThisCombat on every card so the next combat starts fresh.
   *
   * Phase-handler invokes this at PhaseStep.EndOfCombat. Order: the
   * Wave-60.D "additional combat phase" consumption already runs at
   * EndOfCombat; we run BEFORE that injection so the sacrifices fire
   * for the just-completed combat (the additional combat then opens
   * with a clean slate).
   */
  *endOfCombat(): Generator<EngineYield, void, unknown> {
    yield* sweepEndOfCombat(this.game);
  }

  setBlockerOrder(attackerId: EntityId, blockerOrder: readonly EntityId[]): void {
    this.state.blockerOrdering.set(attackerId, [...blockerOrder]);
  }

  assignDamage(attackerId: EntityId, assignments: readonly { targetId: EntityId; amount: number }[]): void {
    this.state.damageAssignments.set(attackerId, [...assignments]);
  }

  setFirstStrikeSplit(active: boolean): void {
    this.state.firstStrikeSplitActive = active;
  }

  clear(): void {
    this.state.attackers.clear();
    this.state.blockers.clear();
    this.state.blockerOrdering.clear();
    this.state.damageAssignments.clear();
    this.state.firstStrikeSplitActive = false;
    this.dealtFirstStrike.clear();
  }

  /**
   * CR 510 combat damage step. Walks attackers in declaration order, then
   * blockers, emitting damage events through GameAction.damage. The latter
   * routes through the replacement chain and mutates Card.damage /
   * Player.life downstream (and fires DamageDealt triggers).
   *
   *   - Unblocked attacker: whole power to declared defender.
   *   - Blocked attacker with caller-declared damageAssignments: emit those.
   *   - Blocked attacker without: `defaultAssignment` (Task 47).
   *   - Blocker: deals power to the first attacker it blocks. Banding /
   *     multi-attacker blocker damage ordering is deferred to SP3 Task 51.
   *
   * Step participation is decided by `isActiveInStep`. Prefer calling
   * `runCombatDamage()` at the combat-damage step boundary rather than
   * invoking this directly — runCombatDamage conditionally runs the FS
   * step and maintains the firstStrikeSplitActive flag.
   */
  *dealDamage(isFirstStrikeStep: boolean): Generator<EngineYield, void, unknown> {
    for (const [attackerId, info] of this.state.attackers) {
      if (!this.isActiveInStep(attackerId, isFirstStrikeStep)) continue;
      // CR 702.26e — phased-out creatures deal and receive no damage
      // during combat. The declaration lists (attackers/blockers) may still
      // hold the id if a prior step phased the creature out mid-combat;
      // silently skip rather than blow away state so un-phasing restores
      // the combat role cleanly.
      if (isPhasedOut(this.game, attackerId)) continue;
      const power = attackerPower(this.game, attackerId);
      if (power <= 0) continue;
      const blockers = this.state.blockerOrdering.get(attackerId) ?? [];
      // Wave 70.F — AssignCombatDamageAsUnblocked (CR 510). When an
      // active static matches this attacker, treat the blocked branch as
      // if no blockers existed: damage routes to the declared defender
      // using the attacker's full power. Distinct from Trample — trample
      // assigns lethal-to-blockers then spills excess to defender; this
      // routes ALL damage to defender regardless of blocker survival.
      const asUnblocked = assignsCombatDamageAsUnblocked(this.game, attackerId);
      if (blockers.length === 0 || asUnblocked) {
        const d = info.defender;
        const dKind = defenderKind(d);
        const dId = defenderId(d);
        yield* this.game.action.damage(attackerId, dKind, dId, power, true);
        // Wave 27 — Initiative + Monarch combat-damage transfer (CR 506.4 /
        // 716 / 906). When an attacker deals damage to a player, check if
        // that player is the current monarch / initiative-holder; if so
        // transfer to the attacker's controller. Per CR 506.4 the transfer
        // happens AFTER damage resolves, so we run it post-yield. Triggers
        // observing BecameMonarch / BecameInitiative will see the new state
        // when they resolve.
        if (dKind === "player") {
          yield* this.applyCombatTransfers(attackerId, dId as PlayerSeat, power);
        }
      } else {
        const preDeclared = this.state.damageAssignments.get(attackerId);
        const outs: readonly CombatDamageAssignment[] =
          preDeclared && preDeclared.length > 0
            ? preDeclared.map((a) => ({
                targetKind: "creature" as const,
                targetId: a.targetId,
                amount: a.amount,
              }))
            : defaultAssignment(this.game, attackerId, blockers, power, info.defender);
        for (const a of outs) {
          yield* this.game.action.damage(attackerId, a.targetKind, a.targetId, a.amount, true);
        }
      }
      if (isFirstStrikeStep) this.dealtFirstStrike.add(attackerId);
    }

    for (const [blockerId, info] of this.state.blockers) {
      if (!this.isActiveInStep(blockerId, isFirstStrikeStep)) continue;
      // CR 702.26e — phased-out blockers don't deal damage either.
      if (isPhasedOut(this.game, blockerId)) continue;
      const power = attackerPower(this.game, blockerId);
      if (power <= 0) continue;
      const primaryAttacker = info.attackerIds[0];
      if (primaryAttacker === undefined) continue;
      yield* this.game.action.damage(blockerId, "creature", primaryAttacker, power, true);
      if (isFirstStrikeStep) this.dealtFirstStrike.add(blockerId);
    }
  }

  /**
   * Drive the full combat damage step with the CR 702.7 / 702.4 split. If
   * any attacker or blocker has first_strike or double_strike, run a FS
   * step (firstStrikeSplitActive=true) followed by the regular step;
   * otherwise skip the FS step entirely and run only the regular step.
   */
  *runCombatDamage(): Generator<EngineYield, void, unknown> {
    const needsFSStep =
      [...this.state.attackers.keys()].some((id) => this.hasFSorDS(id)) ||
      [...this.state.blockers.keys()].some((id) => this.hasFSorDS(id));
    if (needsFSStep) {
      this.setFirstStrikeSplit(true);
      yield* this.dealDamage(true);
      this.setFirstStrikeSplit(false);
    }
    yield* this.dealDamage(false);
  }

  /**
   * Wave 27 — yield Initiative + Monarch transfer events when an attacker
   * dealt combat damage to a player. The trackers' helpers compute the
   * transfer + mutate game.flags; we just emit the resulting events
   * through the canonical pipeline so triggers see them.
   */
  private *applyCombatTransfers(
    sourceId: EntityId,
    targetSeat: PlayerSeat,
    amount: number,
  ): Generator<EngineYield, void, unknown> {
    for (const evt of onCombatDamageInitiative(this.game, sourceId, targetSeat, amount)) {
      yield this.game.emitEvent(evt);
    }
    for (const evt of onCombatDamageMonarch(this.game, sourceId, targetSeat, amount)) {
      yield this.game.emitEvent(evt);
    }
  }

  private hasFSorDS(creatureId: EntityId): boolean {
    return (
      hasKeyword(this.game, creatureId, "first_strike") || hasKeyword(this.game, creatureId, "double_strike")
    );
  }

  /**
   * CR 702.7 / 702.4 step participation.
   *   - FS step: only creatures with first_strike or double_strike
   *     participate.
   *   - Regular step: double-strikers (second hit) and non-first-strike
   *     creatures (first hit) both participate. First-strike-only
   *     creatures that already dealt their FS-step damage do not double-
   *     hit (suppressed via dealtFirstStrike).
   *
   * Edge case: if someone calls dealDamage(false) directly without a
   * prior FS step, a first_strike-only creature falls through to the
   * regular step — best-effort, matches Forge's defensive behavior.
   */
  private isActiveInStep(creatureId: EntityId, isFirstStrikeStep: boolean): boolean {
    const hasFS = hasKeyword(this.game, creatureId, "first_strike");
    const hasDS = hasKeyword(this.game, creatureId, "double_strike");
    if (isFirstStrikeStep) {
      return hasFS || hasDS;
    }
    if (hasDS) return true;
    if (hasFS) {
      // First-strike only. Skip if already dealt in FS step; otherwise
      // fall through (caller used dealDamage(false) without a prior FS
      // pass).
      return !this.dealtFirstStrike.has(creatureId);
    }
    return true;
  }
}
