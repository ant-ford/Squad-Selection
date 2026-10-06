/**
 * Raw API failures in plain words, for every form.
 *
 * The Worker answers with { error: CODE, message } (worker/src/http.ts
 * errorJson), and apiClient turns that into an ApiError with `status`,
 * `code` and `message`.
 *
 *  - A 4xx from an HttpError carries a message written for people ("They
 *    haven't submitted an application yet."), so it is shown as it is,
 *    apart from a few codes whose wording is generic.
 *  - A 5xx (DB_ERROR, UPSTREAM_ERROR, INTERNAL_ERROR...) carries detail for
 *    diagnosis (table, status, database code). That is already in the
 *    error log (/system), so the screen says what happened and what to do
 *    instead.
 *  - No response at all (offline, timed out) is a TypeError from fetch.
 *
 * Typed by shape rather than importing ApiError, so tests can use it
 * without the API client's start-up checks.
 */

export type ErrorAction = 'save' | 'submit' | 'send' | 'sign' | 'load';

interface ApiLike {
  status: number;
  code?: string;
  message: string;
}

const isApiLike = (e: unknown): e is ApiLike =>
  !!e && typeof e === 'object' && typeof (e as ApiLike).status === 'number' && typeof (e as ApiLike).message === 'string';

const NOT_DONE: Record<ErrorAction, string> = {
  save: 'Not saved',
  submit: 'Not submitted',
  send: 'Not sent',
  sign: 'Not signed',
  load: 'Could not load this',
};

/** Codes whose own message isn't the best thing to show. */
const BY_CODE: Record<string, string> = {
  UNAUTHORIZED: 'you have been signed out. Sign in again, then try once more.',
  DB_ERROR: "the database didn't answer. Please try again.",
  UPSTREAM_ERROR: "the database didn't answer. Please try again.",
  INTERNAL_ERROR: 'something went wrong on our side. Please try again.',
  SERVER_MISCONFIGURED: 'Eddy is not set up properly. Please tell the Men\'s Convenor.',
  AI_UNAVAILABLE: "the suggestion service isn't working right now. Please try again later.",
  AI_FAILED: "the suggestion service isn't working right now. Please try again later.",
  TOO_LARGE: 'the file is too big. Try a smaller photo or PDF.',
};

const BY_STATUS: Record<number, string> = {
  401: 'you have been signed out. Sign in again, then try once more.',
  408: 'it took too long. Please try again.',
  413: 'the file is too big. Try a smaller photo or PDF.',
  429: 'too many tries in a row. Wait a minute, then try again.',
};

/**
 * One sentence (or two) for a failed request.
 *
 *   errorMessage(err, 'submit', { kept: true })
 *   → "Not submitted: the database didn't answer. Please try again. Your answers are kept here."
 */
export function errorMessage(err: unknown, action: ErrorAction = 'save', { kept = false }: { kept?: boolean } = {}): string {
  const lead = NOT_DONE[action];
  const tail = kept ? ' Your answers are kept here.' : '';
  if (isApiLike(err)) {
    const byCode = err.code ? BY_CODE[err.code] : undefined;
    if (byCode) return `${lead}: ${byCode}${tail}`;
    const byStatus = BY_STATUS[err.status];
    if (byStatus) return `${lead}: ${byStatus}${tail}`;
    // A person-written refusal from the Worker (HttpError): already plain.
    if (err.status >= 400 && err.status < 500 && err.message && !/^Request failed \(\d+\)$/.test(err.message)) return `${err.message}${tail}`;
    if (err.status >= 500) return `${lead}: something went wrong on our side. Please try again.${tail}`;
    return `${lead}. Please try again.${tail}`;
  }
  return `${lead}: the connection dropped. Check your signal and try again.${tail}`;
}
