/**
 * Who still owes this season's forms, for the Membership screen's Forms tab
 * (6 Oct 2026 review, item D3): the Membership Officer and the Section
 * Captains WhatsApp them from there. The same rules as each person's own
 * My Tasks lines (myTasks.ts):
 *  - waivers: an Active person with no Waivers & declarations since 1 July;
 *  - details: an Active member who hasn't checked My details since 1 July.
 *
 *   GET /api/membership/forms-due   {waivers: FormsDuePerson[], details: FormsDuePerson[]}
 *
 * One read.
 */
import type { Env } from "./env";
import { db } from "./data/supabase";
import { waiversDoneThisSeason } from "./myTasks";
import { checkedThisSeason } from "../../shared/profile";
import { hkDateKey } from "../../shared/hkDateKey";

export interface FormsDuePerson {
  id: string;
  name: string;
  firstName: string;
  mobile: string;
}

interface Row {
  api_id: string;
  preferred_name: string | null;
  given_names: string | null;
  surname: string | null;
  mobile_no: string | null;
  status: string | null;
  waivers_signed_at: string | null;
  profile_updated_at: string | null;
}

export async function getFormsDue(env: Env, now = new Date()): Promise<{ waivers: FormsDuePerson[]; details: FormsDuePerson[] }> {
  const rows = await db(env).select<Row>(
    "people",
    "select=id,api_id,preferred_name,given_names,surname,mobile_no,status,waivers_signed_at,profile_updated_at&active=is.true",
  );
  const today = hkDateKey(now.toISOString());
  const person = (r: Row): FormsDuePerson => ({
    id: r.api_id,
    name: [r.preferred_name || r.given_names, r.surname].filter(Boolean).join(" "),
    firstName: (r.preferred_name || r.given_names || "").split(" ")[0],
    mobile: r.mobile_no ?? "",
  });
  const byName = (a: FormsDuePerson, b: FormsDuePerson) => a.name.localeCompare(b.name);
  return {
    waivers: rows.filter((r) => !waiversDoneThisSeason(r.waivers_signed_at, today)).map(person).sort(byName),
    details: rows.filter((r) => r.status === "Member" && !checkedThisSeason(r.profile_updated_at, today)).map(person).sort(byName),
  };
}
