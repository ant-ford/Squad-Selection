import { HttpError } from "./http";
import { normalizeEmail } from "../../shared/normalizeEmail";
import type { Env } from "./env";
import type { Office, OfficerRole } from "./reference";
import { getCached, invalidateCache } from "./cache";
import { FRESH_HEADER, FRESH_WINDOW_MS } from "../../shared/freshHeader";
import { PIPELINE_STAGES, ACCEPTED_STAGE } from "../../shared/membershipStages";
import { noteRequestPerson, noteRequestVersions, onRequestWrite } from "./requestContext";
import { authContexts, type AuthContext, type AuthPerson, type HeldOffice } from "./authContext";
import { raiseVersionFloor, withVersionFloor, type CacheVersions } from "./cacheVersions";

/** Applicants who may sign in: anyone in the New Joiner pipeline before acceptance. */
const APPLICANT_SIGN_IN_STAGES = PIPELINE_STAGES.filter((s) => s !== ACCEPTED_STAGE);

// One definition for the whole app, browser included - see the module for
// why every store in this system disagrees about case.
export { normalizeEmail } from "../../shared/normalizeEmail";

export interface AuthorizedUser {
  /** Verified, normalized email from the Supabase session. */
  email: string;
  /** The matched People record's api id. */
  personId: string;
  /** The same record's uuid (people.id). */
  personUuid: string;
  /** The matched People record, as auth_context read it for this request. */
  person: AuthPerson;
  /** "coach" when the person holds any coach / section-captain relationship. */
  role: "player" | "coach";
  /**
   * Team names this person coaches (Teams.Coach link). A Section Captain's
   * and the Assistant Director of Hockey's list is every team name,
   * regardless of Active status - they see the whole section everywhere,
   * the most permissive existing path.
   */
  coachTeams: string[];
  isSectionCaptain: boolean;
  /**
   * Active Membership Officer, Section Chair and Section Captain rows linked
   * to this person.
   * Empty for almost everyone. Holding any office grants application access
   * on its own, like a coach link: an officer need not be a playing member.
   */
  officerRoles: OfficerRole[];
  /** Every Active office row they hold, sponsors and social secretaries included. */
  offices: HeldOffice[];
  /** Active teams they captain (Teams.Team Captain). */
  captainTeams: string[];
  /** Teams they are social secretary of (team_people role social_secretary). */
  socialSecretaryTeams: { id: string; name: string }[];
  /** In the club's umpire pool (umpiring.ts). */
  umpire: boolean;
  /** The database's cache versions, read with the person at the start of the request. */
  versions: CacheVersions;
}

/**
 * Full application authorization:
 *
 *   Supabase JWT -> verified email -> People record -> Teams links -> AuthorizedUser
 *
 * Access rules (People table is the source of truth):
 *  - the email must exist in People (case-insensitive, whitespace-normalized)
 *  - Active = true grants normal player access
 *  - coaches / section captains may be Active = false and are still allowed
 *  - the Teams table linked Coach / Section Captain fields are the ONLY
 *    source of coach access - computed once, here, for the whole request
 *  - an Active Membership Officer, Section Chair or Section Captain row
 *    linked to the person also grants access with Active = false, and never
 *    grants coach access
 */
/**
 * The signed-in email, confirmed by Supabase, without looking for a People
 * record: only for signing up from a member's link (trials.ts), where there
 * isn't one yet.
 */
export async function requireVerifiedEmail(request: Request, env: Env): Promise<string> {
  return normalizeEmail(await verifySupabaseSession(request, env));
}

export async function requireAuthorizedUser(request: Request, env: Env): Promise<AuthorizedUser> {
  // Supabase checks the session on every request (owner decision,
  // 2026-10-06). The person's facts don't wait for it: auth_context starts
  // at the same time, for the email the token CLAIMS, and its answer is
  // used only when Supabase confirms that same email. Otherwise (no
  // readable claim, or a different verified email) it is asked again for
  // the verified one. One database call, with no re-lookups behind it.
  const claimed = claimedEmail(request);
  // The app marks requests made in the 10 s after its own write (FRESH_HEADER):
  // those read auth_context afresh, so the person always sees their own write.
  const fresh = request.headers.get(FRESH_HEADER) === "1";
  const early = claimed ? loadAuthContext(env, claimed, fresh) : null;
  // A rejected token must answer 401, whatever the early read did.
  early?.catch(() => undefined);
  const normalizedEmail = normalizeEmail(await verifySupabaseSession(request, env));
  const context = early && claimed === normalizedEmail ? await early : await loadAuthContext(env, normalizedEmail, fresh);
  return authorize(normalizedEmail, context);
}

