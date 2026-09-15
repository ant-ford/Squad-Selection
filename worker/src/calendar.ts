import type { Env } from "./env";
import { getPlayerByEmail, getReferenceData } from "./reference";
import { getPlayerFixtures, getUpcomingFixtures, getPlayedMatchesForSeasons } from "./fixtures";
import { getCached } from "./cache";
import { HttpError } from "./http";
import type { AuthorizedUser } from "./auth";
import { selectedDisplayTeam } from "../../shared/displayTeam";
import { availableLabel } from "../../shared/availableLabel";
import { currentSeason, previousSeason } from "./seasonContext";
import { buildTeamRecord, type Outcome, type TeamRecord } from "./teamRecord";

const MATCH_DURATION_MINUTES = 90;

/** A squad member as the calendar lists them. */
type SquadEntry = { name: string; shirtNo?: string; availabilityStatus?: string };

/**
 * Attach each fixture's season record and head-to-head. Played matches are
 * fetched once for the whole feed rather than per event - every fixture reads
 * the same list.
 *
 * Best effort. The FORM section is the one part of the feed that reads
 * beyond the fixtures themselves, and it is where the feed once fell over.
 * If that read fails the events still go out, without their form lines: a
 * calendar client that gets an error keeps showing whatever it fetched last,
 * so a failure here would freeze every subscriber on a stale feed.
 */
async function withTeamRecords(env: Env, fixtures: any[]): Promise<any[]> {
  const season = currentSeason();
  try {
    const played = await getPlayedMatchesForSeasons(env, [season, previousSeason(season) || ""]);
    return fixtures.map((f) => ({
      ...f,
      record: buildTeamRecord(played, f.hkfcTeam || "", f.opponent, season),
    }));
  } catch (err) {
    console.error("Calendar feed: form lines skipped, played matches unavailable:", err instanceof Error ? err.message : err);
    return fixtures;
  }
}

/**
 * The squad, one per line, the way a team sheet reads: shirt number first
 * where there is one, then the name. The only status worth a reader's
 * attention is marked - a selected player who answered "Maybe" is still in
 * the side but is not a certainty, and that is exactly what a teammate
 * reading the invitation wants to know.
 */
export function formatSquadLines(squad: SquadEntry[]): string[] {
  return squad.map((p) => {
    const name = p.shirtNo ? `#${p.shirtNo} ${p.name}` : p.name;
    return p.availabilityStatus === "Maybe" ? `${name} (Maybe)` : name;
  });
}

/**
 * "Saturday 4 October, 15:00 HKT". Match times are Hong Kong times, and the
 * event itself is what a travelling player's calendar will shift into their
 * local zone - so the body spells out the time everyone else is working to.
 */
