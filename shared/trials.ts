/**
 * Registering interest to join (worker/src/trials.ts): a member's link,
 * the old trial form's questions on the applicant page at stage 1, trial
 * sessions before the season, and the Section Captains' practice-trial
 * invitations once it has started.
 */

export const TRIAL_STAGE = "1. Trial Application";

export interface TrialSession {
  id: string;
  startsAt: string;
  place: string;
  notes: string | null;
}

/** GET /api/trials/me. */
export interface MyTrial {
  /** Sessions still to come; none once the season has started. */
  sessions: TrialSession[];
  chosen: string[];
  registeredAt: string | null;
  referredBy: string | null;
}

/** The trial part of GET /api/joiners/:id, for a stage-1 registrant. */
export interface JoinerTrial {
  registeredAt: string | null;
  referredBy: string | null;
  sessions: { startsAt: string; place: string }[];
  practiceInvitedAt: string | null;
}

/** POST /api/join/register: what the sign-up found. */
export interface JoinResult {
  status: "registering" | "applicant" | "member";
  stage: string | null;
}
