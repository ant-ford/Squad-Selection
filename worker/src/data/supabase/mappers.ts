/**
 * api_* view rows -> the domain objects the Worker uses. The defaults and
 * fallbacks are the ones the Airtable mappers had, so imported and new rows
 * read the same way.
 */
import type { Env } from "../../env";
import { birthdayKey } from "../../../../shared/birthday";
import type {
  AbilityGroupConfiguration, AvailabilityException, AvailabilityRule, AvailabilityRuleType, KitColour, Match, MatchCard,
  Player, Team,
} from "../../../../shared/schema/domainTypes";

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const int = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : undefined);

export interface PlayerRow {
  id: string;
  preferred_name: string | null; given_names: string | null; surname: string | null; shirt_no_value: string | null;
  email: string | null; mobile_no: string | null; active: boolean;
  registered_team: string | null; selected_team_sos: string | null; selected_team_eos: string | null;
  playing_position: string | null; playing_ability: string | null;
  is_visiting_player: boolean; is_suspended: boolean; matches_to_serve: number | null;
  ever_registered_to_premier: boolean; u21_eligible: boolean; player_coach: string[];
  section_rank: number | null; rank_updated_at: string | null; status: string | null; applicant_stage: string | null;
  sports_background: string | null; selection_comments: string | null; opt_in_only: boolean;
  date_of_birth: string | null; photo_file_id: string | null;
}

export async function toPlayer(_env: Env, r: PlayerRow): Promise<Player> {
  return {
    id: r.id,
    preferredName: str(r.preferred_name),
    givenNames: str(r.given_names),
    surname: str(r.surname),
    shirtNoValue: str(r.shirt_no_value),
    email: str(r.email),
    mobileNo: str(r.mobile_no),
    active: r.active,
    registeredTeam: str(r.registered_team),
    selectedTeamSos: str(r.selected_team_sos),
    selectedTeamEos: str(r.selected_team_eos),
    playingPosition: str(r.playing_position),
    playingAbility: str(r.playing_ability),
    isVisitingPlayer: r.is_visiting_player,
    isSuspended: r.is_suspended,
    matchesToServe: int(r.matches_to_serve),
    everRegisteredToPremier: r.ever_registered_to_premier,
    u21Eligible: r.u21_eligible,
    playerCoach: arr(r.player_coach),
    sectionRank: int(r.section_rank),
    // Team Rank and Positional Rank are derived by the ranking engine and
    // never stored (README invariant 4); Airtable's copies were stale.
    teamRank: undefined,
    positionalRank: undefined,
    rankUpdatedAt: str(r.rank_updated_at),
    status: str(r.status),
    applicantStage: str(r.applicant_stage),
    // Not signed here: most reads of people never show the photo (the club
    // reference signed one per player). A screen that shows it signs it
    // (photoLink in data/supabase/files.ts), as the ranking does.
    photoFileId: r.photo_file_id ?? undefined,
    sportsBackground: str(r.sports_background),
    selectionComments: str(r.selection_comments),
    optInOnly: r.opt_in_only === true,
    birthday: birthdayKey(r.date_of_birth ?? undefined),
  };
}

export interface TeamRow {
  id: string; team_name: string | null; team_rank: number | null; is_premier: boolean; target_squad_size: number | null;
  active: boolean; coach: string[]; team_captain: string[]; section_captain: string[]; auto_select_players: string[];
}

export function toTeam(r: TeamRow): Team {
  return {
    id: r.id,
    teamName: r.team_name || "",
    teamRank: r.team_rank || 99,
    isPremier: r.is_premier || false,
    targetSquadSize: r.target_squad_size || 16,
    active: r.active || false,
    coach: arr(r.coach),
    teamCaptain: arr(r.team_captain),
    sectionCaptain: arr(r.section_captain),
    autoSelectPlayers: arr(r.auto_select_players),
  };
}

export interface MatchRow {
  id: string; match_date: string | null; season: string | null; division: string | null; competition_type: string | null;
  home_team: string | null; home_score: number | null; away_team: string | null; away_score: number | null;
  match_status: string | null; venue: string | null; fixture_id: string | null;
  selected_players_home: string[]; selected_players_away: string[]; auto_select_enabled: boolean;
  home_kit: string | null; away_kit: string | null; ump_1: string | null; ump_2: string | null;
  selection_version_home?: number | null; selection_version_away?: number | null;
}

