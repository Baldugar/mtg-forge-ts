// SPDX-License-Identifier: GPL-3.0-or-later
// GameLossReplacement — handles Forge's `R:Event$ GameLoss` replacement line.
// Intercepts a "player loses the game" mutation intent and can prevent it
// (Platinum Angel: "You can't lose the game"; Phyrexian Unlife transitions)
// or REDIRECT it to a different ability (Exquisite Archangel: "instead
// exile CARDNAME and your life total becomes equal to your starting life").
//
// Forge patterns:
//   R:Event$ GameLoss | ActiveZones$ Battlefield | ValidPlayer$ You | Layer$ CantHappen
//     | Description$ You can't lose the game and your opponents can't win the game.
//   R:Event$ GameLoss | ActiveZones$ Battlefield | ValidPlayer$ You | ReplaceWith$ ExileSetLife
//     | Description$ If you would lose the game, instead exile CARDNAME and reset life.
//   SVar:ExileSetLife:DB$ ChangeZone | Origin$ Battlefield | Destination$ Exile
//     | Defined$ Self | SubAbility$ DBSetLife
//   SVar:DBSetLife:DB$ SetLife | Defined$ You | LifeAmount$ X
//   SVar:X:Count$YourStartingLife
//
// MVP support:
//   ValidPlayer$ You      — match when the losing seat equals controllerSeat.
//   ValidPlayer$ Opponent — match when the losing seat differs from controllerSeat.
//   ValidPlayer$ Each / Player — match any seat.
//   Layer$ CantHappen     — apply() returns null (loss prevented).
//   Prevent$ True         — apply() returns null (loss prevented).
//   ReplaceWith$ <SVar>   — Wave 14b: walk the SVar's ability AST and the
//                            chained SubAbility$ stubs, performing the
//                            canonical Exquisite Archangel pattern:
//                              DB$ ChangeZone Battlefield → Exile Defined$ Self
//                              DB$ SetLife Defined$ You LifeAmount$ X
//                                where X = Count$YourStartingLife
//                            On the recognised pattern we directly mutate
//                            the source card's zone and the controller's
//                            life so the loss is prevented and the
//                            "instead" effect resolves atomically. Other
//                            ReplaceWith$ shapes fall back to no-op
//                            redirect (canonical loss proceeds).
import type {
  EffectInvocation,
  EntityId,
  MutationIntent,
  ParamValue,
  PlayerSeat,
  ReplacementAbility,
  ReplacementAst,
  SVarAst,
} from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import { replacementHandlerRegistry } from "../replacement-handler-registry.js";
import type { ReplacementBuildContext } from "../replacement-handler.js";
import { ReplacementHandler } from "../replacement-handler.js";

