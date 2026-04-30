# 🎯 NEXT STEPS — Waves 31-70.C Done

> **Status:** Waves 31-69 complete + Wave 70.A-C landed. ~92% functional fidelity on the 32,300-card Forge corpus. 100% parser/registration coverage holds. Long-tail polish remains.

> **Read this first:** This document is the canonical handoff. The kickoff prompt at the bottom can be pasted directly into the next session to resume work.

---

## State snapshot (post-Wave 70.C)

- **Repo:** `F:\BACKUP\Programacion\mtg-forge-ts`
- **Branch:** `sp1-engine-foundations` (local only; never pushed)
- **HEAD:** `afbc842` (Wave 70.C — Phantasmal Image + Phyrexian Metamorph polish)
- **Commits since `dbe90e6`:** ~360
- **Tests: 3,249 game + 134 cards + 727 core = 4,110 passing**
- **Coverage:** **100.0%** on full 32,300-card Forge corpus
- **Gates:** typecheck (fresh tsc --noEmit) ✅, build ✅, test ✅, lint ✅, DCO ✅

---

## This session: Waves 60-70.C in 28 sub-batches, +255 tests

| Wave | Focus | Sub-batches | Commit range | Tests |
|------|-------|---|---|---|
| **60** | Deeper static mode pack (~28 modes + 6 Continuous sub-payloads) | A-I (9) | `5320ac1`..`c135799` | +99 |
| **61** | Decision-driven effect resolution | A-F (6) | `ed9397b`..`8f5c386` | +44 |
| **62** | Token database + ETB-creates-token | A | `bd4a5ef` | +3 |
| **63** | Sub-param tightness sweep across Wave 53 effects | A-B | `4ac8895`..`3de5d48` | +21 |
| **64** | Cipher + cast-copy infrastructure (`castCopyOf`) | 1 | `28da45b` | +13 |
| **65** | Combat-handler reads on stamped flags | A-B-C | `cb823d4`..`d982e44` | +24 |
| **66** | Sideboard + OutsideTheGame zone | 1 | `9afd666` | +9 |
| **67** | Replacement intent threading on non-Damage parents | 1 | `995f0dc` | +8 |
| **69** | Splice Arcane text-grafting | 1 | `3e60471` | +5 |
| **70.A** | Trigger mode coverage (ClassLevelGained etc.) | 1 | `544d8c3` | +12 (9 game + 3 core) |
| **70.B** | Initiative dungeon per-room SVar effects | 1 | `2779f0f` | +13 |
| **70.C** | Phantasmal Image + Phyrexian Metamorph polish | 1 | `afbc842` | +4 |
| **TOTAL** | | **28** | | **+255** |

---

## Functional fidelity snapshot

| Surface | Pre-46 | Post-59 | Post-70.C |
|---|---|---|---|
| Cost parts | 6 (broken) | 17 | 17 |
| Static modes | 5 of ~95 | 17 of ~95 | ~33 of ~95 |
| Replacement events | 30 ✅ | 36 ✅ | 36 ✅ + non-Damage parents threading |
| Effect handlers | ~30 ✅ | ~50 ✅ | ~52 ✅ + sub-params tight |
| Keyword handlers | 50 of ~135 | ~110 of ~135 | ~110 of ~135 (decision-driven) |
| Decision request kinds | ~10 | ~22 | ~25 |
| Continuous sub-payloads | partial | partial | full (P/T, type, color, kw add+remove, T/R/S/A grants, MayLookAt) |
| Zones | 5 | 5 | 7 (+ Sideboard + OutsideTheGame) |
| Event kinds | 167 | 169 | 172 |
| Cast-copy mechanic | per-keyword MVP | per-keyword MVP | unified `castCopyOf` |
| Splice Arcane | stub altcost | stub altcost | full (cost + reveal + graft) |
| Initiative dungeon | framework only | framework only | per-room effects |

**Card-impact estimate:**
- Pre-Wave-46: ~50% of unique cards play correctly end-to-end
- Post-Wave-59: ~80%
- **Post-Wave-70.C: ~92%**

---

## What's left — Wave 70.D+ roadmap

All major named waves through 69 are CLOSED. Wave 70 is in long-tail polish phase. Items remaining (rough size estimate per item):

### High-impact (~20-50 cards each)
- **Subgame full nested-game loop** (Shahrazad — only 1 card, but architectural)
- **Layer 1 Clone variants** beyond 70.C: Body Double / Skyclave Apparition / etc. (most should already work via CopyPermanent)
- **Adventure full plumbing** beyond 65.C: text-side Adventure cards (Brazen Borrower, Bonecrusher Giant) need full graveyard-vs-exile lifecycle verified
- **ChangeText full rules-text rewrite** beyond Wave 45 MVP (color-bit + subtype swaps done; full text rewrite for Crystal Spray / Glamerdye is a new layer of fidelity)
- **MakeCard registry expansion** for cards that conjure tokens with specific names (Token Conjurer, Wishclaw Talisman)

