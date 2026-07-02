import airtable from "./airtable";

const TABLE = "Teams";

export async function getActiveTeams() {
  return airtable(TABLE)
    .select({
      filterByFormula: "{active}=TRUE()",
      sort: [
        {
          field: "teamRank",
          direction: "asc",
        },
      ],
    })
    .all();
}

export async function getTeam(teamId: string) {
  return airtable(TABLE).find(teamId);
}

export async function getTeamByName(teamName: string) {
  const records = await airtable(TABLE)
    .select({
      filterByFormula: `{teamName}='${teamName}'`,
      maxRecords: 1,
    })
    .all();

  return records[0] ?? null;
}