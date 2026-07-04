import { airtableRequest, Env } from "./airtable";

export async function getActivePlayers(
  env: Env
) {
  const params = new URLSearchParams({
    filterByFormula: "{Active}=TRUE()"
  });

  const data = await airtableRequest(
    env,
    "People",
    params
  );

  return data.records.map((record: any) => ({
    id: record.id,
    ...record.fields
  }));
}