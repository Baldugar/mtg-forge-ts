// SPDX-License-Identifier: GPL-3.0-or-later
// Wave 72 — TapPowerValue static handler. Forge's
// `S:Mode$ TapPowerValue` substitutes the contribution a tapped creature
// makes to a Crew / Saddle / Station total — either swapping power for
// toughness ("Value$ Toughness") or adding a flat integer modifier
// ("Value$ N", e.g. "+2 power for crewing purposes"). See Forge's
// `forge.game.staticability.StaticAbilityTapPowerValue` (two static
// methods: `withToughness(card, ctb)` and `getMod(card, ctb)` —
// consulted from `CardLists.getTotalPower`).
//
// Forge cards using this (~10 — MKM Vehicle pilots + earlier Vehicle sets):
//   - Cloudspire Captain      (each creature you control: +2 power for
//                              crew/saddle)
//   - Deathless Pilot         (Self: +2 power for crew/saddle)
//   - Dragonfly Pilot         (Self: +2 power for crew)
//   - Dynamite Diver          (Self: +2 power for crew/saddle)
//   - Experimental Pilot      (Self: +2 power for crew)
//   - Giant Ox                (Self: use toughness for crew)
//   - Hotshot Mechanic        (Self: +2 power for crew)
//   - Interface Ace           (Self: use toughness for crew/saddle)
//   - Stoic Star Captain      (each creature you control: +2 power for
//                              crew/station)
//   - Tapestry Warden         (powerLTtoughness creatures: use toughness
//                              for station)
//
// DSL examples (real shapes from Forge):
//   S:Mode$ TapPowerValue | ValidSA$ Activated.Crew+Vehicle | ValidCard$ Card.Self | Value$ 2 | ...
//   S:Mode$ TapPowerValue | ValidSA$ Activated.Crew+Vehicle | ValidCard$ Card.Self | Value$ Toughness | ...
//   S:Mode$ TapPowerValue | ValidSA$ Activated.Crew+Vehicle,Activated.Saddle+Mount | ValidCard$ Creature.YouCtrl | Value$ 2 | ...
//   S:Mode$ TapPowerValue | ValidCard$ Creature.powerLTtoughness+YouCtrl | ValidSA$ Activated.Station | Value$ Toughness | ...
//
// Routing: ruleChanging — overrides the canonical
// "creature-power summed for cost X" rule with a per-creature
// substitution. The describe() payload exposes:
//   - cardMatches(cid)      → ValidCard$ filter
//   - saMatches(saCtx)      → ValidSA$ filter (Crew / Saddle / Station +
//                              optional source-type carve-out)
//   - useToughness          → Value$ Toughness flag
//   - mod                   → integer modifier (0 if useToughness)
//
// Read-side consumers:
//   - effectiveTapPowerValue(game, cid, saCtx) → query helper in
//     statics/wave72-tap-power-value.ts that walks the registry.
//   - crew/saddle/station effects consult the helper when summing
//     candidate creatures' contributions.
//
// MVP scope:
//   - Value$ Toughness  → useToughness flag.
//   - Value$ <integer>  → integer modifier.
//   - ValidCard$ <filter> via Wave 32 grammar (Creature.YouCtrl,
//     Creature.powerLTtoughness+YouCtrl, Card.Self, etc.).
//   - ValidSA$ comma-separated alts; each alt looks like
//     "Activated.Crew+Vehicle" — we parse the activation kind tag
//     (Crew / Saddle / Station) and an optional source-type carve-out
//     (Vehicle / Mount / etc.).
// TODO(advanced):
//   - ValidSA$ shapes that use full Forge grammar (e.g.
//     "Activated.Crew+Vehicle.cmcEQ3"); we only honor the first
//     leading-segment tag-and-type today, not deeper card-filter chains
//     on the source.
//   - Multiple stacking modifiers: handled additively (Forge sums
//     getMod across all matching statics; useToughness short-circuits
//     before the sum). Already implemented per-static; the helper
//     aggregates.
import type { EntityId, ParamValue, PlayerSeat, StaticAbility, StaticAst } from "@mtg-forge-ts/core";
import type { Game } from "../../game.js";
import {
  StaticHandler,
  type StaticHandlerCtx,
  normalizeActiveInZones,
  staticHandlerRegistry,
} from "../static-handler.js";
import { buildCardIdPredicate, literalRaw } from "./restriction-helpers.js";

/**
 * Activation context the SA-side filter matches against.
 */
export interface TapPowerValueSaContext {
  /** Activation kind: which keyword's payment site is summing power. */
  readonly saKind: "Crew" | "Saddle" | "Station";
  /**
   * The activating source card id (the Vehicle / Mount / Spacecraft
   * being crewed / saddled / stationed). Used to evaluate the
   * source-type carve-out ("+Vehicle" / "+Mount").
   */
  readonly activatingSourceId: EntityId;
}

export interface TapPowerValuePayload {
  readonly kind: "tapPowerValue";
  readonly cardMatches: (cardId: EntityId, game: Game) => boolean;
  readonly saMatches: (ctx: TapPowerValueSaContext, game: Game) => boolean;
  readonly useToughness: boolean;
  readonly mod: number;
  readonly controllerSeat: PlayerSeat;
}

