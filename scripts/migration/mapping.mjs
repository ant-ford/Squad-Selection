// Airtable field -> Postgres column, for every table the import carries over.
// The import writes with this and the parity check compares with it, so the
// two cannot disagree about what a column should hold.
//
// Field decisions (keep / derive / file / child / link / drop) are in
// docs/migration/FIELDS.md. Anything not mapped here survives only in
// archive.airtable_records.

// ── Converters: Airtable value -> Postgres value ────────────────────────

export const text = (v) => {
  if (v && typeof v === "object" && !Array.isArray(v) && "value" in v) v = v.value; // aiText
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};
export const bool = (v) => v === true;
export const int = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null);
export const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
export const date = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
export const ts = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
export const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()) : []);
/** A link field's record ids. */
export const links = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.startsWith("rec")) : []);

// ── Tables with their own Airtable records ───────────────────────────────
// columns: { column: [airtableField, converter] }
// links:   { column: [airtableField, targetPgTable] }  (first linked record)

export const PEOPLE = {
  airtable: "People",
  table: "public.people",
  columns: {
    surname: ["Surname", text],
    given_names: ["Given Name(s)", text],
    preferred_name: ["Preferred Name", text],
    chinese_name: ["Chinese Name", text],
    registered_name: ["Registered Name", text],
    salutation: ["Salutation", text],
    email: ["Email", text],
    gender: ["Gender", text],
    status: ["Status", text],
    applicant_stage: ["Applicant Stage", text],
    stage_updated_at: ["Stage Updated At", ts],
    applicant_type: ["Applicant Type", text],
    application_date: ["Application Date", ts],
    join_date: ["Join Date", date],
    commitment_end_date: ["Commitment End Date", date],
    membership_no: ["Membership No.", text],
    member_type: ["Member Type", text],
    category_type: ["Category Type", text],
    sports_type: ["Sports Type", text],
    active: ["Active", bool],
    date_of_birth: ["Date of Birth", date],
    hkid_no: ["HKID No.", text],
    passport_no: ["Passport No.", text],
    nationality: ["Nationality", text],
    place_of_birth: ["Place of Birth", text],
    marital_status: ["Marital Status", text],
    arrived_in_hk_on: ["Date of arrival in Hong Kong", date],
    academic_qualifications: ["Academic Qualifications", list],
    ae_training: ["A&E Training", text],
    emergency_contact: ["Emergency Contact", text],
    emergency_contact_no: ["Emergency Contact No.", text],
    medical_conditions: ["Medical Conditions (if applicable)", text],
    telephone_no: ["Telephone No.", text],
    mobile_no: ["Mobile No.", text],
    home_flat_type: ["Home Flat/Room/Apartment/Suite", text],
    home_unit: ["Home Letter/Number/Reference", text],
    home_floor: ["Home Floor", text],
    home_block: ["Home Block", text],
    home_building: ["Home Building", text],
    home_street: ["Home Street", text],
    home_district: ["Home District", text],
    home_region: ["Home Region", text],
    company_name: ["Name of Company", text],
    business_flat_type: ["Business Flat/Room/Apartment/Suite", text],
    business_unit: ["Business Letter/Number/Reference", text],
    business_floor: ["Business Floor", text],
    business_block: ["Business Block", text],
    business_building: ["Business Building", text],
    business_street: ["Business Street", text],
    business_district: ["Business District", text],
    business_region: ["Business Region", text],
    work_position: ["Position", text],
    nature_of_business: ["Nature of Business", text],
    office_telephone_no: ["Office Telephone No.", text],
    office_email: ["Office Email Address", text],
    guardian_surname: ["Guardian/Parent Surname", text],
    guardian_given_names: ["Guardian/Parent Given Name(s)", text],
    guardian_bank_account_name: ["Guardian/Parent Bank Account Name", text],
    guardian_email: ["Guardian/Parent Email", text],
    guardian_mobile_no: ["Guardian/Parent Mobile No.", text],
    bill_payer: ["Bill-Payer", text],
    bank_name: ["Bank Name", text],
    bank_branch_no: ["Bank Branch No.", text],
    bank_account_no: ["Bank Account No.", text],
    bank_contact_no: ["Bank Contact No.", text],
    bank_payment_limit: ["Bank Payment Limit", text],
    bank_payment_limit_amount: ["Bank Payment Limit Amount", num],
    billing_channels: ["Billing Preferred Channel", list],
    correspondence_channels: ["Correspondence Preferred Channel", list],
    player_coach: ["Player/Coach", list],
    registered_team: ["Registered Team", text],
    selected_team_sos: ["Selected Team SOS", text],
    selected_team_eos: ["Selected Team EOS", text],
    previous_eos: ["Previous EOS", text],
    playing_position: ["Playing Position", text],
    playing_level: ["Playing Level", list],
    section_rank: ["Section Rank", int],
    rank_updated_at: ["Rank Updated At", ts],
    playing_ability: ["Playing Ability", text],
    selection_comments: ["Selection Comments/Coach Requests", text],
    opt_in_only: ["Opt-In Only", bool],
    is_visiting_player: ["Is Visiting Player", bool],
    is_suspended: ["Is Suspended", bool],
    matches_to_serve: ["Matches To Serve", int],
    qualified_coach: ["Qualified Coach", text],
    qualified_umpire: ["Qualified Umpire", text],
    hockey_committee_roles: ["Hockey Committee Roles", list],
    mens_sub_committee: ["Men's Sub-Committee", list],
    team_roles: ["Team Roles", list],
    touring_committee: ["Touring Committee", list],
    junior_hockey_volunteers: ["Junior Hockey Volunteers", list],
    easter_5s_committee: ["Easter 5s Committee", list],
    general_volunteers: ["General Volunteers", list],
    improvement_ideas: ["Improvement Ideas", text],
    participation_details: ["Participation Details", text],
    sports_background: ["Sports Background / Involvement", text],
    personal_interest: ["Personal / Family Interest", text],
    training_comments_sponsor: ["Applicant's Training Comments (Sponsor)", text],
    sports_background_sponsor: ["Sports Background (Sponsor)", text],
    applicant_level_sponsor: ["Applicant Level (Sponsor)", text],
    training_comments_draft: ["Training Comments", text],
    sports_background_draft: ["Sports Background / Achievement of the Applicant", text],
    profile_updated_at: ["Last Submission: Profile Update", ts],
    waivers_signed_at: ["Last Submission: Waivers & Declarations", ts],
  },
  links: {
    shirt_number_id: ["Shirt No.", "public.shirt_numbers"],
    sponsored_by_sponsor_id: ["Sponsored By Sponsor", "public.offices"],
    sponsored_by_chair_id: ["Sponsored By Chair", "public.offices"],
    sponsored_by_officer_id: ["Sponsored By Membership Officer", "public.offices"],
    sponsored_by_hockey_convenor_id: ["Sponsored By Hockey Convenor", "public.offices"],
    sponsored_by_kit_convenor_id: ["Sponsored By Kit Convenor", "public.offices"],
  },
};

