// Low-level Airtable REST client for the Worker.
import type { Env } from "./env";

const AIRTABLE_API = "https://api.airtable.com/v0";

export class AirtableError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AirtableError";
    this.status = status;
  }
}

function tableUrl(env: Env, table: string) {
  return `${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`;
}

const MAX_RATE_LIMIT_RETRIES = 2;

async function airtableFetch<T>(env: Env, url: string, init?: RequestInit): Promise<T | null> {
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });

    if (response.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) break;

    const retryAfterSeconds = Number(response.headers.get("Retry-After"));
    const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 1000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new AirtableError(
      `Airtable ${init?.method ?? "GET"} ${url} failed (${response.status}): ${body}`,
      response.status
    );
  }

  if (response.status === 204) return null;
  return response.json() as Promise<T>;
}

/** Single page of records (max 100, or whatever `params.pageSize` says). */
export async function airtableList(env: Env, table: string, params?: Record<string, string>): Promise<{ records: any[]; offset?: string }> {
  const search = new URLSearchParams(params);
  const result = await airtableFetch<{ records: any[]; offset?: string }>(env, `${tableUrl(env, table)}?${search.toString()}`);
  if (!result) { throw new Error("Unexpected null Airtable response"); }
  return result;
}

/** Fetches every record matching an optional formula, following pagination. */
export async function airtableFindAll(
  env: Env,
  table: string,
  filterByFormula?: string,
  extraParams?: Record<string, string>
): Promise<any[]> {
  const records: any[] = [];
  let offset: string | undefined;
  do {
    const params: Record<string, string> = { pageSize: "100" };
    if (filterByFormula) params.filterByFormula = filterByFormula;
    if (extraParams) Object.assign(params, extraParams);
    if (offset) params.offset = offset;
    const page = await airtableList(env, table, params);
    records.push(...(page.records ?? []));
    offset = page.offset;
  } while (offset);
  return records;
}

export async function airtableFindById(
  env: Env,
  table: string,
  id: string
): Promise<any | null> {
  try {
    return await airtableFetch(env, `${tableUrl(env, table)}/${id}`);
  } catch (err) {
    if (err instanceof AirtableError && err.status === 404) return null;
    throw err;
  }
}

export async function airtableCreate(
  env: Env,
  table: string,
  fields: Record<string, unknown>
): Promise<any> {
  return airtableFetch(env, tableUrl(env, table), {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
}

export async function airtableUpdate(
  env: Env,
  table: string,
  id: string,
  fields: Record<string, unknown>
): Promise<any> {
  return airtableFetch(env, `${tableUrl(env, table)}/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
}

export async function airtableDelete(
  env: Env,
  table: string,
  id: string
): Promise<void> {
  await airtableFetch(env, `${tableUrl(env, table)}/${id}`, {
    method: "DELETE",
  });
}

/** Batch create up to 10 records in a single request. */
export async function airtableBatchCreate(
  env: Env,
  table: string,
  records: Record<string, unknown>[]
): Promise<any> {
  return airtableFetch(env, tableUrl(env, table), {
    method: "POST",
    body: JSON.stringify({ records: records.map(fields => ({ fields })) }),
  });
}

/** Batch update up to 10 records in a single request. */
export async function airtableBatchUpdate(
  env: Env,
  table: string,
  records: { id: string; fields: Record<string, unknown> }[]
): Promise<any> {
  return airtableFetch(env, tableUrl(env, table), {
    method: "PATCH",
    body: JSON.stringify({ records }),
  });
}

/** Batch delete up to 10 records in a single request. */
export async function airtableBatchDelete(
  env: Env,
  table: string,
  ids: string[]
): Promise<any> {
  const body = JSON.stringify({ records: ids });
  return airtableFetch(env, tableUrl(env, table), {
    method: "DELETE",
    body,
  });
}

/** Guards against breaking a filterByFormula string via embedded quotes. */
export function escapeFormulaValue(value: string): string {
  return value.replace(/"/g, '\\"');
}

// Re-export from the shared neutral module
export { linkId } from "../../shared/airtableValueUtils";