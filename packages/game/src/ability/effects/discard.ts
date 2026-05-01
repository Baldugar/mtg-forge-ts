// SPDX-License-Identifier: GPL-3.0-or-later
// DiscardEffect — discards N cards from the controller's (or target's) hand.
//
// Wave 53 broadens the MVP. Forge supports several Mode$ flavours:
//   - Mode$ Hand            (default)  — controller picks N (MVP: front of hand).
//   - Mode$ Random          — controller picks N uniformly at random
//                             (using game.rng for determinism).
//   - Mode$ TgtChoose       — discard a card the targeted player chooses
//                             (Wave 63.A: yields chooseCard to the
//                             discarder; falls back to first N on invalid).
//   - Mode$ RevealYouChoose — target reveals N, then attacker (sa.controller)
//                             picks one to discard (MVP: pick the first
//                             revealed card; revealed event is emitted).
//   - Mode$ Defined         — discard the cards listed in DefinedCards$
//                             (Wave 63.A: literal card-id list applied).
//
// NumCards$ accepts SVar so X-cost discard ("each opponent discards X") works.
// Defined$ resolves the discarder when sa.targets is empty.
import type { DecisionResponse, EntityId, PlayerSeat } from "@mtg-forge-ts/core";
import { ZoneType, mkEvent, mkPlayerSeat } from "@mtg-forge-ts/core";
import type { EngineYield } from "../../action/engine-yield.js";
import type { Game } from "../../game.js";
import { effectRegistry } from "../effect-registry.js";
import { evaluateParamNumber, evaluateParamRaw, hasParam } from "../evaluate-param.js";
import { SpellAbilityEffect } from "../spell-ability-effect.js";
import type { SpellAbility } from "../spell-ability.js";

const resolveDiscarderSeat = (sa: SpellAbility): PlayerSeat => {
  if (sa.targets.length > 0) return sa.targets[0] as unknown as PlayerSeat;
  if (!sa.ast.effect.params.Defined) return sa.controllerSeat;
  const tok = (sa.ast.effect.params.Defined as { kind: "literal"; raw: string }).raw.trim();
  if (tok === "Player.Opponent" || tok === "Opponent") {
    const n = sa.controllerSeat as unknown as number;
    return mkPlayerSeat(n === 0 ? 1 : 0);
  }
  return sa.controllerSeat;
};