export const SHIRT_NUMBERS = {
  airtable: "Shirt Numbers",
  table: "public.shirt_numbers",
  columns: {
    shirt_no: ["Shirt No.", int],
    team_range: ["Team Range", text],
    stock_size: ["Stock Size", text],
    gender: ["Gender", text],
  },
  links: {},
};

/** The six office tables become one, told apart by role. */
export const OFFICE_SOURCES = [
  { airtable: "Sponsors", role: "sponsor", emailField: null },
  { airtable: "Section Chairs", role: "section_chair", emailField: "Email" },
  { airtable: "Section Captains", role: "section_captain", emailField: "Email" },
  { airtable: "Membership Officers", role: "membership_officer", emailField: "Email" },
  { airtable: "Hockey Convenor", role: "hockey_convenor", emailField: "Email" },
  { airtable: "Kit Convenor", role: "kit_convenor", emailField: "Email" },
];

export const TEAMS = {
  airtable: "Teams",
  table: "public.teams",
  columns: {
    team_name: ["Team Name", text],
    team_rank: ["Team Rank", int],
    is_premier: ["Is Premier", bool],
    team_type: ["Team Type", text],
    active: ["Active", bool],
    target_squad_size: ["Target Squad Size", int],
  },
  links: {},
  /** Link fields that become team_people rows. */
  memberLinks: { coach: "Coach", team_captain: "Team Captain", section_captain: "Section Captain", auto_select: "Auto Select Players" },
};

