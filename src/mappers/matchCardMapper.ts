import {
  MatchCard
} from "../generated/domainTypes";

import {
  MATCHCARDS_FIELDS
} from "../generated/fieldMaps";

export function mapMatchCard(
  record: any
): MatchCard {

  const f = record.fields;

  return {
    id: record.id,

    player:
      f[MATCHCARDS_FIELDS.player],

    match:
      f[MATCHCARDS_FIELDS.match],

    team:
      f[MATCHCARDS_FIELDS.team],

    playerTeam:
      f[MATCHCARDS_FIELDS.playerTeam],

    playUp:
      f[MATCHCARDS_FIELDS.playUp],

    goalkeeper:
      f[MATCHCARDS_FIELDS.goalkeeper],

    jersey:
      f[MATCHCARDS_FIELDS.jersey],

    goals:
      f[MATCHCARDS_FIELDS.goals],

    cards:
      f[MATCHCARDS_FIELDS.cards],

    u21:
      f[MATCHCARDS_FIELDS.u21],

    vp:
      f[MATCHCARDS_FIELDS.vp],

    captain:
      f[MATCHCARDS_FIELDS.captain],

    season:
      f[MATCHCARDS_FIELDS.season],

    fixtureId:
      f[MATCHCARDS_FIELDS.fixtureId],

    rawPlayerName:
      f[MATCHCARDS_FIELDS.rawPlayerName]
  };
}
