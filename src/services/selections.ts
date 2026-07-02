import airtable from "./airtable";

const TABLE = "SquadSelections";

export async function getSelectionsForMatch(
  matchId: string
) {
  return airtable(TABLE)
    .select({
      filterByFormula: `{match}='${matchId}'`,
    })
    .all();
}

export async function getSelectionsForMatches(
  matchIds: string[]
) {
  if (!matchIds.length) return [];

  const formula = `OR(${matchIds
    .map(id => `{match}='${id}'`)
    .join(",")})`;

  return airtable(TABLE)
    .select({
      filterByFormula: formula,
    })
    .all();
}

export async function selectPlayer(
  matchId: string,
  playerId: string,
  selectedBy: string
) {
  return airtable(TABLE).create({
    match: [matchId],
    player: [playerId],
    selectedBy,
  });
}

export async function removeSelection(
  selectionId: string
) {
  return airtable(TABLE).destroy(selectionId);
}