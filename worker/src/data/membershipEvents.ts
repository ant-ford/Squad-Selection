import { airtableCreate } from "../airtable";
import type { Env } from "../env";
import { pick } from "./backend";
import { MEMBERSHIP_EVENTS_TABLE } from "../../../shared/schema/tableNames";
import { MEMBERSHIP_EVENTS_FIELDS as EV } from "../../../shared/schema/fieldMaps";

/** One membership-section audit row (membership.ts describes the table). */
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

function airtableMembershipEvents(env: Env): MembershipEventsRepo {
  return {
    async record(e) {
      // Built in this order so the request body is the one the section has
      // always sent: the action's own fields, then who and when.
      const row: Record<string, unknown> = {
        [EV.eventType]: e.eventType,
        [EV.person]: e.personId ? [e.personId] : undefined,
        [EV.previousStage]: e.previousStage,
        [EV.newStage]: e.newStage,
        [EV.membershipNo]: e.membershipNo,
        [EV.joinDate]: e.joinDate,
        [EV.commitmentEndDate]: e.commitmentEndDate,
        [EV.sharedMembershipNo]: e.sharedMembershipNo,
        [EV.notes]: e.notes,
        [EV.actorEmail]: e.actorEmail,
        [EV.timestamp]: e.timestamp,
        [EV.actor]: e.actorId ? [e.actorId] : undefined,
      };
      // Airtable rejects an explicit undefined less politely than a missing key.
      for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key];
      await airtableCreate(env, MEMBERSHIP_EVENTS_TABLE, row);
    },
  };
}

export function membershipEvents(env: Env): MembershipEventsRepo {
  return pick(env, "membershipEvents", airtableMembershipEvents);
}
