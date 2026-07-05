import { Player } from "../generated/domainTypes";
import { PEOPLE_FIELDS } from "../generated/fieldMaps";

export function mapPlayer(
  record: any
): Player {

  const f = record.fields;

  return {
    id: record.id,

    preferredName:
      f[PEOPLE_FIELDS.preferredName],

    givenNames:
      f[PEOPLE_FIELDS.givenNames],

    surname:
      f[PEOPLE_FIELDS.surname],

    shirtNoValue:
      f[PEOPLE_FIELDS.shirtNoValue],

    email:
      f[PEOPLE_FIELDS.email],

    active:
      f[PEOPLE_FIELDS.active],

    registeredTeam:
      f[PEOPLE_FIELDS.registeredTeam],

    playingPosition:
      f[PEOPLE_FIELDS.playingPosition],

    playingAbility:
      f[PEOPLE_FIELDS.playingAbility],

    isSuspended:
      f[PEOPLE_FIELDS.isSuspended],

    matchesToServe:
      f[PEOPLE_FIELDS.matchesToServe],

    isVisitingPlayer:
      f[PEOPLE_FIELDS.isVisitingPlayer],

    everRegisteredToPremier:
      f[
        PEOPLE_FIELDS
          .everRegisteredToPremier
      ],

    u21Eligible:
      f[
        PEOPLE_FIELDS
          .u21Eligible
      ],

    playerCoach:
      f[PEOPLE_FIELDS.playerCoach]
  };
}