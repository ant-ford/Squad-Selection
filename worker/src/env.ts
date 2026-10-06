/**
 * The slice of Cloudflare's KVNamespace this cache uses. Declared here rather
 * than depending on the generated Workers types, so the tests can hand the
 * cache a plain object.
 */
export interface CacheKv {
  get(key: string, options: { type: "json" }): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  // No list(): the cache never lists keys (see SHARED_PREFIXES in cache.ts).
  // Leaving it out of this slice means a new list() call does not compile.
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
  /**
   * Which store the data modules use: "airtable" (the default when unset)
   * or "supabase". See worker/src/data/backend.ts.
   */
  DATA_BACKEND?: string;
  /** Per-module exceptions to DATA_BACKEND, e.g. "people=supabase,matches=airtable". */
  DATA_BACKEND_OVERRIDES?: string;
  /**
   * The Supabase project holding Eddy's DATA (eddy-production, or
   * eddy-preview for the preview Worker). Separate from SUPABASE_URL, which
   * is sign-in: the preview Worker signs people in against eddy-production
   * but reads test data from eddy-preview.
   */
  DATA_SUPABASE_URL?: string;
  /** That project's secret key (sb_secret_...), as a Worker secret. Sent only in the apikey header. */
  DATA_SUPABASE_SECRET_KEY?: string;
  /** This Worker's public origin, for links it hands out (signed file links). */
  API_ORIGIN?: string;
  /** The private R2 bucket holding members' files (eddy-files / eddy-files-preview). */
  FILES?: R2Bucket;
  /**
   * "remove": the daily retention job removes the personal details of people
   * inactive for 13 months (src/retention.ts). Anything else: it only counts them.
   */
  RETENTION_MODE?: string;
  /** "on" once the render-pdf Edge Function is deployed to the data project (src/pdf/render.ts). */
  PDFS?: string;
  /** The Club's membership office, "Name <address>": gets each signed application as a PDF (src/pdf/application.ts). */
  CLUB_MEMBERSHIP_EMAIL?: string;
  /** Who the application email greets there, e.g. "Caren". */
  CLUB_MEMBERSHIP_CONTACT?: string;
  /** The Club's front desk, "Name <address>": gets an existing member's levy form (src/pdf/application.ts). */
  FRONT_DESK_EMAIL?: string;
  /** Resend API key, as a Worker secret (src/mailer.ts). */
  RESEND_API_KEY?: string;
  /** Sender for Eddy's own email, e.g. "Eddy <notifications@eddy.global>". */
  MAIL_FROM?: string;
  /** Preview only: every email goes here instead, subject prefixed [PREVIEW]. */
  MAIL_REDIRECT_TO?: string;
  /** Comma-separated copies of the commitment review request (e.g. the membership inbox). */
  /** Who the review request comes from, e.g. "Anthony Ford <menscaptain@hkfchockey.com>" (blind-copied). */
  REVIEW_EMAIL_FROM?: string;
  /** The Assistant Director of Hockey, "Name <email>": told about practice trials (trials.ts). */
  ASSISTANT_DIRECTOR?: string;
  /** The web app's origin, for links in emails. */
  APP_ORIGIN?: string;
  /** OpenRouter API key, as a Worker secret, for the review drafts (src/reviewDrafts.ts). Unset: no drafts. */
  OPENROUTER_API_KEY?: string;
  /** OpenRouter model for the review drafts, e.g. "qwen/qwen3.8-27b". */
  AI_DRAFT_MODEL?: string;
}
