/**
 * What auth.ts needs about a signed-in email, from ONE database call:
 * auth_context(p_email) (supabase/migrations/*_auth_context.sql). The
 * person, their team links, their Active offices, the umpire flag and the
 * cache versions. The access decisions stay in auth.ts; this only reads and
 * shapes the facts.
 */
import type { Env } from "./env";
import { db } from "./data/supabase";
import type { Office } from "./data/officers";
import type { Player } from "../../shared/schema/domainTypes";
import { parseCacheVersions, type CacheVersions } from "./cacheVersions";
import { fileLink } from "./data/supabase/files";

/**
 * The signed-in person: the Player fields (without the signed photo link,
 * which costs a signature and few screens show) plus their People uuid.
 */
export interface AuthPerson extends Player {
  /** people.id: what tables keyed on the person (event_responses, quizzes...) use. */
  uuid: string;
  /** The photo's files.id; fileLink() turns it into a link. */
  photoFileId?: string;
  profileUpdatedAt?: string;
}

/** One Active office row they hold, sponsors and social secretaries included. */
export interface HeldOffice {
  /** offices.role, e.g. "sponsor", "section_captain". */
  role: string;
  /** The app's name for the offices that open parts of the app; null for the others. */
  office: Office | null;
  designation: string;
}

export interface AuthContext {
  /** Null when no People record has the email. */
  person: AuthPerson | null;
  /** Any Teams.Coach link, whether or not the team has a name. */
  isTeamCoach: boolean;
  /** Names of the teams they coach (all teams, Active or not). */
  coachTeams: string[];
  /** A Teams.Section Captain link. */
  teamSectionCaptain: boolean;
  /** Every team name; only filled for a Section Captain link or the Assistant Director. */
  allTeamNames: string[];
  /** Active teams they captain. */
  captainTeams: string[];
  /** Teams they are social secretary of. */
  socialSecretaryTeams: { id: string; name: string }[];
  offices: HeldOffice[];
  umpire: boolean;
  versions: CacheVersions;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const int = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : undefined);

/** The person object, with the same blanks-as-unset rules as data/supabase/mappers.ts toPlayer. */
function toAuthPerson(r: Record<string, unknown>): AuthPerson {
  return {
    uuid: String(r.uuid),
    id: String(r.id),
    preferredName: str(r.preferredName),
    givenNames: str(r.givenNames),
    surname: str(r.surname),
    shirtNoValue: str(r.shirtNoValue),
    email: str(r.email),
    mobileNo: str(r.mobileNo),
    active: r.active === true,
    registeredTeam: str(r.registeredTeam),
    selectedTeamSos: str(r.selectedTeamSos),
    selectedTeamEos: str(r.selectedTeamEos),
    playingPosition: str(r.playingPosition),
    playingAbility: str(r.playingAbility),
    isVisitingPlayer: r.isVisitingPlayer === true,
    isSuspended: r.isSuspended === true,
    matchesToServe: int(r.matchesToServe),
    everRegisteredToPremier: r.everRegisteredToPremier === true,
    u21Eligible: r.u21Eligible === true,
    playerCoach: arr(r.playerCoach),
    sectionRank: int(r.sectionRank),
    status: str(r.status),
    applicantStage: str(r.applicantStage),
    optInOnly: r.optInOnly === true,
    birthday: str(r.birthday),
    photoFileId: str(r.photoFileId),
    profileUpdatedAt: str(r.profileUpdatedAt),
  };
}

/** auth_context()'s JSON -> AuthContext. Missing parts read as empty. */
export function parseAuthContext(raw: unknown): AuthContext {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const person = r.person && typeof r.person === "object" ? toAuthPerson(r.person as Record<string, unknown>) : null;
  const list = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[];
  return {
    person,
    isTeamCoach: r.isTeamCoach === true,
    coachTeams: arr(r.coachTeams),
    teamSectionCaptain: r.teamSectionCaptain === true,
    allTeamNames: arr(r.allTeamNames),
    captainTeams: Array.isArray(r.captainTeams) ? r.captainTeams.map((n) => (typeof n === "string" ? n : "")) : [],
    socialSecretaryTeams: list(r.socialSecretaryTeams).map((t) => ({ id: String(t.id), name: String(t.name ?? "") })),
    offices: list(r.offices).map((o) => ({
      role: String(o.role),
      office: (str(o.office) as Office | undefined) ?? null,
      designation: typeof o.designation === "string" ? o.designation : "",
    })),
    umpire: r.umpire === true,
    versions: parseCacheVersions(r.versions),
  };
}

/** The signed-in person as a Player, with their photo signed into a link (no read). */
export async function personAsPlayer(env: Env, person: AuthPerson): Promise<Player> {
  return { ...person, photo: person.photoFileId ? await fileLink(env, person.photoFileId) : undefined };
}

export interface AuthContextRepo {
  /** One call: everything auth.ts decides on for this (normalized) email. */
  load(email: string): Promise<AuthContext>;
}

/** The accessor tests replace (tests/helpers/fakeRepos.ts), like the data modules' ones. */
export function authContexts(env: Env): AuthContextRepo {
  return {
    async load(email) {
      return parseAuthContext(await db(env).rpcRead<unknown>("auth_context", { p_email: email }));
    },
  };
}
