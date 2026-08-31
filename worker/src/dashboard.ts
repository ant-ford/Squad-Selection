import { Env } from "./airtable";
import { getReferenceData } from "./reference";
import { getSeasonContext } from "./seasonContext";
import { getRankingEvents } from "./rankingEvents";
import { isQualifyingPlayUpCard } from "./playUp";
import { selectedDisplayTeam } from "../../src/lib/displayTeam";

/** HKHA season boundary: starts 1 July. */
export function currentSeason(d = new Date()): string {
  const y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${y + 1}`;
}

/**
 * Play-Up Watch: players with 2+ adjusted play-up appearances this season.
 * 2 = approaching the limit (warning)
 * 3 = next appearance triggers re-registration (critical)
 * Purely informational — no positional recommendations are made here.
 * Uses the same counting rules as the eligibility engine
 * (Play Up? = true, Goalkeeper excluded, current season only).
 */
export async function getPlayUpWatch(env: Env) {
  const ref = await getReferenceData(env);
  const season = currentSeason();
  const ctx = await getSeasonContext(env, season);
  const watch: { id: string; name: string; registeredTeam: string; playUpCount: number }[] = [];
  
  for (const p of ref.players) {
    if (!p.active) continue;
    const cards = ctx.matchCardsByPlayer.get(p.id) ?? [];
    const count = cards.filter((mc) => isQualifyingPlayUpCard(mc, season)).length;
    if (count >= 2) {
      watch.push({
        id: p.id,
        name: p.preferredName || p.givenNames || "Player",
        // Display value (optics); the count uses the true Registered Team.
        registeredTeam: selectedDisplayTeam(p),
        playUpCount: count,
      });
    }
  }
  
  watch.sort((a, b) => b.playUpCount - a.playUpCount);
  return { season, watch: watch.slice(0, 10) };
}

/**
 * Recent Section Rank changes, read from the Ranking Events table (newest
 * first). Degrades to an empty list when the table has not been created
 * yet - the dashboard never fails because the audit trail is missing.
 */
export async function getRecentChanges(env: Env, days: number) {
  // No catch: a failed Ranking Events read must surface as an API error, not
  // masquerade as "no changes" (spec S5). getRankingEvents logs the details
  // server-side and degrades to [] ONLY when the table does not exist yet.
  const changes = await getRankingEvents(env, days);
  return { changes };
}

export async function getRecentAvailability(_env: Env, _days: number) {
  return {
    changes: [] as {
      playerId: string; playerName: string; team: string; status: string;
      note: string; matchLabel: string; matchDate: string; updatedAt: string;
    }[],
  };
}