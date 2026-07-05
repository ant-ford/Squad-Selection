// Every network call the frontend makes for app data goes through here.
// The browser never talks to Airtable directly and never sees an Airtable
// token — it only ever calls this Worker.

const API_URL = import.meta.env.VITE_API_URL;

if (!API_URL) {
  // Fails loudly at startup rather than producing confusing "Failed to
  // fetch" errors scattered across the app.
  throw new Error(
    'Missing VITE_API_URL environment variable. Set it to your deployed ' +
      'Worker URL, e.g. https://hkfc-api.squad-selections.workers.dev'
  );
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function parseResponse(response: Response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = (data && (data as { error?: string }).error) || `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return data;
}

type QueryParams = Record<string, string | number | boolean | undefined>;

function toSearchParams(params?: QueryParams): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  const search = new URLSearchParams(entries.map(([k, v]) => [k, String(v)]));
  return `?${search.toString()}`;
}

export async function apiGet<T>(path: string, params?: QueryParams): Promise<T> {
  const response = await fetch(`${API_URL}${path}${toSearchParams(params)}`);
  return parseResponse(response) as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseResponse(response) as Promise<T>;
}
