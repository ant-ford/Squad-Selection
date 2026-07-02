import airtable from "./airtable";

const TABLE = "Matches";

export async function getMatch(matchId: string) {
  return airtable(TABLE).find(matchId);
}

export async function getUpcomingMatches() {
  return airtable(TABLE)
    .select({
      filterByFormula:
        "AND({matchDate}>=TODAY(),{status}!='Completed')",
      sort: [
        {
          field: "matchDate",
          direction: "asc",
        },
      ],
    })
    .all();
}

export async function getMatchesForDate(date: string) {
  return airtable(TABLE)
    .select({
      filterByFormula: `{matchDate}='${date}'`,
    })
    .all();
}

export async function getMatchesForTeam(teamName: string) {
  return airtable(TABLE)
    .select({
      filterByFormula: `{teamName}='${teamName}'`,
    })
    .all();
}