import type { Env } from "./env";
import { getReferenceData } from "./reference";
import { getSeasonContext, currentSeason } from "./seasonContext";
import { getRankingEvents } from "./rankingEvents";
import { isQualifyingPlayUpCard, playUpAllowance } from "./playUp";
import { selectedDisplayTeam } from "../../shared/displayTeam";

/**
 * Play-Up Watch: players within one appearance of their play-up allowance
 * this season (Bye-Law 7.2(b): 3 for most players, 8 for U21s).
 * allowance - 1 = approaching the limit (warning)
 * allowance     = next appearance triggers re-registration (critical)
 * Each row carries its allowance so the client labels a U21 on seven the
 * same way it labels anyone else on two.
 * Purely informational — no positional recommendations are made here.
 * Uses the same counting rules as the eligibility engine
 * (Play Up? = true, Goalkeeper excluded, current season only).
 */
export async function getPlayUpWatch(env: Env) {
  const ref = await getReferenceData(env);
  const season = currentSeason();
  const ctx = await getSeasonContext(env, season);
  const watch: { id: string; name: string; registeredTeam: string; playUpCount: number; playUpAllowance: number }[] = [];
  
  for (const p of ref.players) {
    if (!p.active) continue;
    const cards = ctx.matchCardsByPlayer.get(p.id) ?? [];
    const count = cards.filter((mc) => isQualifyingPlayUpCard(mc, season, ctx.matchesById)).length;
    const allowance = playUpAllowance(p);
    if (count >= allowance - 1) {
      watch.push({
        id: p.id,
        name: p.preferredName || p.givenNames || "Player",
        // Display value (optics); the count uses the true Registered Team.
        registeredTeam: selectedDisplayTeam(p),
        playUpCount: count,
        playUpAllowance: allowance,
      });
    }
  }
  
  // Closest to (or furthest past) their own allowance first.
  watch.sort((a, b) => (b.playUpCount - b.playUpAllowance) - (a.playUpCount - a.playUpAllowance));
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