export const MATCHES = {
  airtable: "Matches",
  table: "public.matches",
  columns: {
    match_key: ["Match Key", text],
    fixture_id: ["Fixture Id", text],
    match_date: ["Date", ts],
    division: ["Division", text],
    home_team: ["Home Team", text],
    home_score: ["Home Score", int],
    away_team: ["Away Team", text],
    away_score: ["Away Score", int],
    venue: ["Venue", text],
    home_kit: ["Home Kit", text],
    away_kit: ["Away Kit", text],
    ump_1: ["Ump 1", text],
    ump_2: ["Ump 2", text],
    match_status: ["Match Status", text],
    last_hkha_sync: ["Last HKHA Sync", ts],
    lock_hkha_sync: ["Lock HKHA Sync", bool],
    auto_select_enabled: ["Auto Select Enabled", bool],
  },
  links: {},
  selectionLinks: { home: "Selected Players Home", away: "Selected Players Away" },
};

export const MATCH_CARDS = {
  airtable: "Match Cards",
  table: "public.match_cards",
  columns: {
    raw_player_name: ["RawPlayerName", text],
    team: ["Team", text],
    player_team: ["Player Team", text],
    jersey_number: ["Jersey Number", int],
    goals_scored: ["Goals Scored", int],
    cards: ["Cards", list],
    captain: ["Captain", bool],
    goalkeeper: ["Goalkeeper", bool],
    vp: ["VP", bool],
    u21: ["U21", bool],
    fixture_id: ["Fixture Id", text],
  },
  links: {
    match_id: ["Match", "public.matches"],
    person_id: ["Player", "public.people"],
  },
};

export const AVAILABILITY_EXCEPTIONS = {
  airtable: "Availability Exceptions",
  table: "public.availability_exceptions",
  columns: {
    status: ["Availability Status", text],
    player_notes: ["Player Notes", text],
    updated_at: ["Updated At", ts],
  },
  links: {
    person_id: ["Player", "public.people"],
    match_id: ["Match", "public.matches"],
    updated_by_id: ["Updated By", "public.people"],
  },
};

export const AVAILABILITY_RULES = {
  airtable: "Availability Rules",
  table: "public.availability_rules",
  columns: {
    rule_type: ["Rule Type", text],
    availability: ["Availability", text],
    active: ["Active", bool],
    start_date: ["Start Date", date],
    end_date: ["End Date", date],
    notes: ["Notes", text],
    created_at: ["Created At", ts],
  },
  links: { person_id: ["Player", "public.people"] },
};

export const ABILITY_GROUPS = {
  airtable: "Ability Group Configuration",
  table: "public.ability_group_config",
  columns: {
    group_name: ["Group", text],
    capacity: ["Capacity", int],
    is_residual: ["Is Residual", bool],
  },
  links: {},
};

export const RANKING_EVENTS = {
  airtable: "Ranking Events",
  table: "public.ranking_events",
  columns: {
    actor_email: ["Actor Email", text],
    kind: ["Kind", text],
    old_rank: ["Old Rank", int],
    new_rank: ["New Rank", int],
    justification: ["Justification", text],
    occurred_at: ["Timestamp", ts],
  },
  links: {
    person_id: ["Player", "public.people"],
    actor_id: ["Actor", "public.people"],
  },
};

export const HKHA_SYNC_STATE = {
  airtable: "HKHA Sync State",
  table: "public.hkha_sync_state",
  columns: {
    fixture_id: ["Fixture Id", text],
    last_scraped: ["Last Scraped", ts],
    match_card_imported: ["Match Card Imported", bool],
    last_match_card_refresh: ["Last Match Card Refresh", ts],
    source_team: ["Source Team", text],
    sync_status: ["Sync Status", text],
    error_message: ["Error Message", text],
    refresh_count: ["Refresh Count", int],
    hash: ["Hash", text],
  },
  links: { match_id: ["Match", "public.matches"] },
};

