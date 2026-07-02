import { Team } from "../generated/domainTypes";
import { TEAMS_FIELDS } from "../generated/fieldMaps";

export function mapTeam(
  record: any
): Team {

  const f = record.fields;

  return {
    id: record.id,

    teamName:
      f[TEAMS_FIELDS.teamName],

    teamRank:
      f[TEAMS_FIELDS.teamRank],

    isPremier:
      f[TEAMS_FIELDS.isPremier],

    targetSquadSize:
      f[TEAMS_FIELDS.targetSquadSize],

    active:
      f[TEAMS_FIELDS.active],

    coach:
      f[TEAMS_FIELDS.coach],

    teamCaptain:
      f[TEAMS_FIELDS.teamCaptain],

    sectionCaptain:
      f[TEAMS_FIELDS.sectionCaptain]
  };
}