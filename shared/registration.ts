/**
 * The Hockey Convenor's HKHA registration screen (worker/src/registration.ts,
 * src/pages/Registration.tsx): every Active player's registration details,
 * who still needs registering this season, and what's missing before they
 * can be.
 *
 * Only the Hockey Convenor office opens it (the "registration" section,
 * auth.ts; owner, 6 Oct 2026): it carries HKID and passport numbers.
 */
import { isUnderEighteen } from "./declarations";

/**
 * Why a player is on the "Needs registering" list:
 *  - new:     no team at the end of last season (new to the section)
 *  - playUps: moved up automatically after too many play-ups this season
 *  - moved:   registered for another team earlier this season
 *  - season:  not yet registered for this season
 */
export type RegistrationReason = "new" | "playUps" | "moved" | "season";

export const REASON_LABEL: Record<RegistrationReason, string> = {
  new: "New player",
  playUps: "Moved up after play-ups",
  moved: "Changed team",
  season: "Not yet this season",
};

export interface RegistrationPlayer {
  /** People api id. */
  id: string;
  /** Preferred name and surname, as the club knows them. */
  name: string;
  /** People.Registered Team; null when none is set. */
  team: string | null;
  /** The team they ended last season in. */
  previousEos: string | null;
  shirtNo: number | null;
  /** HKHA format, "SURNAME Given Names". */
  registeredName: string | null;
  surname: string | null;
  givenNames: string | null;
  chineseName: string | null;
  hkidNo: string | null;
  passportNo: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  mobileNo: string | null;
  email: string | null;
  /** Signed links, valid for an hour or two. */
  files: { photo: string | null; hkid: string | null; passport: string | null; u18Form: string | null };
  /** When they were ticked off for this season and their current team; null while they need registering. */
  registeredAt: string | null;
  /** Set while they need registering. */
  reason: RegistrationReason | null;
  /** More on the reason: the team they moved from, and when. */
  reasonDetail: string | null;
}

export interface RegistrationBoard {
  season: string;
  /** Active players, by registered team then surname. */
  players: RegistrationPlayer[];
}

/**
 * What HockeyHK registration needs that the club doesn't hold, in the order
 * the Convenor would chase it. Empty when they're ready to register.
 */
export function missingDetails(p: RegistrationPlayer, today: string): string[] {
  const missing: string[] = [];
  if (!p.team) missing.push("Registered team");
  if (!p.registeredName) missing.push("Registered name");
  if (!p.dateOfBirth) missing.push("Date of birth");
  if (!p.nationality) missing.push("Nationality");
  if (!p.hkidNo && !p.passportNo) missing.push("HKID or passport number");
  else if (!p.files.hkid && !p.files.passport) missing.push("ID copy");
  if (!p.files.photo) missing.push("Photo");
  if (isUnderEighteen(p.dateOfBirth, today) && !p.files.u18Form) missing.push("U18 registration form");
  return missing;
}

/** Without an HKID a player registers as a visiting player, with restrictions (owner, 2026-10-01). */
export const isVisiting = (p: Pick<RegistrationPlayer, "hkidNo" | "passportNo">): boolean => !p.hkidNo && !!p.passportNo;

/** The download's columns, in HockeyHK's order (the Fillout registration list). */
export const REGISTRATION_CSV_HEADER = [
  "Team",
  "Shirt No",
  "Registered Name",
  "Surname",
  "Given Names",
  "Chinese Name",
  "Date of Birth",
  "HKID No.",
  "Passport No.",
  "Nationality",
  "Email",
  "Tel.",
  "Previous EOS",
  "Status",
];

export function registrationCsvRow(p: RegistrationPlayer): string[] {
  return [
    p.team ?? "",
    p.shirtNo?.toString() ?? "",
    p.registeredName ?? "",
    p.surname ?? "",
    p.givenNames ?? "",
    p.chineseName ?? "",
    p.dateOfBirth ?? "",
    p.hkidNo ?? "",
    p.passportNo ?? "",
    p.nationality ?? "",
    p.email ?? "",
    p.mobileNo ?? "",
    p.previousEos ?? "",
    p.reason ? REASON_LABEL[p.reason] : `Registered ${p.registeredAt?.slice(0, 10) ?? ""}`.trim(),
  ];
}