export const COMMITMENTS = {
  airtable: "Commitments",
  table: "public.commitments",
  columns: {
    year_no: ["Year #", int],
    period_start: ["Period Start", date],
    period_end: ["Period End", date],
    review_progress: ["Review Progress", text],
    review_progress_updated_at: ["Review Progress Updated At", ts],
    matches_played: ["Matches: Played", int],
    matches_available_not_played: ["Matches: Available (Did Not Play)", int],
    matches_not_available: ["Matches: Not Available", int],
    matches_team_played: ["Matches: Team Played", int],
    teams_played: ["Player: Teams Played", list],
    games_umpired: ["# Games Umpired", text],
    practices: ["Practices", text],
    social_functions: ["Social Functions", list],
    other_contributions: ["Other Contributions", text],
    section_service_member: ["Potential for Section service and involvement (Member)", text],
    hkfc_service_member: ["Potential for HKFC service and involvement (Member)", text],
    low_participation_reason: ["Player: Reason for low participation", text],
    member_submitted_at: ["Member Submission Date", ts],
    section_service_sponsor: ["Potential for Section service and involvement (Sponsor)", text],
    hkfc_service_sponsor: ["Potential for HKFC service and involvement (Sponsor)", text],
    recommendation_sponsor: ["Recommendation (Sponsor)", text],
    sponsor_submitted_at: ["Sponsor Submission Date", ts],
    players_available_for_team: ["Players Available for this Team", int],
    optimum_players_for_team: ["Optimium # Players for this team", int],
    is_player_needed_officer: ["Is Player Needed (Membership Officer)", text],
    other_comments_officer: ["Other Comments (Membership Officer)", text],
    other_information_officer: ["Other relevant information about the candidate (Membership Officer)", text],
    recommended_reduction: ["Recommended Commitment Reduction", text],
    officer_submitted_at: ["Membership Officer Submission Date", ts],
    section_service_draft: ["Potential for Section service and involvement (AI)", text],
    hkfc_service_draft: ["Potential for HKFC service and involvement (AI)", text],
    recommendation_draft: ["Recommendation (AI)", text],
    is_player_needed_draft: ["Is Player Needed (AI)", text],
    other_comments_draft: ["Other Comments (AI)", text],
    other_information_draft: ["Other relevant information about the candidate (AI)", text],
    outcome_email_draft: ["Outcome Draft Email", text],
  },
  links: {
    person_id: ["People", "public.people"],
    sponsor_office_id: ["Sponsor", "public.offices"],
    membership_officer_office_id: ["Membership Officers", "public.offices"],
  },
};

export const MESSAGE_TEMPLATES = {
  airtable: "Message Templates",
  table: "public.message_templates",
  columns: {
    name: ["Name", text],
    body: ["Message", text],
    masters_o40_team: ["Masters O40 Team", text],
  },
  links: {},
};

export const MESSAGE_LOG = {
  airtable: "Message Log",
  table: "public.message_log",
  columns: {
    message: ["Personalized Message", text],
    mobile_no: ["Mobile No.", text],
    sent_at: ["Sent At", ts],
  },
  links: {
    person_id: ["People", "public.people"],
    template_id: ["Template Used", "public.message_templates"],
  },
};

/** Tables imported 1:1 (own records, own airtable_id), in dependency order. */
export const DIRECT = [
  SHIRT_NUMBERS, PEOPLE, TEAMS, MATCHES, MATCH_CARDS, AVAILABILITY_EXCEPTIONS, AVAILABILITY_RULES,
  ABILITY_GROUPS, RANKING_EVENTS, HKHA_SYNC_STATE, COMMITMENTS, MESSAGE_TEMPLATES, MESSAGE_LOG,
];

/** Every Airtable table read (and copied into archive.airtable_records). */
export const ALL_AIRTABLE_TABLES = [
  "People", "Commitments", "Matches", "Availability Exceptions", "Match Cards", "Teams",
  "Section Captains", "Section Chairs", "Membership Officers", "Sponsors", "Hockey Convenor", "Kit Convenor",
  "Shirt Numbers", "Message Log", "Availability Rules", "Message Templates", "Ability Group Configuration",
  "HKHA Sync State", "Ranking Events", "Trials History", "Registration Events", "Membership Events",
];

// ── Child rows built from People's numbered column groups ────────────────

const has = (row) => Object.values(row).some((v) => v !== null && !(Array.isArray(v) && v.length === 0));

const SPOUSE_COLUMNS = {
  surname: "Surname", given_names: "Given Name(s)", chinese_name: "Chinese Name", salutation: "Salutation",
  date_of_birth: "Date of Birth", gender: "Gender", hkid_no: "HKID No.", passport_no: "Passport No.",
  nationality: "Nationality", email: "Personal Email Address", mobile_no: "Mobile No.",
  wedding_anniversary: "Wedding Anniversary", company_name: "Name of Company",
  business_flat_type: "Business Flat/Room/Apartment/Suite", business_unit: "Business Letter/Number/Reference",
  business_floor: "Business Floor", business_block: "Business Block", business_building: "Business Building",
  business_street: "Business Street", business_district: "Business District", business_region: "Business Region",
  work_position: "Position", nature_of_business: "Nature of Business", office_email: "Office Email Address",
  office_telephone_no: "Office Telephone No.",
};
const DATE_COLUMNS = new Set(["date_of_birth", "wedding_anniversary"]);