function formatWhen(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("weekday")} ${get("day")} ${get("month")}, ${get("hour")}:${get("minute")} HKT`;
}

/** "20 November 2026" in Hong Kong time. */
function formatDay(iso: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    day: "numeric", month: "long", year: "numeric",
  }).format(new Date(iso));
}

const OUTCOME_WORD: Record<Outcome, string> = { win: "Won", draw: "Drew", loss: "Lost" };

/** This season's record and the last meeting, as the FORM section's lines. */
function formatFormLines(record: TeamRecord | undefined): string[] {
  if (!record) return [];
  const lines: string[] = [];
  if (record.played > 0) {
    lines.push(`This season: ${record.won}W ${record.drawn}D ${record.lost}L (${record.played} played)`);
  }
  const last = record.lastMeeting;
  if (last) {
    const where = last.isHome ? "home" : `away at ${last.venue || "TBD"}`;
    lines.push(
      `Last meeting: ${OUTCOME_WORD[last.outcome]} ${last.goalsFor}-${last.goalsAgainst}, ${formatDay(last.date)} (${where})`,
    );
  }
  return lines;
}

/**
 * The event body, laid out in labelled sections.
 *
 * Calendar clients render DESCRIPTION in a proportional font, so columns
 * cannot be aligned with padding the way an email can. Capitalised section
 * headings and "Label: value" lines are what survives that and still reads
 * as something composed rather than dumped.
 *
 * A section with no lines is dropped whole, so a fixture with no result
 * history behind it doesn't carry an empty FORM heading.
 */
function buildDescription(sections: { heading?: string; lines: string[] }[]): string {
  const blocks = sections
    .filter((s) => s.lines.length > 0)
    .map((s) => (s.heading ? [s.heading, ...s.lines] : s.lines).join("\n"));
  return [...blocks, "Sent by Eddy · HKFC Men's Hockey squad management"].join("\n\n");
}

// --- Utility Functions ---

function escapeIcsText(text: string | undefined | null): string {
  if (!text) return "";
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** UTF-8 length of one character, which is what RFC 5545's limit counts. */
function octets(char: string): number {
  const cp = char.codePointAt(0) ?? 0;
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

const FOLD_LIMIT_OCTETS = 75;

/**
 * RFC 5545 line folding: no line longer than 75 octets, continuation lines
 * begin with a space that counts towards their own 75.
 *
 * Counted in octets and split between whole characters, not at string
 * indices. The previous version cut at 75 UTF-16 code units, so a line with
 * emoji or curly punctuation went out over the limit, and a cut landing
 * inside an emoji's surrogate pair produced two half-characters that came
 * out as garbage in the client.
 */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = "";
  let used = 0;
  let limit = FOLD_LIMIT_OCTETS;
  for (const char of line) {
    const size = octets(char);
    if (used + size > limit) {
      out.push(current);
      current = " ";
      used = 1;
      limit = FOLD_LIMIT_OCTETS;
    }
    current += char;
    used += size;
  }
  out.push(current);
  return out.join("\r\n");
}

function formatIcsLocalTime(date: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: "Asia/Hong_Kong",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  };
  const parts = new Intl.DateTimeFormat("en-US", options).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "00";
  return `${get("year")}${get("month")}${get("day")}T${get("hour")}${get("minute")}${get("second")}`;
}

function formatIcsUtcTime(date: Date): string {
  // DTSTAMP must be UTC: YYYYMMDDTHHMMSSZ
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

async function hmacSign(secret: string, message: string): Promise<string> {
  if (!secret) throw new Error("CALENDAR_SECRET is not set in environment variables");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Constant-time comparison of two hex-encoded HMAC signatures. A plain `===`
 * short-circuits on the first mismatched character, leaking timing
 * information an attacker could use to guess a valid signature byte by byte.
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// --- ICS Generators ---

function generateIcsPayload(events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HKFC Squad Selection//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:HKFC Fixtures",
    "X-WR-TIMEZONE:Asia/Hong_Kong",
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Hong_Kong",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETTO:+0800",
    "TZOFFSETFROM:+0000",
    "TZNAME:HKT",
    "END:STANDARD",
    "END:VTIMEZONE",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}

function formatVEvent(fixture: any, isPlayerFeed: boolean, teamSquad: SquadEntry[] = []): string {
  const isHome = fixture.isHome;
  const cleanId = fixture.id.replace(/-home$/, "").replace(/-away$/, "");
  const uid = `${cleanId}-${isHome ? "home" : "away"}@hkfc-squad.app`;

  const startDate = new Date(fixture.date);
  const endDate = new Date(startDate.getTime() + MATCH_DURATION_MINUTES * 60000);

  const teamName = fixture.hkfcTeam || (isHome ? fixture.homeTeam : fixture.awayTeam);
  let summaryPrefix = "";
  let summarySuffix = "";
  // RFC 5545 only permits TENTATIVE | CONFIRMED | CANCELLED for VEVENT STATUS.
  let status = "CONFIRMED";
  // Whether the event blocks the player's time. A game they have declined
  // should not show them as busy.
  let transparent = false;
  const declined = isPlayerFeed
    && fixture.selectionStatus !== "Selected"
    && fixture.availabilityStatus === "Unavailable";

  if (isPlayerFeed) {
    const isSelected = fixture.selectionStatus === "Selected";
    const isMaybe = fixture.availabilityStatus === "Maybe";
    if (isSelected) {
      summaryPrefix = "✅ ";
      status = "CONFIRMED";
    } else if (declined) {
      // The game is still on and still the team's, so it stays in the
      // calendar as a real event - marked as one the player has said no to.
      // It used to go out as CANCELLED, which most clients take literally
      // and hide or strike through, so the fixture looked called off.
      summaryPrefix = "❌ ";
      summarySuffix = " (declined)";
      status = "CONFIRMED";
      transparent = true;
    } else if (isMaybe) {
      // A Maybe is a different thing from an unanswered fixture, and the one
      // the player most needs to come back to.
      summaryPrefix = "❓ ";
      status = "TENTATIVE";
    } else {
      summaryPrefix = "🟦 ";
      status = "TENTATIVE";
    }
  }

  // Kit is shown as a coloured circle in the title rather than the iCalendar
  // COLOR property: COLOR (RFC 7986) is honoured by very few clients, and a
  // white event on a white grid is invisible in the ones that do. The emoji
  // renders everywhere and survives the text-only views. Not on a declined
  // game: which shirt to bring is not this player's question.
  const kitIcon = declined ? "" : fixture.kit === "Blue" ? " 🔵" : fixture.kit === "White" ? " ⚪" : "";
  const summary = `${summaryPrefix}${teamName} vs ${fixture.opponent}${summarySuffix}${kitIcon}`;

  const matchSection = [
    ...(fixture.kit ? [`Kit: ${fixture.kit}`] : []),
    `Venue: ${fixture.venue || "TBD"}`,
    `Division: ${fixture.division || "TBD"}`,
  ];

  let description = "";
  if (isPlayerFeed) {
    const isSelected = fixture.selectionStatus === "Selected";
    // No answer counts as available - that is the app's own default - so the
    // line reads "Going" for a selected player and "Available" otherwise.
    const availability =
      !fixture.availabilityStatus || fixture.availabilityStatus === "Available"
        ? availableLabel(isSelected)
        : fixture.availabilityStatus;
    // Category mirrors the player dashboard (My Team / Play-Up Opportunity /
    // Support Fixture) so the calendar matches what the player sees.
    const categoryLabels: Record<string, string> = {
      own: "My Team",
      "play-up": "Play-Up Opportunity",
      support: "Support Fixture",
    };
    const squad: SquadEntry[] = fixture.squad ?? [];
    description = buildDescription([
      { lines: [`${teamName} vs ${fixture.opponent}`, formatWhen(startDate)] },
      {
        heading: "YOUR PLACE",
        lines: [
          `Selection: ${isSelected ? "Selected" : "Not yet selected"}`,
          `Availability: ${availability}`,
          ...(categoryLabels[fixture.fixtureCategory]
            ? [`Category: ${categoryLabels[fixture.fixtureCategory]}`]
            : []),
        ],
      },
      { heading: "MATCH", lines: matchSection },
      { heading: "FORM", lines: formatFormLines(fixture.record) },
      {
        heading: squad.length > 0 ? `SQUAD (${squad.length})` : "",
        lines: formatSquadLines(squad),
      },
    ]);
  } else {
    description = buildDescription([
      { lines: [`${teamName} vs ${fixture.opponent}`, formatWhen(startDate)] },
      {
        heading: "SELECTION",
        lines: [`Squad: ${fixture.selectedCount}/${fixture.targetSquadSize} selected`],
      },
      { heading: "MATCH", lines: matchSection },
      { heading: "FORM", lines: formatFormLines(fixture.record) },
      {
        heading: teamSquad.length > 0 ? `SQUAD (${teamSquad.length})` : "",
        lines: formatSquadLines(teamSquad),
      },
    ]);
  }

  const location = escapeIcsText(fixture.venue || "TBD");

  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatIcsUtcTime(new Date())}`,
    `DTSTART;TZID=Asia/Hong_Kong:${formatIcsLocalTime(startDate)}`,
    `DTEND;TZID=Asia/Hong_Kong:${formatIcsLocalTime(endDate)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `LOCATION:${location}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `STATUS:${status}`,
    ...(transparent ? ["TRANSP:TRANSPARENT"] : []),
    "END:VEVENT",
  ];

  return lines.map(foldLine).join("\r\n");
}

