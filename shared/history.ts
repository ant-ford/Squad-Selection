/**
 * A person's change history (GET /api/history): what was done to their
 * record, by whom and when, in plain words. Built from the activity log,
 * which holds field NAMES only, never values, and from the ranking events
 * that made them active or inactive.
 */

export interface HistoryEntry {
  /** ISO timestamp. */
  at: string;
  /** Who did it, by name; null for the system or someone no longer on record. */
  actor: string | null;
  /** The activity log's action, e.g. "admin-membership". */
  action: string;
  /** A short sentence for the list, e.g. "Membership details changed". */
  summary: string;
  /** What changed, as labels ("Member type"), never values. */
  fields: string[];
}

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