interface ParsedSaAlt {
  /** Required activation kind tag (Crew / Saddle / Station). */
  readonly kind: "Crew" | "Saddle" | "Station";
  /** Optional source-type carve-out (e.g. "Vehicle", "Mount"). */
  readonly sourceType: string | undefined;
}

/**
 * Parse `ValidSA$` into a list of alternative match shapes. Each alt
 * looks like `Activated.Crew+Vehicle` (or `Activated.Saddle+Mount`,
 * `Activated.Station`). Returns an empty list when the param is
 * undefined — caller treats that as "match any activation kind".
 */
const parseValidSA = (raw: string | undefined): readonly ParsedSaAlt[] => {
  if (raw === undefined || raw.length === 0) return [];
  const out: ParsedSaAlt[] = [];
  for (const alt of raw.split(",")) {
    const trimmed = alt.trim();
    if (trimmed.length === 0) continue;
    // Must start with "Activated." to qualify; we don't yet support
    // Spell / Triggered TapPowerValue shapes (none exist in corpus).
    if (!trimmed.startsWith("Activated.")) continue;
    const tail = trimmed.slice("Activated.".length);
    // Split on '+' — first segment is the activation tag, anything
    // after is the source-type carve-out (we honor the first; deeper
    // filter chains are TODO(advanced)).
    const plusIx = tail.indexOf("+");
    const tag = plusIx === -1 ? tail : tail.slice(0, plusIx);
    const sourceType = plusIx === -1 ? undefined : tail.slice(plusIx + 1).split("+")[0];
    if (tag !== "Crew" && tag !== "Saddle" && tag !== "Station") continue;
    out.push({ kind: tag, sourceType });
  }
  return out;
};

/**
 * Test whether the activating source's effective type set (from the
 * layer engine) contains the carve-out type. Loose substring match
 * keeps this aligned with the simple Forge `+<Type>` grammar.
 */
const sourceMatchesType = (game: Game, sourceId: EntityId, sourceType: string): boolean => {
  const card = game.cards.get(sourceId);
  if (!card) return false;
  const chars = game.layerEngine.computeCharacteristics(sourceId);
  // Layered subtypes (Mount / Vehicle / Spacecraft) — most matches land here.
  if (chars.subtypes.has(sourceType)) return true;
  // Layered card types (rare for this filter, but defensive).
  // chars.types is Set<CardType> — compare via string coercion since
  // sourceType arrives as plain literal.
  for (const t of chars.types) {
    if ((t as unknown as string) === sourceType) return true;
  }
  return false;
};

const buildSAPredicate = (
  alts: readonly ParsedSaAlt[],
): ((ctx: TapPowerValueSaContext, game: Game) => boolean) => {
  if (alts.length === 0) return () => true;
  return (ctx, game) => {
    for (const alt of alts) {
      if (alt.kind !== ctx.saKind) continue;
      if (alt.sourceType === undefined) return true;
      if (sourceMatchesType(game, ctx.activatingSourceId, alt.sourceType)) return true;
    }
    return false;
  };
};

const parseValueParam = (raw: string | undefined): { useToughness: boolean; mod: number } => {
  if (raw === undefined || raw.length === 0) return { useToughness: false, mod: 0 };
  if (raw === "Toughness") return { useToughness: true, mod: 0 };
  const n = Number.parseInt(raw, 10);
  return { useToughness: false, mod: Number.isFinite(n) ? n : 0 };
};

export class TapPowerValueStaticHandler extends StaticHandler {
  static override readonly mode = "TapPowerValue" as const;

  override build(ast: StaticAst, ctx: StaticHandlerCtx): StaticAbility {
    const params: Readonly<Record<string, ParamValue>> = ast.params;
    const validCardRaw = literalRaw(params.ValidCard) ?? "Card.Self";
    const validSARaw = literalRaw(params.ValidSA);
    const valueRaw = literalRaw(params.Value);

    const cardPred = buildCardIdPredicate(validCardRaw, ctx.sourceCardId, ctx.controllerSeat);
    const saAlts = parseValidSA(validSARaw);
    const saPred = buildSAPredicate(saAlts);
    const { useToughness, mod } = parseValueParam(valueRaw);

    const payload: TapPowerValuePayload = {
      kind: "tapPowerValue",
      cardMatches: (cardId, game) => cardPred(cardId, game),
      saMatches: (saCtx, game) => saPred(saCtx, game),
      useToughness,
      mod,
      controllerSeat: ctx.controllerSeat,
    };

    const activeInZones = normalizeActiveInZones(ast.activeInZones);
    return {
      id: ctx.staticId,
      kind: "static",
      sourceCardId: ctx.sourceCardId,
      activeInZones,
      timestamp: ctx.game.newEntityId(),
      controllerSeatAtReg: ctx.controllerSeat,
      category: "ruleChanging",
      mode: "TapPowerValue",
      describe: () => payload,
    };
  }
}

staticHandlerRegistry.register(TapPowerValueStaticHandler);
