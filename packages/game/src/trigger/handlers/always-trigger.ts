// SPDX-License-Identifier: GPL-3.0-or-later
// AlwaysTrigger — handles Forge's `T:Mode$ Always` trigger line.
//
// Forge usage examples:
//   T:Mode$ Always | TriggerZones$ Battlefield | IsPresent$ Card.Self+counters_EQ0_P1P1
//     | Execute$ TrigSac
//     | TriggerDescription$ When CARDNAME has no +1/+1 counters on it, sacrifice it.
//   T:Mode$ Always | TriggerZones$ Battlefield | IsPresent$ Swamp.YouCtrl
//     | PresentCompare$ EQ0 | Execute$ TrigSac
//     | TriggerDescription$ When you control no Swamps, sacrifice CARDNAME.
//
// Forge's Always-mode triggers are STATE-condition triggers — they
// re-evaluate their `IsPresent$` / `CheckSVar$` predicate each time the
// game's "check state-based effects + check triggers" pulse fires, and
// queue a triggered ability when the predicate transitions from false →
// true. This implementation treats `Always` as a match-all event filter
// (every non-telemetry event causes a re-check); the resolver runs the
// Execute$ SVar exactly once per matching event. Recursion is avoided by
// filtering out engine-internal telemetry events (TriggerQueued,
// TriggerResolved, ReplacementApplied, EventPrevented, etc.) so the
// trigger's own resolution does not re-fire.
//
// Wave 14b — IsPresent$ predicate is now evaluated inline. When the
// trigger AST carries `IsPresent$ <ValidCard>`, matches() consults
// game.cards (battlefield only) and returns false unless at least one
// card on the battlefield satisfies the type/qualifier filter. This
// gates state-trigger firing the way Forge does at re-evaluation time
// (CR 603.6c — state triggers re-check on every check-state pulse).
//
// Filter grammar (MVP, dot-AND of qualifiers, no comma-OR):
//   <Base>(.<Qualifier>)*
//     Bases: Card, Permanent, Creature, Artifact, Enchantment, Land,
//            Instant, Sorcery, Planeswalker, or any card SUBTYPE.
//     Qualifiers: Self, YouCtrl, OppCtrl, OpponentCtrl, tapped,
//                 untapped, White|Blue|Black|Red|Green, non<X>.
// Unknown bases or qualifiers reject conservatively so we never
// over-trigger on tokens the printed text excludes.
import type {
  AbilityAst,
  EntityId,
  GameEvent,
  GameEventKind,
  ParamValue,
  PlayerSeat,
  SVarAst,
  TriggerAst,
  TriggeredAbility,
} from "@mtg-forge-ts/core";
import { CardType, Color, ZoneType } from "@mtg-forge-ts/core";
import { SpellAbility } from "../../ability/spell-ability.js";
import type { Card } from "../../card.js";
import type { Game } from "../../game.js";
import type { StackItemResolver } from "../../stack/stack-item.js";
import { triggerHandlerRegistry } from "../trigger-handler-registry.js";
import type { TriggerBuildContext } from "../trigger-handler.js";
import { TriggerHandler } from "../trigger-handler.js";

type TriggeredAbilityWithResolver = TriggeredAbility & {
  readonly resolver: StackItemResolver | null;
};

// Engine-internal/telemetry kinds that must NOT cause an Always-trigger
// match — re-firing on TriggerQueued / TriggerResolved would create an
// infinite recursion. Mirrors ENGINE_INTERNAL_EVENT_KINDS in game.ts.
const COLOR_NAMES: ReadonlySet<string> = new Set(["White", "Blue", "Black", "Red", "Green"]);
const COLOR_BY_NAME: Readonly<Record<string, Color>> = {
  White: Color.White,
  Blue: Color.Blue,
  Black: Color.Black,
  Red: Color.Red,
  Green: Color.Green,
};

