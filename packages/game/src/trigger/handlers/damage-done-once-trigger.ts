// SPDX-License-Identifier: GPL-3.0-or-later
// DamageDoneOnceTrigger — handles Forge's `T:Mode$ DamageDoneOnce` trigger line.
//
// Wave 12B — once-per-turn fire guard.
// Real Forge fires "DamageDoneOnce" once per damage MAP (one trigger per
// step, even when many simultaneous hits). Our event model emits one
// DamageDealt event per assignment, so without a guard the trigger would
// fire repeatedly. The Wave 12 directive specifies once-per-turn semantics
// — we implement exactly that: the trigger matches once per `game.turn`
// then suppresses subsequent matches until the turn advances.
//
// Forge pattern:
//   T:Mode$ DamageDoneOnce | ValidSource$ Card.Self | ValidTarget$ Player
//     | Execute$ TrigOnce | TriggerDescription$ The first time this deals damage each turn, ...
//
// Supported ValidSource$: Card.Self, Card.
// Supported ValidTarget$: Player, Creature, Any, You, Opponent.
// CombatDamage$: True / False / absent.
import type {
  AbilityAst,
  EntityId,
  GameEvent,
  PlayerSeat,
  SVarAst,
  TriggerAst,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { TriggerHandler } from "../trigger-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

const getParamRaw = (ast: TriggerAst, key: string): string | undefined => {
  const pv = ast.params[key];
  if (!pv) return undefined;
  if (pv.kind === "literal") return pv.raw;
  return undefined;
};

// ---------------------------------------------------------------------------
// DamageDoneOnceTrigger
// ---------------------------------------------------------------------------

export class DamageDoneOnceTrigger extends TriggerHandler {
  // Registry key matches the Forge DSL mode name.
  static override readonly mode = "DamageDoneOnce";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const validSourceRaw = getParamRaw(ast, "ValidSource") ?? "Card.Self";
    const validTargetRaw = getParamRaw(ast, "ValidTarget") ?? "Any";
    const combatDamageRaw = getParamRaw(ast, "CombatDamage");
    const { game: ctxGame, sourceCardId, controllerSeat, triggerId } = ctx;
    const executeKey = ast.effect.handlerKey;

    // Wave 12B — once-per-turn guard. Closure-private fired-state. Reads
    // `game.turn` from the live game ref captured at build time. Tests that
    // pass a stub `{} as never` will see undefined turn and skip the guard
    // (the trigger then matches every event, the legacy MVP behavior).
    let lastFiredOnTurn: number | undefined;
    const currentTurn = (): number | undefined => {
      const g = ctxGame as { turn?: unknown } | undefined;
      const t = g?.turn;
      return typeof t === "number" ? t : undefined;
    };

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      // Once-per-turn matching: when the basic predicate is satisfied AND
      // the trigger has already fired this turn, return false. On a true
      // return, mark the current turn as "fired" so subsequent matching
      // events in the same turn are suppressed until `game.turn` advances.
      matches(event: GameEvent): boolean {
        if (event.kind !== "DamageDealt") return false;
        const { sourceId, targetKind, targetId, isCombat } = event.payload as {
          sourceId: EntityId;
          targetKind: "creature" | "player" | "planeswalker" | "battle";
          targetId: EntityId | PlayerSeat;
          amount: number;
          isCombat: boolean;
        };

        if (combatDamageRaw === "True" && !isCombat) return false;
        if (combatDamageRaw === "False" && isCombat) return false;

        if (validSourceRaw === "Card.Self") {
          if (sourceId !== sourceCardId) return false;
        } else if (validSourceRaw === "Card") {
          // Any source — no restriction.
        } else {
          return false;
        }

        let predicateOk = false;
        if (validTargetRaw === "Any") predicateOk = true;
        else if (validTargetRaw === "Player") predicateOk = targetKind === "player";
        else if (validTargetRaw === "Creature") predicateOk = targetKind === "creature";
        else if (validTargetRaw === "You")
          predicateOk = targetKind === "player" && targetId === controllerSeat;
        else if (validTargetRaw === "Opponent")
          predicateOk = targetKind === "player" && targetId !== controllerSeat;
        if (!predicateOk) return false;

        // Once-per-turn gate.
        const turn = currentTurn();
        if (turn !== undefined) {
          if (lastFiredOnTurn === turn) return false;
          lastFiredOnTurn = turn;
        }
        return true;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const game = gameUnknown as Game;
          const sourceCard = game.cards.get(sourceCardId);
          if (!sourceCard) return;
          const def = sourceCard.paperCard.definition;
          if (!def) return;
          const svars = def.svars as ReadonlyMap<string, SVarAst>;
          const sv = svars.get(executeKey);
          if (!sv) {
            throw new Error(
              `DamageDoneOnceTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `DamageDoneOnceTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          const fakeAst: AbilityAst = {
            kind: "spell",
            effect: sv.ability,
            cost: { raw: "" },
          };
          const sa = new SpellAbility(fakeAst, sourceCardId, controllerSeat, svars, []);
          const innerResolver = sa.makeResolver();
          yield* innerResolver.resolve(game);
        },
      },
    };

    return ta as unknown as TriggeredAbility;
  }
}

triggerHandlerRegistry.register(DamageDoneOnceTrigger);

// Wave 12D — Forge corpus also uses the spelling "DamageDealtOnce" (e.g.
// Delirium triggers, attach-aura damage life-gain). Register an alias
// constructor that produces a DamageDoneOnceTrigger instance under the
// alternate mode string. We can't subclass and override the static `mode`
// type literal (TS narrows it on the parent), so we hand-roll the ctor
// shape that triggerHandlerRegistry expects.
export class DamageDealtOnceTrigger extends DamageDoneOnceTrigger {}
// Registry register() reads the static `mode` field; assign at runtime to
// avoid the TS literal-narrowing error on subclass redeclaration.
(DamageDealtOnceTrigger as unknown as { mode: string }).mode = "DamageDealtOnce";
triggerHandlerRegistry.register(DamageDealtOnceTrigger as unknown as typeof DamageDoneOnceTrigger);
