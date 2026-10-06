/**
 * The season plan: each player's answers for the current
 * season, given in the member details update or the new joiner form, and
 * the view by team that helps allocate players to teams.
 *
 * Who sees the view: the Section Captains (the office, or the Teams link)
 * every team; a coach their own teams.
 */
import type { Env } from "./env";
import { sectionsFor, type AuthorizedUser } from "./auth";
import { HttpError } from "./http";
import { db, eq, SupabaseError } from "./data/supabase";
import {
  AVAILABILITY_HALVES,
  AVAILABILITY_LEVELS,
  CAPTAINCY_OPTIONS,
  PLAYING_PREFERENCES,
  type MySeasonPlan,
  type SeasonPlanAnswers,
  type SeasonPlanBoard,
} from "../../shared/seasonPlan";

interface PlanRow {
  person_id: string;
  season: string;
  availability_level: SeasonPlanAnswers["availabilityLevel"];
  availability_half: SeasonPlanAnswers["availabilityHalf"];
  playing_preference: string | null;
  captaincy_interest: SeasonPlanAnswers["captaincyInterest"];
  submitted_at: string | null;
}

interface PersonRow {
  id: string;
  api_id: string;
  preferred_name: string | null;
  given_names: string | null;
  surname: string | null;
  status: string | null;
  playing_position: string | null;
  registered_team: string | null;
  selected_team_sos: string | null;
  selected_team_eos: string | null;
}

const PLAN_COLUMNS = "id,person_id,season,availability_level,availability_half,playing_preference,captaincy_interest,submitted_at";

/** The team a player is shown in when there's none yet. */
export const NO_TEAM = "No team yet";

const toAnswers = (r: PlanRow): SeasonPlanAnswers => ({
  availabilityLevel: r.availability_level,
  availabilityHalf: r.availability_half,
  playingPreference: r.playing_preference,
  captaincyInterest: r.captaincy_interest,
});

async function currentSeason(env: Env): Promise<string> {
  return db(env).rpc<string>("current_season", {});
}

export async function getMySeasonPlan(env: Env, user: AuthorizedUser): Promise<MySeasonPlan> {
  const d = db(env);
  const [season, person] = await Promise.all([
    currentSeason(env),
    d.one<{ id: string }>("people", `select=id&api_id=${eq(user.personId)}`),
  ]);
  if (!person) throw new HttpError("Your People record was not found.", 404, "NOT_FOUND");
  const row = await d.one<PlanRow>("season_plans_v", `select=${PLAN_COLUMNS}&person_id=${eq(person.id)}&season=${eq(season)}`);
  return { season, plan: row ? { ...toAnswers(row), submittedAt: row.submitted_at } : null };
}

/** Checks one answer against its choices; blank is null. */
function choice<T extends string>(v: unknown, allowed: readonly T[], message: string): T | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) throw new HttpError(message, 400, "INVALID_INPUT");
  return v as T;
}

/** Validates a season plan from a form. The database repeats the rules. */
export function parseSeasonPlan(body: Record<string, unknown>): SeasonPlanAnswers {
  return {
    availabilityLevel: choice(body.availabilityLevel, AVAILABILITY_LEVELS.map((l) => l.key), "Say how much of the season you can play."),
    availabilityHalf: choice(body.availabilityHalf, AVAILABILITY_HALVES.map((h) => h.key), "Choose the first or second half, or neither."),
    playingPreference: choice(body.playingPreference, PLAYING_PREFERENCES.map((p) => p.value), "Choose a playing preference."),
    captaincyInterest: choice(body.captaincyInterest, CAPTAINCY_OPTIONS, "Say whether you'd like to captain."),
  };
}

/**
 * Saves the person's plan for the current season. The member details and
 * new joiner forms call this with their season plan section.
 */
export async function submitSeasonPlan(env: Env, user: AuthorizedUser, body: Record<string, unknown>) {
  const answers = parseSeasonPlan(body);
  try {
    await db(env).rpc("submit_season_plan", { p_actor: user.personId, p: answers });
  } catch (err) {
    if (err instanceof SupabaseError && (err.code === "22023" || err.code === "P0002")) {
      const message = err.message.replace(/^Supabase .*?failed \(\d+\): /, "");
      throw new HttpError(`${message}.`, err.code === "P0002" ? 404 : 400, err.code === "P0002" ? "NOT_FOUND" : "INVALID_INPUT");
    }
    throw err;
  }
  return { ok: true };
}

/** Every team for a Section Captain; a coach's own teams; otherwise none. */
export function planTeamsFor(user: AuthorizedUser): "all" | string[] {
  if (sectionsFor(user).includes("planning") || user.isSectionCaptain) return "all";
  return user.coachTeams;
}

/**
 * Whether the Season plans screen has anything for them, for the Officers
 * menu: Section Captains every team, coaches their own. Sent with both
 * /api/my-profile and /api/my-fixtures, since the coach header reads one
 * and the player header the other.
 */
export function canSeeSeasonPlans(user: AuthorizedUser): boolean {
  const teams = planTeamsFor(user);
  return teams === "all" || teams.length > 0;
}

const personName = (p: PersonRow) => [p.preferred_name || p.given_names, p.surname].filter(Boolean).join(" ");
const personTeam = (p: PersonRow) => p.selected_team_eos || p.selected_team_sos || p.registered_team || "";

/** Active players by the team they're shown in, with this season's plan. */
export async function getSeasonPlanBoard(env: Env, user: AuthorizedUser): Promise<SeasonPlanBoard> {
  const teams = planTeamsFor(user);
  if (teams !== "all" && teams.length === 0) throw new HttpError("Coach or Section Captain access required.", 403, "COACH_ACCESS_REQUIRED");
  const d = db(env);
  const season = await currentSeason(env);
  const [people, plans] = await Promise.all([
    d.select<PersonRow>(
      "people",
      "select=id,api_id,preferred_name,given_names,surname,status,playing_position,registered_team,selected_team_sos,selected_team_eos&active=is.true",
    ),
    d.select<PlanRow>("season_plans_v", `select=${PLAN_COLUMNS}&season=${eq(season)}`),
  ]);
  const byPerson = new Map(plans.map((p) => [p.person_id, p]));
  const grouped = new Map<string, SeasonPlanBoard["teams"][number]["players"]>();
  for (const p of people) {
    const team = personTeam(p) || NO_TEAM;
    if (teams !== "all" && !teams.includes(team)) continue;
    const plan = byPerson.get(p.id);
    const list = grouped.get(team) ?? [];
    list.push({ id: p.api_id, name: personName(p), status: p.status ?? "", playingPosition: p.playing_position ?? "", plan: plan ? toAnswers(plan) : null });
    grouped.set(team, list);
  }
  return {
    season,
    teams: [...grouped.entries()]
      // By team name (HKFC A first), with those not yet in a team last.
      .sort(([a], [b]) => Number(a === NO_TEAM) - Number(b === NO_TEAM) || a.localeCompare(b))
      .map(([team, players]) => ({ team, players: players.sort((a, b) => a.name.localeCompare(b.name)) })),
  };
}