export function familyRows(f) {
  const rows = [];
  const spouse = {};
  for (const [col, name] of Object.entries(SPOUSE_COLUMNS)) {
    spouse[col] = DATE_COLUMNS.has(col) ? date(f[`Spouse: ${name}`]) : text(f[`Spouse: ${name}`]);
  }
  if (has(spouse)) rows.push({ relation: "spouse", ordinal: 1, ...spouse, filesPrefix: "Spouse: " });
  for (let n = 1; n <= 4; n++) {
    const child = {
      surname: text(f[`Child ${n}: Surname`]),
      given_names: text(f[`Child ${n}: Given Name(s)`]),
      date_of_birth: date(f[`Child ${n}: Date of Birth`]),
      gender: text(f[`Child ${n}: Gender`]),
      hkid_no: text(f[`Child ${n}: HKID / Passport No.`]),
    };
    if (has(child)) rows.push({ relation: "child", ordinal: n, ...child, filesPrefix: `Child ${n}: ` });
  }
  return rows;
}

export function relativeRows(f) {
  const rows = [];
  for (let n = 1; n <= 3; n++) {
    const r = {
      ordinal: n,
      name: text(f[`Relative ${n}: Name`]),
      membership_no: text(f[`Relative ${n}: Membership No.`]),
      relationship: text(f[`Relative ${n}: Relationship`]),
    };
    if (r.name || r.membership_no || r.relationship) rows.push(r);
  }
  return rows;
}

export function previousClubRows(f) {
  const rows = [];
  for (let n = 1; n <= 4; n++) {
    const r = { ordinal: n, club: text(f[`Club ${n}`]), since_year: int(f[`Club ${n} Year`]) };
    if (r.club || r.since_year !== null) rows.push(r);
  }
  return rows;
}

export function applicantTrialRows(f) {
  const rows = [];
  for (let n = 1; n <= 5; n++) {
    const r = {
      ordinal: n,
      trial_date: date(f[`Trial ${n}: Date`]),
      participation_types: list(f[`Trial ${n}: Participation Type`]),
      highest_division: text(f[`Trial ${n}: Highest Division`]),
    };
    if (r.trial_date || r.participation_types.length || r.highest_division) rows.push(r);
  }
  return rows;
}

export function quizRows(f) {
  const rows = [];
  for (const quiz of ["Hockey Rules Quiz 1.0", "Hockey Rules Quiz 2.0", "Hockey Rules Quiz 3.0"]) {
    const score = num(f[quiz]);
    if (score !== null) rows.push({ quiz, score });
  }
  return rows;
}

/** Kukri sizes are the unlabelled fields; Tsunami's carry "(Tsunami)". */
export const KIT_FIELDS = [
  ["Kukri", "shirt", "Shirt Size"], ["Kukri", "shorts", "Shorts Size"], ["Kukri", "socks", "Socks Size"],
  ["Tsunami", "shirt", "Shirt Size (Tsunami)"], ["Tsunami", "shorts", "Shorts Size (Tsunami)"], ["Tsunami", "socks", "Socks Size (Tsunami)"],
  ["Kukri", "goalie_smock", "Goalie Smock Size"], ["Kukri", "goalie_smock_style", "Goalie Smock Style"],
];
export function kitRows(f) {
  return KIT_FIELDS.map(([supplier, item, field]) => ({ supplier, item, size: text(f[field]) })).filter((r) => r.size);
}

/** The season the current planning answers were given for. */
export const CURRENT_PLAN_SEASON = "2026-2027";
export function seasonPlanRow(f) {
  const r = {
    season: CURRENT_PLAN_SEASON,
    playing_availability: list(f["Playing Availability"]),
    tournament_interest: list(f["Tournament Interest"]),
    tour_interest: list(f["Tour Interest"]),
    trials_availability: list(f["Trials Availability"]),
    playing_preference: text(f["Playing Preference"]),
    captaincy_interest: text(f["Team Captain/Vice-Captain Interest"]),
  };
  const { season, ...answers } = r;
  return has(answers) ? r : null;
}

