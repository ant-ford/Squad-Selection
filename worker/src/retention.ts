/**
 * Data retention (migration 20261002160000_data_retention.sql): a person's
 * personal details are removed 13 months after they were last active.
 * Their name and playing record stay; everything else goes, including
 * their files in R2 (35 days later, once the daily backups holding them have
 * aged out).
 *
 * Runs on its own cron (RETENTION_CRON) so it has a free-plan run's 50
 * outside calls to itself:
 *  1. retention_stamp(): gives people who arrived inactive their stamp;
 *  2. with RETENTION_MODE = "remove", remove_personal_data() for up to
 *     MAX_PER_RUN people retention_due_v lists, oldest activity first;
 *     otherwise only the number due is logged (the list is retention_due_v);
 *  3. deletes the R2 objects queued in r2_deletions once their 35 days
 *     are up, then their rows.
 */
import type { Env } from "./env";
import { db, inList } from "./data/supabase";

/** The cron expression (worker/wrangler.toml [triggers]) that runs this job. */
export const RETENTION_CRON = "30 3 * * *";

/** People removed per run: one call each, well inside the 50. A backlog clears over days. */
export const MAX_PER_RUN = 20;

/**
 * Due R2 objects are deleted in batches of R2_BATCH (the keys go in the
 * queue-row delete's URL, so the batch stays small), up to R2_BATCHES a run:
 * three calls each, so a full run stays near 40 calls. A larger backlog
 * clears over the following days.
 */
export const R2_BATCH = 50;
export const R2_BATCHES = 5;

export interface RetentionResult {
  stamped: number;
  due: number;
  removed: number;
  failed: number;
  filesDeleted: number;
}

export async function runRetention(env: Env): Promise<RetentionResult> {
  const d = db(env);
  const stamped = await d.rpc<number>("retention_stamp", {});
  const due = await d.select<{ id: string }>("retention_due_v", `select=id&order=last_activity,id&limit=${MAX_PER_RUN}`);

  let removed = 0;
  let failed = 0;
  if (env.RETENTION_MODE === "remove") {
    for (const { id } of due) {
      try {
        if (await d.rpc<boolean>("remove_personal_data", { p_person: id })) removed++;
      } catch (err) {
        failed++;
        console.error(`Personal data for ${id} not removed:`, err instanceof Error ? err.message : err);
      }
    }
  }

  const filesDeleted = await deleteQueuedFiles(env);
  const result = { stamped, due: due.length, removed, failed, filesDeleted };
  console.log("retention " + JSON.stringify({ mode: env.RETENTION_MODE === "remove" ? "remove" : "report", ...result }));
  return result;
}

/**
 * Deletes the queued R2 objects whose delete_after has passed, then their
 * queue rows; a failure leaves both for the next run. Removal queues a key
 * 35 days ahead (migration 20261007000102): daily database backups are kept
 * 35 days, and a restored backup must not point at files that are gone.
 */
export async function deleteQueuedFiles(env: Env, now = new Date()): Promise<number> {
  if (!env.FILES) return 0;
  const d = db(env);
  const due = `delete_after=lte.${encodeURIComponent(now.toISOString())}`;
  let deleted = 0;
  for (let batch = 0; batch < R2_BATCHES; batch++) {
    const queued = await d.select<{ r2_key: string }>("r2_deletions", `select=r2_key&${due}&order=delete_after,r2_key&limit=${R2_BATCH}`, "r2_key");
    if (queued.length === 0) break;
    const keys = queued.map((q) => q.r2_key);
    await env.FILES.delete(keys);
    await d.remove("r2_deletions", `r2_key=${inList(keys)}`);
    deleted += keys.length;
    if (queued.length < R2_BATCH) break;
  }
  return deleted;
}