### Medium-impact (~10-30 cards each)
- **Bands-with-other** combat keyword for Endure Spirit token (combat damage assignment)
- **Replicate / Recover cost-at-cast tightening** (currently confirmAction-only; full extra-cost-on-cast needs cast-pipeline integration)
- **Delayed-trigger sub-SVar resolution edge cases** (most work, edge cases trip up rare cards)
- **Decision schema gaps**: chooseSector, chooseRingBearer, chooseEvenOdd integrations in remaining edge effects
- **~50 lower-frequency static modes** (out of ~95 total; ~33 wired). Examples: CharacteristicDefining$ True sub-cases, ExtraEachOpponent, IsValid, ControllerChange, PreventNextDamage with PreventionEffect$ N

### Low-impact (~5-10 cards each)
- **Contraption deck full integration** (Wave 45 stamped framework)
- **Wave 53 sub-param longtail** (~25 minor sub-params remain)
- **200+ inline TODO(advanced) tails** scattered across handlers — most are 5-50 LoC fixes once visited

### Estimate to ~95-97% fidelity: ~10-15 more sub-batches.

---

## Patterns proven across this run

### Tactical
- **Tight subagent dispatches** (<60-100 tool calls each). 28 sub-batches in this session; near-100% success rate.
- **Same-shape bundling**: 2-3 same-shape items per dispatch is fine; 3+ unrelated features blows up token usage.
- **MVP-first per handler**: register the key, ship canonical case, mark `TODO(advanced)` for sub-params.
- **Group commits per logical batch.**
- **Read tests once.** Don't re-run with different greps.

### Code patterns
- **Registry-walk query helpers** (Wave 60.A pattern) preferred over `game.flags.fooFilters[]` arrays — snapshot-friendly + composable.
- **Decision-yield with validate + fallback** (Wave 61.A pattern): yield decision, validate response, fall back to first eligible on invalid.
- **GrantedAbilitySweep** (Wave 60.B + .F + .C) for live-membership add/remove of granted T/R/S/A abilities at LayerEngine recompute.
- **Per-mode subclasses sharing core builder** (Wave 60.E pattern) when 3 modes share virtually all logic.
- **Replacement intent threading** via `game.flags.activeReplacementIntent` side-channel (Wave 56 + extended Wave 67).
- **SVar-source resolver redirect** (Wave 60.B + 70.C): granted abilities have `sourceCardId = matchedCardId` but SVar lookup goes through the granting source's svars.

---

## Pitfalls hit (all documented)

1. `exactOptionalPropertyTypes: true` — biome forbids both `!` non-null and `delete`. Use `T | undefined = undefined` typed slots.
2. `Card.face` is `FaceKind` (not `FaceKind | undefined`) — use `"default"` sentinel.
3. `mkEvent` exhaustiveness — every new event kind must be added to event.test.ts's EXPECTED_KINDS / ALL_KINDS_MAP / PAYLOADS.
4. Event kind names: `AttackersDeclared` (plural batch), `DamageDealt` (with `isCombat` flag).
5. Replacement registry callbacks can't yield decisions easily — use intent-threading side channel.
6. **`tsc --noEmit` cache lies** — Waves 47/48/60.G/multiple confirmed: rebuild `@mtg-forge-ts/core` BEFORE typechecking game when you change the mode enum.
7. Generators with no yield need `// biome-ignore lint/correctness/useYield: <reason>` comment.
8. Tool budget per dispatch: <80-120 tool calls. Bundling 3+ unrelated features blows up token usage.
9. Snapshot v7 doesn't round-trip closure functions — `targetCardIdFn` etc. on layer effects are stripped on restore; statics re-register from each card's static-list.
10. The `replaceWithKey !== ast.effect.handlerKey` guard pattern (copied from counter-replacement) suppresses SVar lookup when both fields are populated; remove the guard when extending replacement handlers (Wave 67).
11. Granted-ability resolvers need explicit SVar-source redirect — without it, SVar lookups go through the COPIED card's PaperCard, not the granting source's svars (Wave 70.C found this bug).

---

## Key file locations