export class DiscardEffect extends SpellAbilityEffect {
  static override readonly handlerKey = "Discard";
  override *resolve(sa: SpellAbility, game: Game): Generator<EngineYield, void, unknown> {
    const n = hasParam(sa, "NumCards") ? evaluateParamNumber(sa, "NumCards", game) : 1;
    const seat = resolveDiscarderSeat(sa);
    const player = game.getPlayer(seat);
    const hand = player.zones.get(ZoneType.Hand);
    if (!hand) return;
    const handCards = hand.toArray();
    if (handCards.length === 0) return;

    const mode = hasParam(sa, "Mode") ? evaluateParamRaw(sa, "Mode").trim() : "Hand";

    let toDiscard: readonly EntityId[];
    switch (mode) {
      case "Random": {
        // Pick N distinct cards uniformly at random, using the deterministic
        // game RNG so transcripts replay identically.
        const pool = [...handCards];
        const picked: EntityId[] = [];
        const limit = Math.min(n, pool.length);
        for (let i = 0; i < limit; i++) {
          const idx = game.rng.nextInt(0, pool.length);
          const id = pool.splice(idx, 1)[0];
          if (id !== undefined) picked.push(id);
        }
        toDiscard = picked;
        break;
      }
      case "RevealYouChoose": {
        // MVP: emit a CardsRevealed for the (up to N) reveals, then take
        // the first revealed card. Decision-driven selection of which N to
        // reveal and which to discard is wired in Wave 56+.
        const revealed = handCards.slice(0, Math.min(n, handCards.length));
        if (revealed.length > 0) {
          yield game.emitEvent(
            mkEvent("CardsRevealed", game.turn, game.phase, {
              revealedBy: seat,
              revealedTo: "all",
              cardIds: revealed,
              fromZone: ZoneType.Hand,
            }),
          );
        }
        // Attacker chooses; MVP picks the first.
        toDiscard = revealed.slice(0, 1);
        break;
      }
      case "Defined": {
        // Wave 63.A — literal id list via DefinedCards$. Forge usually emits
        // this with a token list (e.g. RememberedCards, TargetedCard); we
        // honour an explicit comma-separated EntityId list here. Each id
        // must be present in the discarder's hand; unknown ids are filtered.
        //
        // Wave 85 — resolves the token forms RememberedCards / TargetedCard
        // alongside the literal-id form. RememberedCards expands to the
        // source card's `remembered` array (the canonical scratch buffer
        // populated by SP$ Reveal / SP$ Dig / SP$ ChooseCard etc.).
        // TargetedCard expands to the SA's `targets` (the resolved
        // ValidTgts$). Both expansions are intersected with `handCards`
        // so any id outside the discarder's hand is dropped (matches the
        // literal-id branch's invariant).
        const definedRaw = hasParam(sa, "DefinedCards") ? evaluateParamRaw(sa, "DefinedCards") : "";
        const handSet = new Set(handCards);
        const ids: EntityId[] = [];
        for (const tok of definedRaw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s !== "")) {
          if (tok === "RememberedCards" || tok === "Remembered") {
            const source = game.cards.get(sa.sourceCardId);
            if (!source) continue;
            for (const r of source.remembered) {
              if (typeof r === "number" && handSet.has(r as unknown as EntityId)) {
                ids.push(r as unknown as EntityId);
              }
            }
            continue;
          }
          if (tok === "TargetedCard" || tok === "Targeted") {
            for (const t of sa.targets) {
              if (handSet.has(t)) ids.push(t);
            }
            continue;
          }
          const num = Number.parseInt(tok, 10);
          if (!Number.isFinite(num)) continue;
          const candidate = num as unknown as EntityId;
          if (handSet.has(candidate)) ids.push(candidate);
        }
        toDiscard = ids;
        break;
      }
      case "TgtChoose": {
        // Wave 63.A — yield chooseCard to the discarder so they pick which
        // card(s) to discard. The min/max equal the requested N (capped to
        // hand size). On invalid response (wrong shape, wrong size, or any
        // chosen id not in hand) we fall back to the front of the hand,
        // matching the prior MVP convention.
        const want = Math.min(n, handCards.length);
        if (want <= 0) {
          toDiscard = [];
          break;
        }
        const rawResponse = yield {
          kind: "decision",
          request: {
            kind: "chooseCard",
            playerSeat: seat,
            pool: handCards,
            restriction: { effect: "Discard", mode: "TgtChoose" },
            min: want,
            max: want,
          },
        };
        const response = rawResponse as DecisionResponse | undefined;
        let picked: readonly EntityId[] | undefined;
        if (response && response.kind === "chooseCard") {
          const chosen = response.chosen;
          if (chosen.length === want) {
            const handSet = new Set(handCards);
            const seen = new Set<EntityId>();
            let ok = true;
            for (const id of chosen) {
              if (!handSet.has(id) || seen.has(id)) {
                ok = false;
                break;
              }
              seen.add(id);
            }
            if (ok) picked = chosen.slice();
          }
        }
        toDiscard = picked ?? handCards.slice(0, want);
        break;
      }
      // case "Hand" or any other → discarder picks. Wave 90 — yield
      // chooseCard so the discarder actually picks which card(s) to
      // discard (mirrors TgtChoose with mode "Hand"). On invalid
      // responses we fall back to the front of the hand (the legacy
      // MVP convention) so test paths without a decision driver still
      // produce a deterministic result.
      default: {
        const want = Math.min(n, handCards.length);
        if (want <= 0) {
          toDiscard = [];
          break;
        }
        const rawResponse = yield {
          kind: "decision",
          request: {
            kind: "chooseCard",
            playerSeat: seat,
            pool: handCards,
            restriction: { effect: "Discard", mode: "Hand" },
            min: want,
            max: want,
          },
        };
        const response = rawResponse as DecisionResponse | undefined;
        let picked: readonly EntityId[] | undefined;
        if (response && response.kind === "chooseCard") {
          const chosen = response.chosen;
          if (chosen.length === want) {
            const handSet = new Set(handCards);
            const seen = new Set<EntityId>();
            let ok = true;
            for (const id of chosen) {
              if (!handSet.has(id) || seen.has(id)) {
                ok = false;
                break;
              }
              seen.add(id);
            }
            if (ok) picked = chosen.slice();
          }
        }
        toDiscard = picked ?? handCards.slice(0, want);
        break;
      }
    }

    for (const cardId of toDiscard) {
      yield* game.action.moveTo(cardId, ZoneType.Graveyard, { toSeat: seat, cause: "discard" });
    }
  }
}

effectRegistry.register(DiscardEffect);