/**
 * Which of the dashboard's fixtures belong in a player's calendar.
 *
 * The dashboard shows a play-up opportunity so the player can say whether
 * they could help; the calendar is for games they are actually part of. So
 * a higher team's fixture appears only once the coach has picked them for
 * it. Own-team fixtures always appear, including the ones they have
 * declined - those are marked, above, rather than dropped. Support fixtures
 * follow the dashboard as before.
 */
export function calendarWorthy<T extends { fixtureCategory?: string; selectionStatus?: string }>(fixtures: T[]): T[] {
  return fixtures.filter((f) => f.fixtureCategory !== "play-up" || f.selectionStatus === "Selected");
}

// --- Route Handlers ---

export async function handleGetCalendarLink(env: Env, email: string, apiOrigin: string) {
  const player = await getPlayerByEmail(env, email);
  if (!player) throw new HttpError("Player not found", 404);

  const payload = `player:${player.id}`;
  const sig = await hmacSign(env.CALENDAR_SECRET, payload);
  return { url: `${apiOrigin}/api/calendar/feed.ics?id=${player.id}&sig=${sig}` };
}

export async function handlePlayerCalendarFeed(env: Env, id: string | null, sig: string | null) {
  if (!id || !sig) return new Response("Unauthorized", { status: 401 });

  const expectedSig = await hmacSign(env.CALENDAR_SECRET, `player:${id}`);
  if (!timingSafeEqualHex(sig, expectedSig)) return new Response("Unauthorized", { status: 401 });

  // Cache key includes the player's display team: changing Selected Team
  // EOS/SOS in Airtable rotates the key (once the 10-minute reference cache
  // refreshes), so a subscribed calendar always reflects the current
  // dashboard fixture view. Read from the already-cached reference data, not
  // a fresh Airtable lookup, so a feed poll that hits cache makes zero
  // Airtable calls.
  const ref = await getReferenceData(env);
  const player = ref.players.find((p) => p.id === id);
  const displayTeam = player ? selectedDisplayTeam(player) || player.registeredTeam || "" : "";
  const cacheKey = `calendar:player:${id}:${displayTeam}`;
  const { data: icsString } = await getCached(cacheKey, async () => {
    const { fixtures } = await getPlayerFixtures(env, id);
    const events = (await withTeamRecords(env, calendarWorthy(fixtures))).map((f: any) => formatVEvent(f, true));
    return generateIcsPayload(events);
  }, 5 * 60 * 1000);

  return new Response(icsString, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=900",
    },
  });
}