const literalRaw = (p: ParamValue | undefined): string | undefined =>
  p && p.kind === "literal" ? p.raw : undefined;

const cardHasType = (card: Card, typeName: string): boolean => {
  const def = card.paperCard.definition;
  if (!def) return false;
  const types = def.types as { has?: (t: string) => boolean; hasSubtype?: (s: string) => boolean };
  if (typeof types.has === "function" && types.has(typeName)) return true;
  if (typeof types.hasSubtype === "function" && types.hasSubtype(typeName)) return true;
  return false;
};

const cardHasColor = (card: Card, colorName: string): boolean => {
  const colorBit = COLOR_BY_NAME[colorName];
  if (colorBit === undefined) return false;
  const def = card.paperCard.definition;
  if (!def) return false;
  const colors = (def as { colors?: { has?: (c: Color) => boolean } }).colors;
  if (colors && typeof colors.has === "function" && colors.has(colorBit)) return true;
  const mc = (def as { manaCost?: { symbols?: ReadonlyArray<{ color?: Color; a?: Color; b?: Color }> } })
    .manaCost;
  if (mc && Array.isArray(mc.symbols)) {
    for (const s of mc.symbols) {
      if (s.color === colorBit) return true;
      if (s.a === colorBit || s.b === colorBit) return true;
    }
  }
  return false;
};

/**
 * Test whether `card` satisfies the dot-chained ValidCard$ alternative.
 * Returns true on match, false otherwise. Battlefield-zone scoping is the
 * caller's responsibility (we filter by `card.zone === Battlefield` before
 * dispatching here).
 */
const cardMatchesIsPresent = (
  card: Card,
  raw: string,
  controllerSeat: PlayerSeat,
  staticSourceCardId: EntityId,
): boolean => {
  const parts = raw.split(".");
  const base = parts[0] ?? "Card";
  const qualifiers = parts.slice(1);

  // Base type check.
  switch (base) {
    case "Card":
    case "Permanent":
      break; // any card / any permanent on battlefield
    case "Creature":
      if (!card.paperCard.definition?.types?.has(CardType.Creature)) return false;
      break;
    case "Artifact":
      if (!card.paperCard.definition?.types?.has(CardType.Artifact)) return false;
      break;
    case "Enchantment":
      if (!card.paperCard.definition?.types?.has(CardType.Enchantment)) return false;
      break;
    case "Land":
      if (!card.paperCard.definition?.types?.has(CardType.Land)) return false;
      break;
    case "Instant":
      if (!card.paperCard.definition?.types?.has(CardType.Instant)) return false;
      break;
    case "Sorcery":
      if (!card.paperCard.definition?.types?.has(CardType.Sorcery)) return false;
      break;
    case "Planeswalker":
      if (!card.paperCard.definition?.types?.has(CardType.Planeswalker)) return false;
      break;
    default:
      // Unknown base — try as a subtype (e.g. "Swamp", "Wizard", "Goblin").
      if (!cardHasType(card, base)) return false;
      break;
  }

  // Qualifiers (dot-chained AND).
  for (const q of qualifiers) {
    if (q === "Self") {
      if (card.id !== staticSourceCardId) return false;
      continue;
    }
    if (q === "YouCtrl") {
      if (card.controllerSeat !== controllerSeat) return false;
      continue;
    }
    if (q === "OppCtrl" || q === "OpponentCtrl") {
      if (card.controllerSeat === controllerSeat) return false;
      continue;
    }
    if (q === "tapped") {
      if (!card.tapped) return false;
      continue;
    }
    if (q === "untapped") {
      if (card.tapped) return false;
      continue;
    }
    if (COLOR_NAMES.has(q)) {
      if (!cardHasColor(card, q)) return false;
      continue;
    }
    if (q.startsWith("non") && q.length > 3) {
      const negated = q.slice(3);
      if (COLOR_NAMES.has(negated)) {
        if (cardHasColor(card, negated)) return false;
        continue;
      }
      if (cardHasType(card, negated)) return false;
      continue;
    }
    // Fall through to subtype check (".Dragon", ".Wizard", ".Swamp"…).
    if (cardHasType(card, q)) continue;
    // Unrecognised qualifier — conservative reject so we don't
    // over-trigger on cards the printed text excludes.
    return false;
  }
  return true;
};

