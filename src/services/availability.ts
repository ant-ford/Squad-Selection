import airtable from "./airtable";

const TABLE = "AvailabilityExceptions";

export async function getAvailabilityForMatch(
  matchId: string
) {
  return airtable(TABLE)
    .select({
      filterByFormula: `{match}='${matchId}'`,
    })
    .all();
}

export async function getAvailabilityForPlayer(
  playerId: string
) {
  return airtable(TABLE)
    .select({
      filterByFormula: `{player}='${playerId}'`,
    })
    .all();
}

export async function setAvailability(
  playerId: string,
  matchId: string,
  status: string,
  reason?: string
) {
  const existing = await airtable(TABLE)
    .select({
      filterByFormula: `AND(
        {player}='${playerId}',
        {match}='${matchId}'
      )`,
      maxRecords: 1,
    })
    .all();

  if (existing.length > 0) {
    return airtable(TABLE).update(existing[0].id, {
      status,
      reason,
    });
  }

  return airtable(TABLE).create({
    player: [playerId],
    match: [matchId],
    status,
    reason,
  });
}