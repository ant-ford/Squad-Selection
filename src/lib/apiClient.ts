// Every network call the frontend makes for app data goes through here.
// The browser never talks to Airtable directly and never sees an Airtable
// token — it only ever calls this Worker.

import { supabase } from './supabase';
import { toast } from 'sonner';

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
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function parseResponse(response: Response) {
  const text = await response.text();
  let data: { error?: string; message?: string } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    // 401 UNAUTHORIZED: expired / invalid Supabase session.
    // Sign out and return to login.
    if (response.status === 401) {
      await supabase.auth.signOut().catch(() => {});
      if (window.location.pathname !== '/') window.location.href = '/';
      throw new ApiError(
        data?.message || 'Session expired. Please log in again.',
        401,
        data?.error,
      );
    }

    if (response.status === 403) {
      // 403 APPLICATION_ACCESS_DENIED: not an authorised HKFC application
      // user (unknown email / deactivated person with no coach access).
      // Sign out and return to login.
      if (data?.error === 'APPLICATION_ACCESS_DENIED') {
        toast.error(data.message || 'Your HKFC application access has been disabled.');
        await supabase.auth.signOut().catch(() => {});
        if (window.location.pathname !== '/') window.location.href = '/';
        throw new ApiError(data.message || 'Access denied.', 403, data.error);
      }

      // 403 COACH_ACCESS_REQUIRED: legit user without coach rights for this
      // operation. Show the error but stay logged in.
      if (data?.error === 'COACH_ACCESS_REQUIRED') {
        toast.error(data.message || 'You do not have coach permissions for this action.');
        throw new ApiError(data.message || 'Coach access required.', 403, data.error);
      }
    }

    const message = data?.message || data?.error || `Request failed (${response.status})`;
    throw new ApiError(message, response.status, data?.error);
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

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiGet<T>(path: string, params?: QueryParams): Promise<T> {
  const response = await fetch(`${API_URL}${path}${toSearchParams(params)}`, {
    headers: await getAuthHeaders(),
  });
  return parseResponse(response) as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
    body: JSON.stringify(body),
  });
  return parseResponse(response) as Promise<T>;
}
