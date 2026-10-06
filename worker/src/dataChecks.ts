/**
 * GET /api/admin/data-checks (section "dataChecks": the
 * Men's Convenor and the Section Captains). Five reads in parallel, one
 * pass each in shared/dataChecks.ts:
 *
 *  - people (every record: the comparisons need resigned ones too)
 *  - this season's unlinked match cards, with their match
 *  - registration_events at needs_review
 *  - commitment years ending on or after REVIEWS_FROM
 *  - team names
 */
import type { Env } from "./env";
import { db } from "./data/supabase";
import { currentSeason } from "./seasonContext";
import { hkDateKey } from "../../shared/hkDateKey";
import { REVIEWS_FROM } from "../../shared/statementStages";
import {
  buildDataChecks,
  type DataChecks,
  type DcCardRow,
  type DcCommitmentRow,
  type DcEventRow,
  type DcPersonRow,
} from "../../shared/dataChecks";

const PEOPLE_COLUMNS =
  "id,api_id,preferred_name,given_names,surname,registered_name,status,applicant_stage,active,registered_team," +
  "playing_position,playing_ability,date_of_birth,mobile_no,email,is_suspended,matches_to_serve";

/**
 * The UTC instants a season runs between: season_of() puts a match in
 * "2026-2027" when its UTC date is from 1 July 2026 to 30 June 2027.
 */
export function seasonBounds(season: string): { from: string; to: string } {
  const start = Number(season.slice(0, 4));
  return { from: `${start}-07-01T00:00:00Z`, to: `${start + 1}-07-01T00:00:00Z` };
}

export async function getDataChecks(env: Env): Promise<DataChecks> {
  const d = db(env);
  const { from, to } = seasonBounds(currentSeason());
  const today = hkDateKey(new Date().toISOString());
  const [people, unlinkedCards, events, commitments, teams] = await Promise.all([
    d.select<DcPersonRow>("people", `select=${PEOPLE_COLUMNS}`),
    d.select<DcCardRow>(
      "match_cards",
      `select=id,api_id,raw_player_name,team,match:matches!inner(match_date,home_team,away_team)` +
        `&person_id=is.null&match.match_date=gte.${encodeURIComponent(from)}&match.match_date=lt.${encodeURIComponent(to)}`,
    ),
    d.select<DcEventRow>(
      "registration_events",
      "select=id,person_id,season,previous_team,new_team,detail,play_ups,created_at&status=eq.needs_review",
    ),
    d.select<DcCommitmentRow>(
      "commitments",
      `select=id,api_id,person_id,review_progress,period_start,period_end&period_end=gte.${REVIEWS_FROM}&period_start=lte.${today}`,
    ),
    d.select<{ team_name: string }>("teams", "select=id,team_name"),
  ]);
  return buildDataChecks({ people, unlinkedCards, events, commitments, teamNames: teams.map((t) => t.team_name), today });
}
