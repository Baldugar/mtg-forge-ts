// SPDX-License-Identifier: GPL-3.0-or-later
// LobbyPlayer is the pre-game identity of a participant: the thing a lobby
// / matchmaker hands to MatchSetup to instantiate a concrete Player +
// PlayerController pair. `controllerKind` is an open tag (not an enum)
// because the set of controller shapes grows with scripted/remote/random
// variants added in later milestones.

/**
 * Stable identity of a lobby participant. `id` persists across matches
 * (e.g., local profile UUID, remote user ID); `name` is display-only.
 * `avatar` is an asset key resolvable via the image pipeline.
 */
export interface LobbyPlayer {
  readonly id: string;
  readonly name: string;
  readonly avatar?: string;
  readonly controllerKind: "human" | "ai" | "scripted" | "randomLegal" | "remote";
}