/**
 * How long an isolate reuses one email's auth_context answer (owner
 * decision, 2026-10-07). A screen opens several endpoints at once, and a
 * player taps through a few in a row: one database call serves them all.
 * Access is still decided on every request from the answer, and Supabase
 * still checks the session (60 s per token, verifySupabaseSession).
 */
const AUTH_CONTEXT_REUSE_MS = FRESH_WINDOW_MS;

const authContextKey = (email: string) => `auth-context:${email}`;

/**
 * auth_context for an email, shared by this isolate's requests for 10 s;
 * concurrent requests share one call (getCached's in-flight de-dup).
 * Keyed by email, never by token: the answer is about the email, and is
 * used only once Supabase has confirmed the request is that email's.
 */
async function loadAuthContext(env: Env, email: string, fresh = false): Promise<AuthContext> {
  if (fresh) invalidateCache(authContextKey(email));
  const { data, fromCache } = await getCached(authContextKey(email), () => authContexts(env).load(email), AUTH_CONTEXT_REUSE_MS);
  if (!fromCache) raiseVersionFloor(data.versions);
  return data;
}

// A write drops the writer's reused answer in this isolate, so their next
// request reads auth_context again, with the versions their write moved:
// they see it at once.
onRequestWrite((context) => {
  if (context.email) invalidateCache(authContextKey(context.email));
});

/** The access rules, applied to what auth_context read. Throws 403 on denial. */
export function authorize(normalizedEmail: string, context: AuthContext): AuthorizedUser {
  const player = context.person;
  if (!player) {
    console.warn(`Access denied - no People record matched email ${normalizedEmail}`);
    throw new HttpError("Application access is not authorised.", 403, "APPLICATION_ACCESS_DENIED");
  }

  const isActive = player.active === true;

  // Teams table linked fields are the ONLY source of coach access. Uses ALL
  // team records (not just active ones) so a person's access never depends
  // on whether their team record is temporarily marked inactive.
  const isSectionCaptain = context.teamSectionCaptain;
  // Coach status comes from the Teams.Coach link itself, never from the
  // team-name list below. That list only has teams with a non-empty Team
  // Name, so deriving access from it silently locked out anyone coaching a
  // team whose name was blank.
  const isTeamCoach = context.isTeamCoach;
  const officerRoles: OfficerRole[] = context.offices.flatMap((o) =>
    o.office && o.office !== "sponsor" ? [{ office: o.office as Office, designation: o.designation }] : [],
  );
  // The Assistant Director of Hockey coaches every team, like a Section
  // Captain's team link (owner decision, 2026-10-04).
  const coachesAllTeams = isSectionCaptain || officerRoles.some((r) => r.office === "assistantDirector");
  // Section Captains see every team everywhere - the most permissive of the
  // paths this used to be computed on, now the single definition.
  const coachTeams = coachesAllTeams ? context.allTeamNames : context.coachTeams;
  const isCoach = isTeamCoach || coachesAllTeams;

  // Applicants in the New Joiner process sign in to fill in their application.
  const isApplicant =
    player.status === "Applicant" &&
    (APPLICANT_SIGN_IN_STAGES as readonly string[]).includes(player.applicantStage ?? "");

  if (!isActive && !isCoach && officerRoles.length === 0 && !isApplicant) {
    // Logged with the matched record id: the commonest cause of a surprise
    // denial is a second People record sharing the email, so the record the
    // administrator is looking at is not the one that was matched.
    console.warn(
      `Access denied - matched People record ${player.id} for ${normalizedEmail} ` +
        `has Active=${JSON.stringify(player.active)}, no coach link and no active office`,
    );
    throw new HttpError("Your HKFC application access has been disabled.", 403, "APPLICATION_ACCESS_DENIED");
  }

  noteRequestPerson(player.id, normalizedEmail);
  // A reused answer's versions, raised to the newest this isolate has seen.
  const versions = withVersionFloor(context.versions);
  noteRequestVersions(versions);
  return {
    email: normalizedEmail,
    personId: player.id,
    personUuid: player.uuid,
    person: player,
    role: isCoach ? "coach" : "player",
    coachTeams,
    isSectionCaptain,
    officerRoles,
    offices: context.offices,
    captainTeams: context.captainTeams,
    socialSecretaryTeams: context.socialSecretaryTeams,
    umpire: context.umpire,
    versions,
  };
}

