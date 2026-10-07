/**
 * Change history (GET /api/history?person= or ?match=): what was done, by
 * whom and when, in plain words. Built from the activity log, the squad
 * changes (match_selection_changes) and the ranking events that made someone
 * active or inactive. The log keeps old and new values for non-personal
 * fields only (migration 20261007160004_change_history); personal fields
 * show by name.
 */

export interface HistoryEntry {
  /** ISO timestamp. */
  at: string;
  /** Who did it, by name; null for the system or someone no longer on record. */
  actor: string | null;
  /** When no person did it: the activity log's label ("eddy", "hkha-sync"), so the screen can show the wordmark for Eddy. */
  actorLabel?: string;
  /** The activity log's action, e.g. "admin-membership". */
  action: string;
  /** A short sentence for the list, e.g. "Membership details changed". */
  summary: string;
  /** What changed: labels ("Mobile"), or label and values for non-personal fields ("Position: Defender → Goalkeeper"). */
  fields: string[];
}

/** Who acted when no person did (activity_log.actor_label). */
export const ACTOR_LABELS: Record<string, string> = {
  "hkha-sync": "HKHA fixtures",
  eddy: "Eddy",
  sql: "the database",
};

/** Short labels for activity log actions. Unknown actions are worded from their name. */
export const ACTION_LABELS: Record<string, string> = {
  // People admin (worker/src/admin/)
  "admin-membership": "Membership details changed",
  "admin-stage": "Stage changed",
  "admin-squad": "Teams or position changed",
  "admin-junior-route": "Started the junior route",
  "admin-suspension-set": "Suspended",
  "admin-suspension-edit": "Suspension changed",
  "admin-suspension-clear": "Suspension cleared",
  "admin-office": "Office changed",
  "admin-person-create": "Added",
  "admin-team": "Team changed",
  "admin-team-role": "Team role changed",
  "admin-card-link": "Match card linked",
  "admin-reregistration-move": "Re-registered",
  "admin-reregistration-keep": "Kept on their team",
  // Ranking (ranking_events)
  activate: "Made active",
  deactivate: "Made inactive",
  // New joiners (joiners.ts) and trials (trials.ts)
  "joiner-create": "Added as a new joiner",
  "joiner-update": "New joiner details changed",
  "joiner-invite": "Invited to apply",
  "joiner-kit": "Kit requested",
  "joiner-registration": "HKHA registration requested",
  "trial-practice-invite": "Invited to a practice",
  "trial-declined": "Trial declined",
  // HKHA registration (registration.ts)
  "registration-registered": "Registered with HKHA",
  "registration-unregistered": "HKHA registration taken back",
  "registration-details": "Registration details changed",
  // Membership (data/supabase/crm.ts)
  approved: "Approved as a member",
  notified: "Asked for a commitment review",
  // Data retention
  remove_personal_data: "Personal details removed",
  delete_own_profile: "Deleted their profile",
  // Logged by the database (audit_row) and squad saves
  "row-update": "Changed",
  "row-insert": "Fixture added",
  "row-delete": "Fixture removed",
  "row-team-role": "Team role changed",
  "row-office-insert": "Office added",
  "row-office-update": "Office changed",
  "row-office-delete": "Office removed",
  "row-availability": "Availability answered for them",
  squad: "Squad changed",
};

/** Labels for the column names the log records. Unknown names are worded from the name. */
export const FIELD_LABELS: Record<string, string> = {
  member_type: "Member type",
  category_type: "Category",
  membership_no: "Membership number",
  join_date: "Join date",
  commitment_end_date: "Commitment end date",
  status: "Status",
  applicant_stage: "Stage",
  applicant_type: "Applicant type",
  registered_team: "Registered team",
  selected_team_sos: "Selected team (start of season)",
  selected_team_eos: "Selected team (end of season)",
  playing_position: "Position",
  registered_name: "Registered name",
  is_visiting_player: "Visiting player",
  active: "Active",
  review_progress: "Review progress",
  commitments: "Commitment periods",
  hkha_registrations: "HKHA registration",
  suspensions: "Suspension",
  sponsored_by_kit_convenor_id: "Kit Convenor",
  sponsored_by_hockey_convenor_id: "Men's Convenor",
  "match_cards.person_id": "Match card",
  // Offices and team roles, logged as "<role>" or "<role>:<team or retired>"
  coach: "Coach",
  team_captain: "Captain",
  section_captain: "Section Captain",
  membership_officer: "Membership Officer",
  section_chair: "Chairman",
  hockey_convenor: "Men's Convenor",
  kit_convenor: "Kit Convenor",
  assistant_director: "Assistant Director of Hockey",
  umpire_coordinator: "Umpire Coordinator",
  sponsor: "Sponsor",
  social_secretary: "Social Secretary",
  target_squad_size: "Target squad size",
  designation: "Designation",
  office_email: "Office email",
  // Logged by the database (audit_row)
  opt_in_only: "Opt-In Only",
  previous_eos: "Last season's team",
  playing_level: "Playing level",
  playing_ability: "Ability",
  player_coach: "Player or coach",
  sports_type: "Sports type",
  is_suspended: "Suspended",
  matches_to_serve: "Matches to serve",
  qualified_coach: "Coaching qualification",
  qualified_umpire: "Umpiring qualification",
  hkid_hidden: "HKID hidden",
  mobile_no: "Mobile",
  email: "Email",
  selection_comments: "Selection comments",
  auto_select: "Auto-select priority",
  match_date: "Date and time",
  venue: "Venue",
  division: "Division",
  home_team: "Home team",
  away_team: "Away team",
  home_kit: "Home kit",
  away_kit: "Away kit",
  home_score: "Home score",
  away_score: "Away score",
  ump_1: "Umpire 1",
  ump_2: "Umpire 2",
  match_status: "Status",
  fixture_id: "HKHA fixture",
  lock_hkha_sync: "Kept from HKHA updates",
  auto_select_enabled: "Auto-select",
  person_id: "Holder",
  player_notes: "Note",
};

const sentence = (s: string) => {
  const words = s.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? (sentence(action.replace(/^admin-/, "")) || "Changed");
}

/**
 * One logged field name as a label. Role entries carry a detail after a
 * colon: "coach:HKFC A" is "Coach, HKFC A"; "sponsor:retired" is "Sponsor,
 * retired".
 */
export function fieldLabel(field: string): string {
  const i = field.indexOf(":");
  const name = i < 0 ? field : field.slice(0, i);
  const detail = i < 0 ? "" : field.slice(i + 1).trim();
  const label = FIELD_LABELS[name] ?? sentence(name);
  return detail ? `${label}, ${detail}` : label;
}

const HK_WHEN = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Hong_Kong",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** A fixture's date and time in Hong Kong, e.g. "Sat 10 Oct, 14:30". */
export function matchWhen(iso: string | null | undefined): string {
  if (!iso) return "no date";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : HK_WHEN.format(d).replace(/,? (\d\d:\d\d)$/, ", $1");
}

/** One logged value as words: on/off, "none", a fixture time in Hong Kong. */
export function valueText(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "none";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  if (field === "match_date" && typeof value === "string") return matchWhen(value);
  return String(value);
}

/** A field that changed: "Position: Defender → Goalkeeper", or its label when no values were kept. */
export function changeText(field: string, values?: unknown): string {
  if (!Array.isArray(values) || values.length !== 2) return fieldLabel(field);
  return `${fieldLabel(field)}: ${valueText(field, values[0])} → ${valueText(field, values[1])}`;
}
