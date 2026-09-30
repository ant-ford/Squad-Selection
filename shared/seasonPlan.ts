/**
 * The season plan: asked at the start of each season (the member details
 * update) and when someone joins (the new joiner form), to help allocate
 * players to teams. See supabase/migrations/20261001120000_season_plan.sql.
 *
 * Trials, tours and tournaments are not part of it: they move to an events
 * schedule (owner, 2026-10-01).
 */

export const AVAILABILITY_LEVELS = [
  { key: "all", label: "All matches (90%+)", short: "All" },
  { key: "most", label: "Most matches (50–90%)", short: "Most" },
  { key: "some", label: "Some matches (10–50%)", short: "Some" },
  { key: "none", label: "Not available this season", short: "None" },
] as const;
export type AvailabilityLevel = (typeof AVAILABILITY_LEVELS)[number]["key"];

export const AVAILABILITY_HALVES = [
  { key: "first", label: "First half of the season only", short: "1st half" },
  { key: "second", label: "Second half of the season only", short: "2nd half" },
] as const;
export type AvailabilityHalf = (typeof AVAILABILITY_HALVES)[number]["key"];

/** Stored as the Airtable form's words, so this season's answers carry on. */
export const PLAYING_PREFERENCES = [
  { value: "Play in the highest team I am selected for, including a development‑focused team.", label: "The highest team I'm picked for, including a development-focused team", short: "Highest team" },
  { value: "Play in the next team down, rather than in a development‑focused team.", label: "The next team down, rather than a development-focused team", short: "Next team down" },
] as const;

export const CAPTAINCY_OPTIONS = ["Yes", "Maybe", "No"] as const;
export type CaptaincyInterest = (typeof CAPTAINCY_OPTIONS)[number];

export const SEASON_PLAN_QUESTIONS = {
  availabilityLevel: "How much of the season can you play?",
  availabilityHalf: "Only part of the season?",
  playingPreference: "If you're picked for a development-focused team, would you rather play…",
  captaincyInterest: "Would you like to be a team captain or vice-captain?",
} as const;

export interface SeasonPlanAnswers {
  availabilityLevel: AvailabilityLevel | null;
  availabilityHalf: AvailabilityHalf | null;
  playingPreference: string | null;
  captaincyInterest: CaptaincyInterest | null;
}

export const EMPTY_SEASON_PLAN: SeasonPlanAnswers = {
  availabilityLevel: null,
  availabilityHalf: null,
  playingPreference: null,
  captaincyInterest: null,
};

/** What's still missing, as the question to answer; null when complete. */
export function seasonPlanMissing(a: SeasonPlanAnswers): string | null {
  if (!a.availabilityLevel) return SEASON_PLAN_QUESTIONS.availabilityLevel;
  if (a.availabilityLevel !== "none" && !a.playingPreference) return "Choose a playing preference";
  if (!a.captaincyInterest) return SEASON_PLAN_QUESTIONS.captaincyInterest;
  return null;
}

/** GET /api/season-plan/me. */
export interface MySeasonPlan {
  season: string;
  /** This season's answers, if they've given them (from Eddy or last season's Airtable form). */
  plan: (SeasonPlanAnswers & { submittedAt: string | null }) | null;
}

export interface SeasonPlanPlayer {
  id: string;
  name: string;
  status: string;
  playingPosition: string;
  plan: SeasonPlanAnswers | null;
}

/** GET /api/season-plan/board: the season plans by team, for allocating players. */
export interface SeasonPlanBoard {
  season: string;
  teams: { team: string; players: SeasonPlanPlayer[] }[];
}

export const shortPreference = (value: string | null) => PLAYING_PREFERENCES.find((p) => p.value === value)?.short ?? null;
