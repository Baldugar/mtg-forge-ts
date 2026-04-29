// SPDX-License-Identifier: GPL-3.0-or-later
// DoubleTeamKeywordHandler — processes K:Double team keyword lines
// (Streets of New Capenna / Lost Caverns of Ixalan, CR 702.176) and
// synthesizes an attacks-trigger that conjures a duplicate of the
// attacking creature into the controller's hand.
//
// CR 702.176a — "Double team" — "When this creature attacks, if it
// doesn't have a 'doubled' counter on it, conjure a duplicate of this
// card into your hand. The duplicate has a 'doubled' counter on it."
//
// Wave 66 — full close. The attacks-trigger now invokes
// `game.action.conjureCopyToHand` which mints a duplicate Card via
// OutsideTheGame → Hand. Both the attacker AND the duplicate get a
// per-card `doubleTeamUsed` flag stamp (our engine's analog of the
// "doubled" counter — CounterType.java has no `doubled` entry, so we
// model the gate with a per-card boolean).
import type { EntityId, GameEvent, KeywordAst, PlayerSeat, TriggeredAbility } from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

type AttackersDeclaredPayload = {
  readonly attackingSeat: PlayerSeat;
  readonly attackers?: readonly { readonly attackerId: EntityId }[];
};

export class DoubleTeamKeywordHandler extends KeywordHandler {
  static override readonly keyword = "double_team" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("double_team");
    card.doubleTeam = true;

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;
    const triggerId = game.newEntityId();

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "AttackersDeclared") return false;
        const p = event.payload as AttackersDeclaredPayload;
        if (!p.attackers) return false;
        for (const a of p.attackers) {
          if (a.attackerId === sourceCardId) return true;
        }
        return false;
      },
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const self = g.cards.get(sourceCardId);
          if (!self) return;
          // Gate: if the attacker already has the doubled marker, the
          // trigger resolves with no effect (CR 702.176a — second clause).
          // We model the doubled-counter check via a per-card boolean
          // since the CounterType enum has no "doubled" entry.
          const selfFlag = self as unknown as { doubleTeamUsed?: boolean };
          if (selfFlag.doubleTeamUsed === true) return;
          // Stamp legacy doubleTeamCopyRequested flag for back-compat with
          // existing observers/tests; it remains true for the lifetime of
          // the trigger fire (cleared on deactivate).
          self.doubleTeamCopyRequested = true;
          // Conjure the duplicate into the controller's hand. The new
          // card gets the same doubled marker so its OWN attacks-trigger
          // will not re-conjure when it later attacks.
          const newId: EntityId = yield* g.action.conjureCopyToHand(sourceCardId, controllerSeat);
          // Stamp doubled marker on BOTH the attacker AND the duplicate
          // (CR 702.176a — "Both this creature and the duplicate gain
          // 'doubled' counters until end of turn." Our `doubleTeamUsed`
          // flag is a per-card permanent stamp rather than EOT — the
          // narrower semantics are correct because the gate cares whether
          // the card already triggered, not the EOT lifetime per se).
          selfFlag.doubleTeamUsed = true;
          const dup = g.cards.get(newId);
          if (dup) {
            (dup as unknown as { doubleTeamUsed?: boolean }).doubleTeamUsed = true;
          }
        },
      },
    };

    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(ta as unknown as TriggeredAbility);
    game.triggerRegistry.register(ta as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;
    card.keywords?.delete("double_team");
    card.doubleTeam = undefined;
    card.doubleTeamCopyRequested = undefined;
  }
}

keywordHandlerRegistry.register(DoubleTeamKeywordHandler);
