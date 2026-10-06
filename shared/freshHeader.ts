/**
 * "Read my own write": the app sends this header (value "1") on every API
 * request for FRESH_WINDOW_MS after its last successful write
 * (src/lib/apiClient.ts). The Worker then reads auth_context, and with it the
 * current cache versions, afresh instead of reusing an isolate's answer from
 * the last few seconds (worker/src/auth.ts), so a person always sees what
 * they just saved, whichever isolate answers. A request without it (an older
 * app) behaves as before.
 */
export const FRESH_HEADER = "X-Eddy-Fresh";

/** As long as the Worker reuses an auth_context answer (auth.ts AUTH_CONTEXT_REUSE_MS). */
export const FRESH_WINDOW_MS = 10 * 1000;