export const UMPIRE_COURSE = "Umpire course 2026-08-24";
export function courseRows(f) {
  const r = {
    course: UMPIRE_COURSE,
    signed_up: text(f["Umpire Course Sign-Up (2026.08.24)"]),
    attended: text(f["Umpire Course Attendance"]),
  };
  return r.signed_up || r.attended ? [r] : [];
}

// ── Files ────────────────────────────────────────────────────────────────

/** Attachment fields carried over, by owner, with the kind each becomes. */
export const PERSON_FILES = {
  Photo: "photo",
  Signature: "signature",
  HKID: "hkid",
  "Marriage Certificate": "marriage_certificate",
  "Guardian/Parent Account Signature": "guardian_account_signature",
  "Guardian/Parent Consent Signature": "guardian_consent_signature",
  "U18 Registration Form": "u18_registration_form",
  "Sports Associate Application Form": "application_form",
  "Sponsor Page 7": "sponsor_page_7",
  "Section Membership Application Form": "section_membership_form",
  "Commitment Pledge": "commitment_pledge",
};
export const FAMILY_FILES = { Photo: "photo", Signature: "signature", HKID: "hkid", "Birth Certificate": "birth_certificate" };
export const COMMITMENT_FILES = { "Sponsor Signature": "sponsor_signature", "Player Statement": "player_statement" };

/** U18 forms are kept only for people under 18 on 1 Sep 2026 (owner, 2026-09-29). */
export const U18_CUTOFF_BIRTHDATE = "2008-09-01"; // born on or before this: 18+ on 1 Sep 2026

/** Why an attachment is not carried over, or null to carry it over. */
export function fileSkipReason(kind, personFields) {
  if (kind === "u18_registration_form") {
    const dob = date(personFields["Date of Birth"]);
    if (dob && dob <= U18_CUTOFF_BIRTHDATE) return "u18-form-for-adult";
  }
  if (kind === "sponsor_page_7" && Array.isArray(personFields["Sports Associate Application Form"]) && personFields["Sports Associate Application Form"].length > 0) {
    return "page-7-inside-application-form";
  }
  return null;
}

/** R2 key for an imported attachment: deterministic (so a re-run skips it) and free of personal data. */
export const importedFileKey = (attachmentId) => `files/airtable/${attachmentId}`;

// ── Rules both the import and the parity check apply ─────────────────────

/**
 * People sharing an email (Airtable cannot stop it; Postgres will): the
 * Active one, else the first, keeps it. Returns the groups and the record
 * ids imported without an email.
 */
export function sharedEmails(people) {
  const byEmail = new Map();
  for (const r of people) {
    const e = text(r.fields?.Email)?.toLowerCase();
    if (e) (byEmail.get(e) ?? byEmail.set(e, []).get(e)).push(r);
  }
  const groups = [...byEmail.values()].filter((g) => g.length > 1);
  const losers = new Set();
  for (const g of groups) {
    const keeper = g.find((r) => r.fields?.Active === true) ?? g[0];
    for (const r of g) if (r !== keeper) losers.add(r.id);
  }
  return { groups, losers };
}

/** One availability answer per player per match: the most recently updated wins. */
export function dedupeExceptions(records) {
  const best = new Map();
  const dropped = [];
  for (const r of records) {
    const key = `${links(r.fields?.Player)[0] ?? r.id}|${links(r.fields?.Match)[0] ?? r.id}`;
    const at = ts(r.fields?.["Updated At"]) ?? r.createdTime ?? "";
    const prev = best.get(key);
    if (!prev) { best.set(key, { r, at }); continue; }
    if (at > prev.at) { dropped.push({ record: prev.r.id, kept: r.id }); best.set(key, { r, at }); }
    else dropped.push({ record: r.id, kept: prev.r.id });
  }
  return { kept: [...best.values()].map((x) => x.r), dropped };
}

/** A shirt number held by two people: the first keeps it. */
export function sharedShirts(people) {
  const holder = new Map();
  const losers = new Map();
  for (const r of people) {
    const s = links(r.fields?.["Shirt No."])[0];
    if (!s) continue;
    if (holder.has(s)) losers.set(r.id, holder.get(s));
    else holder.set(s, r.id);
  }
  return losers;
}

// ── Membership Events -> activity log (field names only, never values) ──

export const MEMBERSHIP_EVENT_FIELDS = {
  Approved: ["status", "applicant_stage", "join_date", "commitment_end_date", "membership_no"],
  Notified: ["review_progress"],
  Exported: [],
};
