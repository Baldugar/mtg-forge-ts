---
"@mtg-forge-ts/core": minor
"@mtg-forge-ts/game": minor
---

feat: SP1 engine foundations — monorepo scaffolding, core types (ids, color, zone, phase, counter-type, mana, cost, card types, deck, DSL AST, views, game events, player/match/draft decisions, typed error hierarchy, GameLog, SeededRng, ImageKeys, FormatDefinition, LobbyPlayer), game scaffold (Zone hierarchy, Card, Player, Game, GameFlags, TerminalState, engine registries, ManaPool, Stack, GameAction generators, PhaseHandler/TurnQueue/PhaseSequence, TargetSystem, CombatHandler, Match, GameSnapshot serialize/restore, DecisionLog, PlayerController + ScriptedController + RandomLegalController, setup flow with London mulligan, endGame helper), CI determinism lint rule, and integration smoke test.
