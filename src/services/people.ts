import airtable from "./airtable";

const TABLE = "People";

export async function getActivePlayers() {
  return airtable(TABLE)
    .select({
      filterByFormula: "{active}=TRUE()",
    })
    .all();
}

export async function getPlayer(playerId: string) {
  return airtable(TABLE).find(playerId);
}

export async function getPlayerByEmail(email: string) {
  const records = await airtable(TABLE)
    .select({
      filterByFormula: `{email}='${email}'`,
      maxRecords: 1,
    })
    .all();

  return records[0] ?? null;
}

export async function getPlayersByTeam(teamName: string) {
  return airtable(TABLE)
    .select({
      filterByFormula: `{registeredTeam}='${teamName}'`,
    })
    .all();
}