const getParamRaw = (ast: ReplacementAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

const literalRaw = (p: ParamValue | undefined): string | undefined =>
  p && p.kind === "literal" ? p.raw : undefined;

/**
 * Walk the source card's SVar map for `key`, returning the parsed ability
 * EffectInvocation if present, or null.
 */
const lookupAbilitySVar = (game: Game, sourceCardId: EntityId, key: string): EffectInvocation | null => {
  const card = game.cards.get(sourceCardId);
  const def = card?.paperCard?.definition;
  if (!def) return null;
  const svars = def.svars as ReadonlyMap<string, SVarAst> | undefined;
  if (!svars) return null;
  const sv = svars.get(key);
  if (!sv || sv.kind !== "ability" || !sv.ability) return null;
  return sv.ability;
};

/**
 * Resolve the Exquisite Archangel canonical SVar pattern. On recognition
 * (ChangeZone Self → Exile, then SetLife You X with X=Count$YourStartingLife)
 * we mutate game state directly: move the source card to the shared Exile
 * zone and reset the controller's life to startingLife. Returns true when
 * the pattern fired so the caller knows to prevent the loss.
 */
const tryRunReplaceWith = (
  game: Game,
  sourceCardId: EntityId,
  controllerSeat: PlayerSeat,
  topAbility: EffectInvocation,
): boolean => {
  // Walk the chain: top → subAbility → … and execute recognised handlers.
  let didChangeZone = false;
  let didSetLife = false;
  let cur: EffectInvocation | undefined = topAbility;
  while (cur) {
    const handler = cur.handlerKey;
    const params = cur.params;
    if (handler === "ChangeZone") {
      const origin = literalRaw(params.Origin);
      const dest = literalRaw(params.Destination);
      const defined = literalRaw(params.Defined);
      // Only the "exile self from battlefield" shape is recognised here.
      if (origin === "Battlefield" && dest === "Exile" && defined === "Self") {
        const card = game.cards.get(sourceCardId);
        if (card && card.zone === ZoneType.Battlefield) {
          // Direct mutation — replacements run synchronously inside the
          // apply loop and cannot yield to the engine. We move the card
          // out of its current zone container and into the shared Exile,
          // mirroring what GameAction.moveTo does on the zone-change
          // happy path (without re-routing through replacements: the
          // outer loss replacement IS the redirect).
          const ownerSeat = card.ownerSeat;
          const fromZone = game.getPlayer(ownerSeat).zones.get(ZoneType.Battlefield);
          fromZone?.remove(sourceCardId);
          game.sharedZones.exile.add(sourceCardId);
          card.zone = ZoneType.Exile;
          // Battlefield-only state must reset on exit.
          if (card.tapped) card.tapped = false;
          if (card.phased) card.phased = false;
          // CR 613.1 — zone change alters layered effects.
          game.layerEngine.bumpEpoch("gameLoss-replaceWith-exile");
          didChangeZone = true;
        }
      }
    } else if (handler === "SetLife") {
      const defined = literalRaw(params.Defined);
      const lifeAmountRaw = literalRaw(params.LifeAmount);
      // Defined$ You (the replacement's controller) is the only target
      // we resolve here — Exquisite Archangel restores the player about
      // to lose the game. LifeAmount$ X is dereferenced to Count$
      // YourStartingLife → game.rules.startingLife. Any other expression
      // (numeric literal, other Count$ formulas) is deferred — we only
      // commit on a fully recognised shape so we never half-apply.
      if (defined === "You") {
        let target: number | null = null;
        if (lifeAmountRaw !== undefined) {
          // Numeric literal first.
          const n = Number.parseInt(lifeAmountRaw, 10);
          if (Number.isFinite(n) && /^-?\d+$/.test(lifeAmountRaw)) {
            target = n;
          } else {
            // SVar lookup — Forge writes `LifeAmount$ X` and stores the
            // formula in SVar:X. Recognise the canonical
            // Count$YourStartingLife shape used by Exquisite Archangel.
            const card = game.cards.get(sourceCardId);
            const svars = card?.paperCard?.definition?.svars as ReadonlyMap<string, SVarAst> | undefined;
            const inner = svars?.get(lifeAmountRaw);
            if (inner && inner.kind === "value" && inner.raw === "Count$YourStartingLife") {
              target = game.rules.startingLife;
            }
          }
        }
        if (target !== null) {
          const player = game.getPlayer(controllerSeat);
          player.life = target;
          didSetLife = true;
        }
      }
    }
    cur = cur.subAbility;
  }
  // Only declare success when both legs of the canonical pattern fired —
  // half-resolution would leave the player exiled but still at 0 life
  // (and SBA would re-trigger the loss on the next sweep).
  return didChangeZone && didSetLife;
};

export class GameLossReplacement extends ReplacementHandler {
  static override readonly eventKind = "GameLoss";

  override build(ast: ReplacementAst, ctx: ReplacementBuildContext): ReplacementAbility {
    const validPlayerRaw = getParamRaw(ast, "ValidPlayer") ?? "Player";
    const layerParam = getParamRaw(ast, "Layer");
    const preventParam = getParamRaw(ast, "Prevent");
    const replaceWithKey = getParamRaw(ast, "ReplaceWith");
    const { sourceCardId, controllerSeat, replacementId } = ctx;

    return {
      id: replacementId,
      kind: "replacement",
      sourceCardId,
      activeInZones: new Set(["Battlefield" as never]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isSelfReplacement: ast.isSelf === true,
      // Layer$ CantHappen → cantHappen layer (highest priority replacement
      // class — runs before redirect/modify replacements).
      layer: layerParam === "CantHappen" ? "cantHappen" : "other",

      matches(intent: MutationIntent): boolean {
        if (intent.kind !== "gameLoss") return false;
        const losingSeat = (intent as { seat?: PlayerSeat }).seat;
        if (losingSeat === undefined) return false;
        if (validPlayerRaw === "You") return losingSeat === controllerSeat;
        if (validPlayerRaw === "Opponent") return losingSeat !== controllerSeat;
        if (validPlayerRaw === "Each" || validPlayerRaw === "Player") return true;
        return false;
      },

      apply(intent: MutationIntent, gameUnknown: unknown): MutationIntent | null {
        // Layer$ CantHappen or Prevent$ True → prevent loss entirely.
        if (layerParam === "CantHappen" || preventParam === "True") return null;
        // ReplaceWith$ <SVar> — Exquisite Archangel redirects the loss
        // to an exile-and-reset-life ability. Look up the SVar and
        // execute its recognised pattern; on success return null so the
        // canonical loss is fully replaced. On unrecognised SVar shape
        // fall back to no-op so we don't strand the player in an
        // inconsistent state.
        if (replaceWithKey !== undefined) {
          const game = gameUnknown as Game;
          const ability = lookupAbilitySVar(game, sourceCardId, replaceWithKey);
          if (ability && tryRunReplaceWith(game, sourceCardId, controllerSeat, ability)) {
            return null;
          }
        }
        // No matching layer/prevent/replaceWith dispatched — the canonical
        // loss proceeds unchanged.
        return intent;
      },
    };
  }
}

replacementHandlerRegistry.register(GameLossReplacement);