const TELEMETRY_KINDS: ReadonlySet<GameEventKind> = new Set<GameEventKind>([
  "ReplacementApplied",
  "EventPrevented",
  "TriggerQueued",
  "TriggerResolved",
  "StateBasedActionApplied",
  "StaticAbilityRegistered",
  "StaticAbilityUnregistered",
  "ContinuousEffectRegistered",
  "ContinuousEffectExpired",
  "CostPaid",
  "PhaseStepEnded",
]);

export class AlwaysTrigger extends TriggerHandler {
  static override readonly mode = "Always";

  override build(ast: TriggerAst, ctx: TriggerBuildContext): TriggeredAbility {
    const { sourceCardId, controllerSeat, triggerId, game } = ctx;
    const executeKey = ast.effect.handlerKey;
    // IsPresent$ predicate — when set, matches() requires at least one
    // card on the battlefield to satisfy the filter. Forge typically
    // pairs Always-mode triggers with IsPresent$ to model state-change
    // gates ("when you control no Swamps, …"). Absent IsPresent$, the
    // trigger fires on every non-telemetry pulse (legacy behaviour).
    const isPresentRaw = literalRaw(ast.params.IsPresent);

    const ta: TriggeredAbilityWithResolver = {
      id: triggerId,
      kind: "triggered",
      sourceCardId,
      activeInZones: new Set([ZoneType.Battlefield, ZoneType.Command]),
      timestamp: 0,
      controllerSeatAtReg: controllerSeat,
      isDelayed: false,

      matches(event: GameEvent): boolean {
        // Telemetry events never re-trigger Always — guards against
        // infinite recursion when this trigger's own resolution emits
        // engine-internal markers.
        if (TELEMETRY_KINDS.has(event.kind)) return false;
        // IsPresent$ predicate — when set, gate firing on at least one
        // battlefield card matching the filter. Without IsPresent$ the
        // trigger fires on every non-telemetry event (legacy default).
        if (isPresentRaw !== undefined) {
          let found = false;
          for (const card of game.cards.values()) {
            if (card.zone !== ZoneType.Battlefield) continue;
            if (cardMatchesIsPresent(card, isPresentRaw, controllerSeat, sourceCardId)) {
              found = true;
              break;
            }
          }
          if (!found) return false;
        }
        return true;
      },

      resolver: {
        *resolve(gameUnknown: unknown): Generator<unknown, void, unknown> {
          const resolveGame = gameUnknown as Game;
          const sourceCard = resolveGame.cards.get(sourceCardId);
          if (!sourceCard) return;
          const def = sourceCard.paperCard.definition;
          if (!def) return;
          const svars = def.svars as ReadonlyMap<string, SVarAst>;
          const sv = svars.get(executeKey);
          if (!sv) {
            throw new Error(
              `AlwaysTrigger: Execute$ SVar '${executeKey}' not found on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          if (sv.kind !== "ability" || !sv.ability) {
            throw new Error(
              `AlwaysTrigger: Execute$ '${executeKey}' is not an ability SVar on ${sourceCard.paperCard.name ?? "?"}`,
            );
          }
          const fakeAst: AbilityAst = {
            kind: "spell",
            effect: sv.ability,
            cost: { raw: "" },
          };
          const sa = new SpellAbility(fakeAst, sourceCardId, controllerSeat, svars, []);
          const innerResolver = sa.makeResolver();
          yield* innerResolver.resolve(resolveGame);
        },
      },
    };

    return ta as unknown as TriggeredAbility;
  }
}

triggerHandlerRegistry.register(AlwaysTrigger);
