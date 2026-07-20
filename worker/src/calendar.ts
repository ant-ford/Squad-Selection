import { Env } from "./airtable";
import { getPlayerByEmail, getReferenceData } from "./reference";
import { getPlayerFixtures, getUpcomingFixtures } from "./fixtures";
import { getMyProfile } from "./profile";
import { getCached } from "../../src/lib/cache";
import { HttpError } from "./http";

const MATCH_DURATION_MINUTES = 90;

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

function formatVEvent(fixture: any, isPlayerFeed: boolean, squadNames: string[] = []): string {
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
    if (isSelected) {
      summaryPrefix = "✅ ";
      status = "CONFIRMED";
    } else if (isUnavailable) {
      summaryPrefix = "❌ ";
      status = "CANCELLED";
    } else {
      summaryPrefix = "🟦 ";
      status = "TENTATIVE";
    }
  }

  const summary = `${summaryPrefix}${teamName} vs ${fixture.opponent}`;

  let description = "";
  if (isPlayerFeed) {
    const isSelected = fixture.selectionStatus === "Selected";
    const availability = fixture.availabilityStatus === "Available" ? "Going" : (fixture.availabilityStatus || "Going");
    description = `Selection: ${isSelected ? "SELECTED" : "PENDING"}\nAvailability: ${availability}\nDivision: ${fixture.division}\nVenue: ${fixture.venue || "TBD"}`;
  } else {
    description = `Squad: ${fixture.selectedCount}/${fixture.targetSquadSize} Selected\nDivision: ${fixture.division}\nVenue: ${fixture.venue || "TBD"}`;
    if (squadNames.length > 0) {
      description += `\n\nSelected Players:\n${squadNames.join("\n")}`;
    }
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

// Resolve squad names from selectedIds + cached reference data (no per-fixture Airtable lookups).
function resolveSquadNames(selectedIds: string[] | undefined, playersById: Map<string, string>): string[] {
  if (!selectedIds || selectedIds.length === 0) return [];
  return selectedIds.map((id) => playersById.get(id)).filter((n): n is string => !!n);
}

// --- Route Handlers ---

export async function handleGetCalendarLink(env: Env, email: string) {
  const player = await getPlayerByEmail(env, email);
  if (!player) throw new HttpError("Player not found", 404);

  const payload = `player:${player.id}`;
  const sig = await hmacSign(env.CALENDAR_SECRET, payload);
  return { id: player.id, sig };
}

export async function handlePlayerCalendarFeed(env: Env, id: string | null, sig: string | null) {
  if (!id || !sig) return new Response("Unauthorized", { status: 401 });

  const expectedSig = await hmacSign(env.CALENDAR_SECRET, `player:${id}`);
  if (sig !== expectedSig) return new Response("Unauthorized", { status: 401 });

  const cacheKey = `calendar:player:${id}`;
  const { data: icsString } = await getCached(cacheKey, async () => {
    const { fixtures } = await getPlayerFixtures(env, id);
    const events = fixtures.map((f: any) => formatVEvent(f, true));
    return generateIcsPayload(events);
  }, 5 * 60 * 1000);

  return new Response(icsString, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=900",
    },
  });
}

export async function handleTeamCalendarExport(env: Env, email: string | null, team: string | null) {
  if (!email || !team) throw new HttpError("Missing parameters", 400);

  const profile = await getMyProfile(env, email);
  const isCoach = profile.coachTeams?.some((t) => t.teamName === team);
  if (!isCoach) throw new HttpError("Forbidden", 403);

  const { fixtures } = await getUpcomingFixtures(env, { email, team });
  const ref = await getReferenceData(env);
  const playersById = new Map(ref.players.map((p) => [p.id, p.preferredName || p.givenNames || "Player"]));

  const events = fixtures.map((f: any) => formatVEvent(f, false, resolveSquadNames(f.selectedIds, playersById)));
  const icsString = generateIcsPayload(events);

  return new Response(icsString, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="HKFC_${team}_Schedule.ics"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function handleGetTeamCalendarLink(env: Env, email: string, team: string) {
  const profile = await getMyProfile(env, email);
  const isCoach = profile.coachTeams?.some((t) => t.teamName === team);
  if (!isCoach) throw new HttpError("Forbidden", 403);

  const payload = `team:${team}`;
  const sig = await hmacSign(env.CALENDAR_SECRET, payload);
  return { team, sig };
}

export async function handleTeamCalendarFeed(env: Env, team: string | null, sig: string | null) {
  if (!team || !sig) return new Response("Unauthorized", { status: 401 });

  const expectedSig = await hmacSign(env.CALENDAR_SECRET, `team:${team}`);
  if (sig !== expectedSig) return new Response("Unauthorized", { status: 401 });

  const cacheKey = `calendar:team:${team}`;
  const { data: icsString } = await getCached(cacheKey, async () => {
    const { fixtures } = await getUpcomingFixtures(env, { team });
    const ref = await getReferenceData(env);
    const playersById = new Map(ref.players.map((p) => [p.id, p.preferredName || p.givenNames || "Player"]));
    const events = fixtures.map((f: any) => formatVEvent(f, false, resolveSquadNames(f.selectedIds, playersById)));
    return generateIcsPayload(events);
  }, 5 * 60 * 1000);

  return new Response(icsString, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=900",
    },
  });
}