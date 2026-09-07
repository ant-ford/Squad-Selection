/** Cloudflare Worker environment bindings (wrangler.toml vars + secrets). */
export interface Env {
  AIRTABLE_TOKEN: string;
  AIRTABLE_BASE_ID: string;
  CALENDAR_SECRET: string;
  ALLOWED_ORIGIN: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}