/**
 * The email an access token says it is for, NOT verified: only for starting
 * the read early. Null when the token isn't a readable JWT, has no email,
 * or has expired (Supabase would refuse it anyway).
 */
export function claimedEmail(request: Request): string | null {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))) as { email?: unknown; exp?: unknown };
    if (typeof claims.email !== "string" || !claims.email) return null;
    if (typeof claims.exp === "number" && claims.exp * 1000 <= Date.now()) return null;
    return normalizeEmail(claims.email);
  } catch {
    return null;
  }
}

/**
 * Coach-only gate for coach operations. A legitimate application user
 * without coach privileges gets 403 COACH_ACCESS_REQUIRED (the frontend
 * keeps them logged in) â€” distinct from application-access denial.
 */
export async function requireCoach(request: Request, env: Env): Promise<AuthorizedUser> {
  const user = await requireAuthorizedUser(request, env);
  if (user.role !== "coach") {
    throw new HttpError("Coach access required.", 403, "COACH_ACCESS_REQUIRED");
  }
  return user;
}

/**
 * A Section Captain: linked as Section Captain on a team (the
 * isSectionCaptain coach link) or holding the Section Captain office.
 * Coaches, the Men's Convenor and the Assistant Director of Hockey are not.
 */
export function isSectionCaptainUser(user: Pick<AuthorizedUser, "isSectionCaptain" | "officerRoles">): boolean {
  return user.isSectionCaptain || user.officerRoles.some((r) => r.office === "sectionCaptain");
}

/**
 * Section Captains only: making players active or inactive (owner
 * decision, 2026-10-06). 403 SECTION_CAPTAIN_REQUIRED otherwise, which,
 * like COACH_ACCESS_REQUIRED, keeps them signed in.
 */
export async function requireSectionCaptain(request: Request, env: Env): Promise<AuthorizedUser> {
  const user = await requireAuthorizedUser(request, env);
  if (!isSectionCaptainUser(user)) {
    throw new HttpError("Only Section Captains can do this.", 403, "SECTION_CAPTAIN_REQUIRED");
  }
  return user;
}

/**
 * The officers' sections of the app and the offices that open each one
 * (owner decision, 2026-09-25). Designation plays no part: any Active row in
 * one of the listed tables is enough.
 *
 *   membership - the membership board: Membership Officers, Section Captains
 *   chairman   - the chairman's email lists: Section Chairs, Section Captains
 *   kit        - kit orders, handing out and spares: the Kit Convenor and
 *                Section Captains (owner decision, 2026-09-30).
 *   planning   - every team's season plans: Section Captains (coaches see
 *                their own teams' through the coach screens).
 *   trials     - the trial sessions people registering to join choose
 *                from: Section Captains and the Assistant Director of
 *                Hockey (owner decision, 2026-10-04). Deciding on a
 *                registration stays with the Section Captains.
 *   registration - every Active player's HKHA registration details, HKID
 *                and passport numbers included: the Hockey Convenor ONLY,
 *                not the Section Captains (owner decision, 2026-10-06).
 *   people     - finding a person and their admin page and change history:
 *                the Membership Officer, the Men's Convenor and Section
 *                Captains (each sees only the blocks their own sections
 *                open).
 *   club       - offices (sponsors included) and teams' coaches, captains
 *                and squad sizes: Section Captains (owner decision,
 *                2026-10-06).
 *   dataChecks - records to put right (unlinked match cards, shared
 *                Registered Names, re-registrations to review, incomplete
 *                players, likely duplicates): the Men's Convenor and the
 *                Section Captains.
 */
