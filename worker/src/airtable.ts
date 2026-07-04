export interface Env {
  AIRTABLE_TOKEN: string;
  AIRTABLE_BASE_ID: string;
}

export async function airtableRequest(
  env: Env,
  table: string,
  params?: URLSearchParams
) {
  const url =
    `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`
    + (params ? `?${params}` : "");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.AIRTABLE_TOKEN}`
    }
  });

  if (!response.ok) {
    throw new Error(
      `Airtable error ${response.status}`
    );
  }

  return response.json();
}