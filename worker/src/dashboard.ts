import { Env } from "./airtable";
import { getReferenceData } from "./reference";
import { getSeasonContext } from "./squad";

/** HKHA season boundary: starts 1 July. */
function currentSeason(d = new Date()): string {
  const y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${y + 1}`;
}

/**
 * Play-Up Watch: players with 2+ adjusted play-up appearances this season.
 *   2 = approaching the limit (warning)
 *   3 = next appearance triggers re-registration (critical)
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
    const count = cards.filter(
      (mc) => mc.playUp === true && mc.goalkeeper !== true && (mc.season ?? season) === season,
    ).length;
    if (count >= 2) {
      watch.push({
        id: p.id,
        name: p.preferredName || p.givenNames || "Player",
        registeredTeam: p.registeredTeam || "",
        playUpCount: count,
      });
    }
  }
  watch.sort((a, b) => b.playUpCount - a.playUpCount);
  return { season, watch: watch.slice(0, 10) };
}

// Kept for API compatibility; currently unused by the UI.
export async function getRecentChanges(_env: Env, _days: number) {
  return { changes: [] as { id: string; kind: string; playerName: string; text: string; at: string }[] };
}

export async function getRecentAvailability(_env: Env, _days: number) {
  return {
    changes: [] as {
      playerId: string; playerName: string; team: string; status: string;
      note: string; matchLabel: string; matchDate: string; updatedAt: string;
    }[],
  };
}