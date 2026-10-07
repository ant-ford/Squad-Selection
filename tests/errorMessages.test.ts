import { describe, expect, it } from 'vitest';
import { errorMessage } from '../src/lib/errorMessages';

/** The shape apiClient's ApiError has. */
const api = (status: number, code: string | undefined, message: string) => Object.assign(new Error(message), { status, code });

describe('errorMessage', () => {
  it('never shows the database reference', () => {
    const msg = errorMessage(api(502, 'DB_ERROR', 'Database error (people, 502 23505). Please try again.'), 'submit');
    expect(msg).toBe("Not submitted: the database didn't answer. Please try again.");
    expect(msg).not.toMatch(/23505|people|DB_ERROR/);
  });

  it('turns an unexpected server failure into plain words', () => {
    expect(errorMessage(api(500, 'INTERNAL_ERROR', 'Internal Server Error'), 'save')).toBe('Not saved: something went wrong on our side. Please try again.');
    expect(errorMessage(api(500, 'REVIEW_FAILED', 'Not submitted (insert:23505).'), 'submit')).toBe('Not submitted: something went wrong on our side. Please try again.');
    expect(errorMessage(api(503, undefined, 'Request failed (503)'), 'send')).toBe('Not sent: something went wrong on our side. Please try again.');
  });

  it("keeps the Worker's own words for a refusal", () => {
    expect(errorMessage(api(409, 'NOT_YET', 'Signing applications moves into Eddy at the switch-over.'), 'sign')).toBe(
      'Signing applications moves into Eddy at the switch-over.',
    );
    expect(errorMessage(api(400, 'INVALID_INPUT', 'Give your HKID number.'))).toBe('Give your HKID number.');
  });

  it('says what to do for the common statuses', () => {
    expect(errorMessage(api(401, 'UNAUTHORIZED', 'Session expired.'))).toBe('Not saved: you have been signed out. Sign in again, then try once more.');
    expect(errorMessage(api(413, undefined, 'Request failed (413)'))).toBe('Not saved: the file is too big. Try a smaller photo or PDF.');
    expect(errorMessage(api(429, undefined, 'Request failed (429)'))).toBe('Not saved: too many tries in a row. Wait a minute, then try again.');
  });

  it('does not repeat a bare "Request failed (n)" for an unexplained 4xx', () => {
    expect(errorMessage(api(404, undefined, 'Request failed (404)'))).toBe('Not saved. Please try again.');
  });

  it('says Eddy is read-only, not that something broke', () => {
    expect(errorMessage(api(503, 'READ_ONLY', "Saving is paused for a short while. Your change wasn't saved."))).toBe(
      'Not saved: saving is paused for a short while. Try again later.',
    );
  });

  it('treats no response as a dropped connection', () => {
    expect(errorMessage(new TypeError('Failed to fetch'), 'submit')).toBe('Not submitted: the connection dropped. Check your signal and try again.');
    expect(errorMessage(undefined)).toBe('Not saved: the connection dropped. Check your signal and try again.');
  });

  it('says the answers are kept when the form keeps a draft', () => {
    expect(errorMessage(api(502, 'DB_ERROR', 'x'), 'submit', { kept: true })).toBe(
      "Not submitted: the database didn't answer. Please try again. Your answers are kept here.",
    );
  });
});