- This handoff: `NEXT_STEPS_WAVE_70_DONE.md` (repo root)
- Previous handoff: `NEXT_STEPS_WAVE_59_DONE.md` (still useful for Wave 60 background)
- Memory: `C:\Users\aleja\.claude\projects\F--BACKUP-Programacion\memory\project_mtg_forge_ts_sp1_execution.md`
- Master spec: `docs/superpowers/specs/2026-04-23-mtg-forge-ts-master-spec.md`
- Gap audit: `docs/superpowers/plans/2026-04-26-gap-audit-synthesis.md`
- Forge sources (read-only): `F:\BACKUP\Programacion\forge\`
- Vendored cards: `F:\BACKUP\Programacion\forge\forge-gui\res\cardsfolder\` (32,300 .txt files)

### Our key dirs
- Token database: `packages/cards/src/tokens/token-database.ts`
- Effect handlers: `packages/game/src/ability/effects/` (~250)
- Trigger handlers: `packages/game/src/trigger/handlers/`
- Replacement handlers: `packages/game/src/replacement/handlers/`
- Static handlers: `packages/game/src/static/handlers/` (~33 modes)
- Keyword handlers: `packages/game/src/keyword/handlers/` (~110)
- Alt-costs: `packages/game/src/altcost/` (~30)
- Cost parts: `packages/game/src/cost/parts/` (~17)
- SVar selectors: `packages/game/src/svar/selectors/`
- Wave 60-65 query helper modules: `packages/game/src/statics/wave6{0,5,5b,5c}-*.ts`
- Wave 56 ReplaceEffect family: `packages/game/src/ability/effects/replace-effect.ts` + `replace-with-svar.ts`

---

## Non-negotiable invariants (carry forward)

- Generator engine; no Promise/async inside `function*`
- Three mutators (GameAction / CombatHandler / subsystem-internal)
- Entity-ID refs, readonly unions
- `kind:` + `readonly version: 1` on every event
- Exhaustiveness guards on every `switch (x.kind)`
- Deterministic Rng
- `git commit -s`, NO `Co-Authored-By` (user global rule)
- SPDX headers, `.js` imports, `import type`
- Forge-fidelity wins over plan
- Stay on `sp1-engine-foundations`; never push
- 100% port — no defers / niches / skips. Every gap-list item lands.

---

## 📋 Kickoff prompt for next session

Paste this verbatim:

```
Continue mtg-forge-ts. Read the memory at
C:\Users\aleja\.claude\projects\F--BACKUP-Programacion\memory\project_mtg_forge_ts_sp1_execution.md
and the handoff at NEXT_STEPS_WAVE_70_DONE.md (repo root).

Working tree clean, branch sp1-engine-foundations at HEAD afbc842.
Tests: 4110 (3249 game + 134 cards + 727 core). Coverage: 100% on
full 32,300-card corpus. Functional fidelity: ~92% of cards play
correctly end-to-end. All major named waves through 69 are CLOSED.

Per the user's "100% port no defers" directive, continue closing
the remaining ~8% gap. Recommended Wave 70.D+ items (in
NEXT_STEPS_WAVE_70_DONE.md):

  - Subgame full nested-game loop (Shahrazad)
  - Layer 1 Clone variants beyond 70.C
  - Adventure / ChangeText long-tail
  - Bands-with-other for Endure
  - Replicate/Recover cost-at-cast tightening
  - ~50 lower-frequency static modes (~33 of ~95 currently wired)
  - 200+ inline TODO(advanced) tails

Use tight subagent dispatches (<60-100 tool calls each). Same-shape
bundling: 2-3 same-shape items per dispatch. Group commits per
logical batch.

DCO-signed (`-s`). NO `Co-Authored-By`. NEVER push. Stay on
sp1-engine-foundations.

After each wave: full gate (typecheck + test + lint) and verify
typecheck on a fresh `tsc --noEmit` (don't trust stale build
cache — multiple waves confirmed this pitfall).

Start by picking ONE focused long-tail item that has clear card
impact + bounded scope. Avoid dispatching multiple unrelated
features in one subagent brief.
```

---

## End-of-session snapshot

- **Total commits since dbe90e6:** ~360
- **Total tests:** 4,110 passing across all packages (3,249 game + 134 cards + 727 core)
- **Corpus coverage:** 100.0% on full 32,300-card corpus
- **Functional keyword catalogue:** ~110 mechanics fully wired
- **Effect handlers:** ~252 (broadly faithful)
- **Static modes:** ~33 (was 5 pre-Wave-46)
- **Cost parts:** 17 (was 6)
- **SVar selectors:** ~50 args (was 13)
- **Decision request kinds:** ~25 (was 10)
- **Event kinds:** 172 (was 167)
- **Snapshot schema version:** v7
- **Functional fidelity (estimate):** ~92% of unique cards play correctly end-to-end (was ~50% pre-Wave-46, ~80% post-59, ~85% post-60)

This session landed 28 sub-batches across Waves 60-70.C, +255 tests, all gates green throughout. The engine architecture is mature and stable. Remaining work is mechanical sub-param fidelity sweeps + low-frequency static modes + rare-card edge cases. ~10-15 more waves of polish gets to ~95-97%.
