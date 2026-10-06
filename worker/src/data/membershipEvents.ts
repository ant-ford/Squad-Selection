import type { Env } from "../env";
import { supabaseMembershipEvents } from "./supabase/crm";

/** One membership-section action, for the activity log (data/supabase/crm.ts). */
export interface NewMembershipEvent {
  eventType: "Approved" | "Exported" | "Notified";
  /** The applicant or member the action was about. */
  personId?: string;
  /** The officer's People id, when their session has one. */
  actorId?: string;
  actorEmail: string;
  previousStage?: string;
  newStage?: string;
  membershipNo?: string;
  joinDate?: string;
  commitmentEndDate?: string;
  sharedMembershipNo?: boolean;
  notes?: string;
  /** ISO timestamp, server-stamped. */
  timestamp: string;
}

export interface MembershipEventsRepo {
  /** Writes one row. Throws on failure; membership.ts decides what that means. */
  record(event: NewMembershipEvent): Promise<void>;
}

export function membershipEvents(env: Env): MembershipEventsRepo {
  return supabaseMembershipEvents(env);
}
