import { apiPost } from '@/lib/apiClient';

/**
 * A coach inverts one player's availability default (coach only).
 *
 * The club runs on opt-out: a player is available unless they say
 * otherwise, because nobody answers thirty fixtures individually. That
 * falls apart for the player who is out most of the season and never opens
 * the app, because they show Available on every squad sheet, which reads
 * like an answer rather than like silence.
 *
 * With this on, every fixture that player has not answered counts as
 * Unavailable, and they have to actively say they are available. Their own
 * answer to a specific fixture always wins.
 */
export async function setPlayerOptInOnly(
  playerId: string,
  optInOnly: boolean,
): Promise<{ success: boolean; playerId: string; optInOnly: boolean }> {
  return apiPost(`/api/player/${encodeURIComponent(playerId)}/opt-in-only`, { optInOnly });
}
