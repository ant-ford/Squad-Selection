/**
 * The slice of Cloudflare's KVNamespace this cache uses. Declared here rather
 * than depending on the generated Workers types, so the tests can hand the
 * cache a plain object.
 */
export interface CacheKv {
  get(key: string, options: { type: "json" }): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<
    { keys: { name: string }[] } & ({ list_complete: true } | { list_complete: false; cursor: string })
  >;
}

// Compile-time proof that the real binding satisfies the slice above. If
// Cloudflare's KVNamespace ever stops fitting, this line fails to typecheck
// rather than the fakes passing and production discovering the mismatch.
type RealBindingFits = KVNamespace extends CacheKv ? true : never;
export const realBindingFits: RealBindingFits = true;

/** Cloudflare Worker environment bindings (wrangler.toml vars + secrets). */
export interface Env {
  AIRTABLE_TOKEN: string;
  AIRTABLE_BASE_ID: string;
  CALENDAR_SECRET: string;
  ALLOWED_ORIGIN: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  /**
   * Shared cache for raw Airtable reads, across isolates.
   *
   * Optional on purpose: with no binding every read falls back to the
   * in-isolate cache, which is exactly how this worked before. That keeps
   * the tests, local dev, and a deploy made before the namespace exists all
   * working rather than failing at the first cache read.
   */
  CACHE?: CacheKv;
  /**
   * Airtable webhook credentials (worker/src/airtableWebhook.ts). Both are
   * optional: without them the webhook route answers 404, and the raw-table
   * caches fall back to the short TTLs that Airtable-side edits relied on
   * before there was a webhook to announce them.
   */
  AIRTABLE_WEBHOOK_ID?: string;
  /** The webhook's macSecretBase64, as a Worker secret. */
  AIRTABLE_WEBHOOK_SECRET?: string;
}