export async function handleGetTeamCalendarLink(env: Env, user: AuthorizedUser, team: string, apiOrigin: string) {
  if (!user.coachTeams.includes(team)) throw new HttpError("Forbidden", 403);

  const payload = `team:${team}`;
  const sig = await hmacSign(env.CALENDAR_SECRET, payload);
  return { url: `${apiOrigin}/api/calendar/team-feed.ics?team=${encodeURIComponent(team)}&sig=${sig}` };
}

export async function handleTeamCalendarFeed(env: Env, team: string | null, sig: string | null) {
  if (!team || !sig) return new Response("Unauthorized", { status: 401 });

  const expectedSig = await hmacSign(env.CALENDAR_SECRET, `team:${team}`);
  if (!timingSafeEqualHex(sig, expectedSig)) return new Response("Unauthorized", { status: 401 });

  const cacheKey = `calendar:team:${team}`;
  const { data: icsString } = await getCached(cacheKey, async () => {
    const { fixtures } = await getUpcomingFixtures(env, { team });
    const events = (await withTeamRecords(env, fixtures)).map((f: any) =>
      formatVEvent(f, false, f.selectedPlayers ?? []),
    );
    return generateIcsPayload(events);
  }, 5 * 60 * 1000);

  return new Response(icsString, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=900",
    },
  });
}