// SPDX-License-Identifier: GPL-3.0-or-later
// CipherKeywordHandler — processes K:Cipher keyword lines (Gatecrash,
// CR 702.97). Synthesizes two TriggeredAbilities:
//   1. Cast trigger (Stack-zone): when this is cast, exile-and-encode self
//      onto a creature you control. (For MVP we leave the spell in its
//      normal post-resolution path and stamp the link slots — full Forge
//      "encode on a creature" semantics defer the actual exile-on-encode
//      step.)
//   2. Combat-damage-to-player trigger on the encoded creature: when the
//      encoded creature deals combat damage to a player, controller may
//      cast a copy of the ciphered card without paying its mana cost.
//
// CR 702.97a — "Cipher" — "Then you may exile this spell card encoded on
// a creature you control. Whenever that creature deals combat damage to
// a player, its controller may cast a copy of the encoded card without
// paying its mana cost."
//
// MVP scope (link semantics):
//   - The cast trigger yields a chooseCard over creatures the controller
//     controls. On chosen, stamp `card.cipherEncodedOnId = chosen` and
//     `chosenCard.cipherEncodedHere = sourceCardId`.
//   - The damage trigger watches DamageDealt where sourceId is the
//     encoded creature, isCombat=true, and targetKind="player". On
//     resolve, yield a confirmAction; on confirm, run a free-cast pipeline
//     of the ciphered card.
//
// Wave 113 — Cipher's "exile encoded on creature" (CR 702.97b) is now
// closed. effect-resolve.ts checks `source.cipherEncodedOnId !==
// undefined` post-resolution and redirects the destination from
// Graveyard to Exile when the cipher cast trigger established the
// encode link. The damage-trigger free-cast loop continues to read
// the encoded link via `cipherEncodedHere` on the creature.
import {
  CardType,
  type EntityId,
  type GameEvent,
  type KeywordAst,
  type TriggeredAbility,
  ZoneType,
} from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { keywordHandlerRegistry } from "../keyword-handler-registry.js";
import type { KeywordActivationContext } from "../keyword-handler.js";
import { KeywordHandler } from "../keyword-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

export class CipherKeywordHandler extends KeywordHandler {
  static override readonly keyword = "cipher" as const;

  override activate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    if (!card) return;

    if (!card.keywords) card.keywords = new Set();
    card.keywords.add("cipher");

    const game = ctx.game;
    const sourceCardId = ctx.sourceCardId;
    const controllerSeat = ctx.controllerSeat;

    // 1. Cast trigger — encode self on a creature.
    const castId = game.newEntityId();
    const castTrigger: TriggeredAbilityWithResolver = {
      id: castId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Stack]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "SpellCast") return false;
        const p = event.payload as { readonly cardId: EntityId };
        return p.cardId === sourceCardId;
      },
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const filtered: EntityId[] = [];
          for (const [id, c] of g.cards) {
            if (id === sourceCardId) continue;
            if (c.controllerSeat !== controllerSeat) continue;
            if (c.zone !== ZoneType.Battlefield) continue;
            const chars = g.layerEngine.computeCharacteristics(id);
            if (!chars.types.has(CardType.Creature)) continue;
            filtered.push(id);
          }
          if (filtered.length === 0) return;

          // Wave 61.E — CR 702.97a "Then you MAY exile this spell card
          // encoded on a creature you control." First yield a confirm
          // so the controller can decline encoding entirely.
          const confirmResp = yield {
            kind: "decision",
            request: {
              kind: "confirmAction",
              sourceId: sourceCardId,
              prompt: "Encode this spell on a creature you control?",
            },
          };
          const confirm = confirmResp as { kind: string; confirmed?: boolean } | undefined;
          if (!confirm || confirm.kind !== "confirmAction" || confirm.confirmed !== true) return;

          // Wave 61.E — yield chooseCard so the controller picks which
          // creature to encode on. Validates the response is one of the
          // eligible ids; falls back to the first eligible on empty/
          // invalid response (CR 700.2 graceful-fizzle parity).
          const decision = yield {
            kind: "decision",
            request: {
              kind: "chooseCard",
              playerSeat: controllerSeat,
              pool: filtered,
              restriction: { keyword: "cipher" },
              min: 1,
              max: 1,
            },
          };
          const r = decision as { kind: string; chosen?: readonly EntityId[] } | undefined;
          let targetId: EntityId | undefined;
          if (r && r.kind === "chooseCard" && r.chosen && r.chosen.length === 1) {
            const picked = r.chosen[0];
            if (picked !== undefined && filtered.includes(picked)) targetId = picked;
          }
          if (targetId === undefined) targetId = filtered[0];
          if (targetId === undefined) return;

          const self = g.cards.get(sourceCardId);
          const target = g.cards.get(targetId);
          if (!self || !target) return;
          self.cipherEncodedOnId = targetId;
          target.cipherEncodedHere = sourceCardId;
        },
      },
    };
    if (!card.triggeredAbilities) card.triggeredAbilities = [];
    card.triggeredAbilities.push(castTrigger as unknown as TriggeredAbility);
    game.triggerRegistry.register(castTrigger as unknown as TriggeredAbility);

    // 2. Damage trigger — when the encoded creature deals combat damage
    //    to a player, may cast a free copy of the ciphered card.
    const dmgId = game.newEntityId();
    const dmgTrigger: TriggeredAbilityWithResolver = {
      id: dmgId,
      kind: "triggered",
      sourceCardId,
      // The trigger lives wherever the cipher card lives post-cast — for
      // MVP the card sits in graveyard / exile after resolution. The
      // matcher is global on the encoded creature. We register without a
      // specific zone constraint, mirroring rebound's exile-zone trigger.
      activeInZones: new Set([ZoneType.Graveyard, ZoneType.Exile, ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,
      matches(event: GameEvent): boolean {
        if (event.kind !== "DamageDealt") return false;
        const p = event.payload as {
          sourceId?: EntityId;
          targetKind?: "creature" | "player" | "planeswalker" | "battle";
          isCombat?: boolean;
        };
        if (p.targetKind !== "player") return false;
        if (p.isCombat !== true) return false;
        const self = game.cards.get(sourceCardId);
        if (!self) return false;
        const encoded = self.cipherEncodedOnId;
        if (encoded === undefined) return false;
        return p.sourceId === encoded;
      },
      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const g = gameUnknown as Game;
          const self = g.cards.get(sourceCardId);
          if (!self) return;

          const response = (yield {
            kind: "decision",
            request: {
              kind: "confirmAction",
              sourceId: sourceCardId,
              prompt: "Cast a copy of the ciphered card without paying its mana cost?",
            },
          }) as { readonly kind: "confirmAction"; readonly confirmed: boolean } | undefined;
          if (response?.confirmed !== true) return;

          // Wave 64 — route through the unified castCopyOf helper. CR
          // 702.97a: the controller may cast a COPY of the encoded card
          // without paying its mana cost. CR 706.10b lets the copying
          // player choose new targets, so newTargets: true. freecast
          // is true (copies never re-pay).
          yield* g.action.castCopyOf(sourceCardId, {
            controllerSeat,
            newTargets: true,
            freecast: true,
          });
        },
      },
    };
    card.triggeredAbilities.push(dmgTrigger as unknown as TriggeredAbility);
    game.triggerRegistry.register(dmgTrigger as unknown as TriggeredAbility);
  }

  override deactivate(_ast: KeywordAst, ctx: KeywordActivationContext): void {
    const card = ctx.game.cards.get(ctx.sourceCardId);
    card?.keywords?.delete("cipher");
  }
}

keywordHandlerRegistry.register(CipherKeywordHandler);