export const SECTION_OFFICES = {
  membership: ["membershipOfficer", "sectionCaptain"],
  chairman: ["sectionChair", "sectionCaptain"],
  kit: ["kitConvenor", "sectionCaptain"],
  planning: ["sectionCaptain"],
  trials: ["sectionCaptain", "assistantDirector"],
  registration: ["hockeyConvenor"],
  people: ["membershipOfficer", "hockeyConvenor", "sectionCaptain"],
  club: ["sectionCaptain"],
  dataChecks: ["hockeyConvenor", "sectionCaptain"],
  // Suspensions: the Men's Convenor only (owner, 6 Oct 2026).
  discipline: ["hockeyConvenor"],
} as const satisfies Record<string, readonly Office[]>;

export type Section = keyof typeof SECTION_OFFICES;

/** The sections this person can open, in a fixed order. */
export function sectionsFor(user: Pick<AuthorizedUser, "officerRoles">): Section[] {
  return (Object.keys(SECTION_OFFICES) as Section[]).filter(
    (section) =>
      user.officerRoles.some((r) => (SECTION_OFFICES[section] as readonly Office[]).includes(r.office)),
  );
}

/**
 * Gate for one officers' section. 403 OFFICER_ACCESS_REQUIRED otherwise,
 * which, like COACH_ACCESS_REQUIRED, keeps them signed in.
 */
export async function requireSection(request: Request, env: Env, section: Section): Promise<AuthorizedUser> {
  const user = await requireAuthorizedUser(request, env);
  if (!sectionsFor(user).includes(section)) {
    throw new HttpError("Officer access required.", 403, "OFFICER_ACCESS_REQUIRED");
  }
  return user;
}

/** Gate for routes any one of several sections opens; the same 403 otherwise. */
export async function requireAnySection(request: Request, env: Env, sections: readonly Section[]): Promise<AuthorizedUser> {
  const user = await requireAuthorizedUser(request, env);
  const mine = sectionsFor(user);
  if (!sections.some((s) => mine.includes(s))) {
    throw new HttpError("Officer access required.", 403, "OFFICER_ACCESS_REQUIRED");
  }
  return user;
}

/**
 * How long a verified token is trusted without re-asking Supabase.
 *
 * Short on purpose. This is the only thing standing between a revoked session
 * and the API, so the window is measured in seconds - long enough to collapse
 * the burst of calls one screen makes, far short of the token's own lifetime.
 */
const SESSION_VERIFY_TTL_MS = 60 * 1000;

/**
 * Verifies the Supabase access token against /auth/v1/user and returns the
 * verified email. Throws 401 UNAUTHORIZED on any missing, invalid or
 * expired session.
 *
 * The verified result is cached briefly. Every authenticated route runs this
 * first, so an uncached check put a blocking round trip to Supabase in front
 * of every single request - and a screen that opens three endpoints at once
 * paid for it three times before any of them started work. Only successes are
 * cached; a rejected token throws before anything is stored.
 */
async function verifySupabaseSession(request: Request, env: Env): Promise<string> {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError("Missing Authorization header", 401, "UNAUTHORIZED");

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new HttpError("Server authentication not configured", 500);
  }

  // Keyed on the token itself: an exact match is the only way to be certain
  // one session is never answered with another's identity, and the token is
  // already in this isolate's memory alongside the email it maps to.
  const { data } = await getCached<string>(
    `session:${token}`,
    async () => {
      const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: env.SUPABASE_ANON_KEY,
        },
      });

      if (!resp.ok) {
        const detail = await resp.text();
        console.error("Supabase auth verification failed:", resp.status, detail);
        // Only Supabase saying "this token is not valid" is a 401. The app
        // signs a user out on 401, so answering one for a Supabase outage or
        // rate limit (5xx, 429) signed people out for something that was not
        // their session's fault. Those are a 503 the app can simply retry.
        if (resp.status === 401 || resp.status === 403) {
          throw new HttpError("Invalid or expired session", 401, "UNAUTHORIZED");
        }
        throw new HttpError("Sign-in service unavailable, please try again", 503, "AUTH_UNAVAILABLE");
      }

      const user = (await resp.json()) as { email?: string };
      if (!user.email) throw new HttpError("Session has no associated email", 401, "UNAUTHORIZED");
      return user.email;
    },
    SESSION_VERIFY_TTL_MS,
  );
  return data;
}
