// SPDX-License-Identifier: GPL-3.0-or-later
// CR 704.5a/b/c — player-loss SBA collectors.
//
// CR 704.5a — A player with 0 or less life loses the game.
// CR 704.5b — A player who was required to draw from an empty library since
//            the last time SBAs were checked loses (flagged via
//            Player.failedDrawFromEmptyLibrary).
// CR 704.5c — A player with ten or more poison counters loses. The bound is
//            readable off game.rules.poisonCountersToLose so 2HG-style
//            15-counter rules can opt in without a separate code path.
//
// CR 810.6b (Two-Headed Giant) — A team loses the game when its accumulated
// poison-counter total across both teammates reaches the team threshold
// (15 in standard 2HG). The threshold lives on game.rules.poisonCountersToLose
// (host-set to 15 in 2HG pods); when game.teamLife is non-null (2HG active)
// we aggregate poison per teamId and emit one playerLosesPoison action for
// every member of a team that crossed the threshold. Without aggregation,
// 2HG plays incorrectly: a team with two 8-poison teammates would not lose
// even though the team carries 16 poison total.
//
// Future extension: "you don't lose the game at 0 life" static abilities
// (Phyrexian Unlife, Worship). Handled by consulting
// game.staticEffectRegistry.byCategory("ruleChanging") — deferred to a
// rule-changing helper (future task or SP3).
import { CounterType } from "@mtg-forge-ts/core";
import type { PlayerSeat } from "@mtg-forge-ts/core";
import type { Game } from "../game.js";
import type { SbaAction } from "./sba-action.js";

export const collectLossConditions = (
  game: Game,
  out: SbaAction[],
  // Batch D2 — seats whose loss-condition SBA was prevented by a
  // replacement effect (e.g. Platinum Angel) earlier in the same sweep.
  // Skipping these seats stops the SBA loop from hot-spinning on a
  // perpetually-prevented loss; the per-sweep set is reset at the
  // start of the next sweep so removal of the Angel allows the loss to
  // proceed at the next priority pass.
  preventedThisSweep: ReadonlySet<PlayerSeat> = new Set(),
): void => {
  // M7.13e — Two-Headed Giant team-poison aggregation (CR 810.6b). When
  // the 2HG team-life pool is active, fold per-player poison counters
  // into a per-teamId total and decide each member's poison-loss against
  // the team total (not the individual count). Pre-compute here so the
  // per-player loop below stays a single sweep.
  const teamPoison = new Map<number, number>();
  if (game.teamLife !== null) {
    for (const p of game.players) {
      const poison = p.counters.get(CounterType.Poison) ?? 0;
      teamPoison.set(p.teamId, (teamPoison.get(p.teamId) ?? 0) + poison);
    }
  }

  for (const p of game.players) {
    // Skip players already marked as lost — CR 704.6 — once a player has
    // lost, no further SBAs target them. A concurrent loss for an already-
    // dead player would re-enter the apply pipeline.
    if (hasLost(game, p.seat)) continue;
    // Skip players whose loss-condition was prevented earlier in THIS
    // sweep (Platinum Angel etc.).
    if (preventedThisSweep.has(p.seat)) continue;

    if (p.life <= 0) {
      out.push({ kind: "playerLosesLifeZero", seat: p.seat });
    }

    const poison = p.counters.get(CounterType.Poison) ?? 0;
    // 2HG path: compare the team-poison total against the threshold so
    // both teammates lose when the team crosses 15 (CR 810.6b). The
    // emitted poisonCount is the team total — Forge's PlayerLost surface
    // mirrors the aggregate, not the individual contribution.
    const effectivePoison = game.teamLife !== null ? (teamPoison.get(p.teamId) ?? 0) : poison;
    if (effectivePoison >= game.rules.poisonCountersToLose) {
      out.push({ kind: "playerLosesPoison", seat: p.seat, poisonCount: effectivePoison });
    }

    if (p.failedDrawFromEmptyLibrary) {
      out.push({ kind: "playerLosesEmptyDraw", seat: p.seat });
    }
  }
};

const hasLost = (game: Game, seat: PlayerSeat): boolean => {
  // Audit I-12 — per-seat hasLost flag is the authoritative liveness
  // signal. In 2-player matches terminalState is set on the first loss;
  // in 3+ player matches terminalState is null until the last seat falls,
  // but per-seat hasLost is set as soon as the loss is recorded.
  const player = game.players.find((p) => p.seat === seat);
  if (player?.hasLost === true) return true;
  const t = game.terminalState;
  if (t === null) return false;
  // Fallback for snapshot-restored games or pre-flag terminal states.
  return t.concededSeats.includes(seat);
};
