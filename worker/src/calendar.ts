import type { Env } from "./env";
import { getPlayerByEmail, getReferenceData } from "./reference";
import { getPlayerFixtures, getUpcomingFixtures } from "./fixtures";
import { getCached } from "./cache";
import { HttpError } from "./http";
import type { AuthorizedUser } from "./auth";
import { selectedDisplayTeam } from "../../shared/displayTeam";
import { availableLabel } from "../../shared/availableLabel";
import { getPlayedMatches } from "./fixtures";
import { currentSeason } from "./seasonContext";
import { buildTeamRecord, type Outcome, type TeamRecord } from "./teamRecord";

const MATCH_DURATION_MINUTES = 90;

/** A squad member as the calendar lists them. */
type SquadEntry = { name: string; availabilityStatus?: string };

/**
 * Attach each fixture's season record and head-to-head. Played matches are
 * fetched once for the whole feed rather than per event - every fixture reads
 * the same list.
 */
async function withTeamRecords(env: Env, fixtures: any[]): Promise<any[]> {
  const played = await getPlayedMatches(env);
  const season = currentSeason();
  return fixtures.map((f) => ({
    ...f,
    record: buildTeamRecord(played, f.hkfcTeam || "", f.opponent, season),
  }));
}

/**
 * The squad, one per line, with the only status worth a reader's attention
 * marked. A selected player who answered "Maybe" is still in the side but is
 * not a certainty, and that is exactly what a teammate reading the invitation
 * wants to know.
 */
function formatSquadLines(squad: SquadEntry[]): string[] {
  return squad.map((p) => (p.availabilityStatus === "Maybe" ? `${p.name} (Maybe)` : p.name));
}

/** "Saturday 4 October, 15:00" in Hong Kong time. */
function formatWhen(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("weekday")} ${get("day")} ${get("month")}, ${get("hour")}:${get("minute")}`;
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

function foldLine(line: string): string {
  // RFC 5545: fold lines longer than 75 octets with CRLF + space.
  if (line.length <= 75) return line;
  let folded = line.substring(0, 75);
  let remaining = line.substring(75);
  while (remaining.length > 73) {
    folded += `\r\n ${remaining.substring(0, 73)}`;
    remaining = remaining.substring(73);
  }
  folded += `\r\n ${remaining}`;
  return folded;
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
  // RFC 5545 only permits TENTATIVE | CONFIRMED | CANCELLED for VEVENT STATUS.
  let status = "CONFIRMED";

  if (isPlayerFeed) {
    const isSelected = fixture.selectionStatus === "Selected";
    const isUnavailable = fixture.availabilityStatus === "Unavailable";
    const isMaybe = fixture.availabilityStatus === "Maybe";
    if (isSelected) {
      summaryPrefix = "✅ ";
      status = "CONFIRMED";
    } else if (isUnavailable) {
      summaryPrefix = "❌ ";
      status = "CANCELLED";
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
  // renders everywhere and survives the text-only views.
  const kitIcon = fixture.kit === "Blue" ? " 🔵" : fixture.kit === "White" ? " ⚪" : "";
  const summary = `${summaryPrefix}${teamName} vs ${fixture.opponent}${kitIcon}`;

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
    "END:VEVENT",
  ];

  return lines.map(foldLine).join("\r\n");
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
    const events = (await withTeamRecords(env, fixtures)).map((f: any) => formatVEvent(f, true));
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