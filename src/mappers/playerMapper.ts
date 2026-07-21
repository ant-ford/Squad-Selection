import { Player } from "../generated/domainTypes";
import { PEOPLE_FIELDS } from "../generated/fieldMaps";

/**
 * Coerce an Airtable cell value to a non-negative integer or `undefined`.
 * Used for the numeric ranking fields, where Airtable may return `null`,
 * an empty string, or a numeric string depending on whether the value has
 * ever been set.
 */
function toOptionalInt(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.trunc(n);
}

export function mapPlayer(record: any): Player {
  const f = record.fields ?? {};
  return {
    id: record.id,
    preferredName: f[PEOPLE_FIELDS.preferredName],
    givenNames: f[PEOPLE_FIELDS.givenNames],
    surname: f[PEOPLE_FIELDS.surname],
    shirtNoValue: f[PEOPLE_FIELDS.shirtNoValue],
    email: f[PEOPLE_FIELDS.email],
    active: f[PEOPLE_FIELDS.active],
    registeredTeam: f[PEOPLE_FIELDS.registeredTeam],
    playingPosition: f[PEOPLE_FIELDS.playingPosition],
    playingAbility: f[PEOPLE_FIELDS.playingAbility] || undefined,
    isVisitingPlayer: f[PEOPLE_FIELDS.isVisitingPlayer],
    isSuspended: f[PEOPLE_FIELDS.isSuspended],
    matchesToServe: toOptionalInt(f[PEOPLE_FIELDS.matchesToServe]),
    everRegisteredToPremier: f[PEOPLE_FIELDS.everRegisteredToPremier],
    u21Eligible: f[PEOPLE_FIELDS.u21Eligible],
    playerCoach: Array.isArray(f[PEOPLE_FIELDS.playerCoach])
      ? f[PEOPLE_FIELDS.playerCoach]
      : f[PEOPLE_FIELDS.playerCoach]
        ? [f[PEOPLE_FIELDS.playerCoach]]
        : [],
    sectionRank: toOptionalInt(f[PEOPLE_FIELDS.sectionRank]),
    teamRank: toOptionalInt(f[PEOPLE_FIELDS.teamRank]),
    positionalRank: toOptionalInt(f[PEOPLE_FIELDS.positionalRank]),
    rankUpdatedAt: f[PEOPLE_FIELDS.rankUpdatedAt] || undefined,
  };
}