export function toMatch(r: MatchRow): Match {
  return {
    id: r.id,
    matchDate: r.match_date || "",
    season: r.season || "",
    division: r.division || "",
    competitionType: r.competition_type || "",
    homeTeam: r.home_team || "",
    homeTeamScore: r.home_score || 0,
    awayTeam: r.away_team || "",
    awayTeamScore: r.away_score || 0,
    matchStatus: r.match_status || "",
    venue: r.venue || "",
    fixtureId: r.fixture_id || "",
    selectedPlayersHome: arr(r.selected_players_home),
    selectedPlayersAway: arr(r.selected_players_away),
    autoSelectEnabled: r.auto_select_enabled === true,
    homeKit: (r.home_kit || "") as KitColour,
    awayKit: (r.away_kit || "") as KitColour,
    ump1: r.ump_1 || "",
    ump2: r.ump_2 || "",
    selectionVersionHome: r.selection_version_home ?? 0,
    selectionVersionAway: r.selection_version_away ?? 0,
  };
}

export interface MatchCardRow {
  id: string; player: string | null; match: string | null; team: string | null; player_team: string | null;
  play_up: boolean; goalkeeper: boolean; jersey_number: number | null; goals_scored: number | null; cards: string[];
  u21: boolean; vp: boolean; captain: boolean; season: string | null; fixture_id: string | null; raw_player_name: string | null;
}

/** Unticked boxes and empty fields are left out, as they always were. */
export function toMatchCard(r: MatchCardRow): MatchCard {
  return {
    id: r.id,
    player: r.player ? [r.player] : undefined,
    match: r.match ? [r.match] : undefined,
    team: str(r.team),
    playerTeam: str(r.player_team),
    playUp: r.play_up || undefined,
    goalkeeper: r.goalkeeper || undefined,
    jersey: int(r.jersey_number),
    goals: int(r.goals_scored),
    cards: r.cards?.length ? r.cards : undefined,
    u21: r.u21 || undefined,
    vp: r.vp || undefined,
    captain: r.captain || undefined,
    season: str(r.season),
    fixtureId: str(r.fixture_id),
    rawPlayerName: str(r.raw_player_name),
  };
}

export interface ExceptionRow {
  id: string; player: string | null; match: string | null; availability_status: string | null; note: string | null;
  season: string | null; updated_at: string | null;
}

export function toException(r: ExceptionRow): AvailabilityException {
  return {
    id: r.id,
    player: r.player ? [r.player] : [],
    match: r.match ? [r.match] : [],
    availabilityStatus: r.availability_status || "",
    note: r.note || "",
    season: r.season || "",
    updatedAt: r.updated_at || "",
  };
}

export interface RuleRow {
  id: string; player: string | null; rule_type: string | null; availability: string | null; active: boolean;
  start_date: string | null; end_date: string | null; notes: string | null; last_modified: string | null;
}

export function toRule(r: RuleRow): AvailabilityRule {
  return {
    id: r.id,
    player: r.player ? [r.player] : [],
    ruleType: (r.rule_type || "") as AvailabilityRuleType | "",
    availability: (r.availability || "") as AvailabilityRule["availability"],
    active: r.active === true,
    startDate: r.start_date || "",
    endDate: r.end_date || "",
    notes: r.notes || "",
    lastModified: r.last_modified || "",
  };
}

export interface AbilityGroupRow { api_id: string; group_name: string | null; capacity: number | null; is_residual: boolean }

export function toAbilityGroup(r: AbilityGroupRow): AbilityGroupConfiguration {
  const group = r.group_name as AbilityGroupConfiguration["group"] | null;
  if (!group) return { id: r.api_id, group: "A", capacity: 0, isResidual: false };
  const capacity = Number(r.capacity ?? 0);
  return {
    id: r.api_id,
    group,
    capacity: Number.isFinite(capacity) && capacity >= 0 ? Math.floor(capacity) : 0,
    isResidual: Boolean(r.is_residual),
  };
}
