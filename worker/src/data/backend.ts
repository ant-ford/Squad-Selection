/**
 * Which store each data module reads and writes: Airtable (today) or
 * Supabase Postgres (the move planned for October 2026).
 *
 * A data module is a table, or a small group of tables that are always
 * written together. The switch is per module, never per feature, so a table's
 * reads and writes always go to the same place: a screen that read People
 * from Postgres while another screen wrote People to Airtable would show
 * stale data with no error anywhere.
 *
 *   DATA_BACKEND            "airtable" | "supabase" - the default for every module
 *   DATA_BACKEND_OVERRIDES  "people=supabase,matches=airtable" - per-module exceptions
 *
 * Both unset means Airtable everywhere, which is how the Worker behaved before
 * this switch existed. Rolling back is setting the value back and deploying.
 */
import type { Env } from "../env";
import { shadowed } from "./shadow";

export const DATA_MODULES = [
  "people",
  "teams",
  "officers",
  "matches",
  "matchCards",
  "availabilityExceptions",
  "availabilityRules",
  "abilityGroups",
  "rankingEvents",
  "membershipEvents",
  "commitments",
] as const;

export type DataModule = (typeof DATA_MODULES)[number];
export type Backend = "airtable" | "supabase";

export type BackendEnv = Pick<Env, "DATA_BACKEND" | "DATA_BACKEND_OVERRIDES">;

function parseBackend(value: string | undefined): Backend | null {
  const v = value?.trim().toLowerCase();
  return v === "airtable" || v === "supabase" ? v : null;
}

/**
 * Parsed settings, keyed on the raw strings so a deploy that changes them is
 * picked up and an unchanged isolate parses once.
 */
let parsed: { key: string; fallback: Backend; overrides: Map<DataModule, Backend> } | null = null;

function settings(env: BackendEnv) {
  const key = `${env.DATA_BACKEND ?? ""}|${env.DATA_BACKEND_OVERRIDES ?? ""}`;
  if (parsed?.key === key) return parsed;

  // A value that is not understood falls back to Airtable, loudly, rather
  // than failing every request: Airtable is the store that is known to hold
  // the data until the switch-over.
  let fallback = parseBackend(env.DATA_BACKEND);
  if (!fallback) {
    if (env.DATA_BACKEND) console.error(`DATA_BACKEND "${env.DATA_BACKEND}" is not airtable or supabase; using airtable`);
    fallback = "airtable";
  }

  const overrides = new Map<DataModule, Backend>();
  for (const pair of (env.DATA_BACKEND_OVERRIDES ?? "").split(",")) {
    if (!pair.trim()) continue;
    const [name, value] = pair.split("=").map((s) => s.trim());
    const backend = parseBackend(value);
    if (!(DATA_MODULES as readonly string[]).includes(name) || !backend) {
      console.error(`DATA_BACKEND_OVERRIDES entry "${pair.trim()}" is not <module>=airtable|supabase; ignored`);
      continue;
    }
    overrides.set(name as DataModule, backend);
  }

  parsed = { key, fallback, overrides };
  return parsed;
}

export function backendFor(env: BackendEnv, module: DataModule): Backend {
  const s = settings(env);
  return s.overrides.get(module) ?? s.fallback;
}

/**
 * The repository for `module` on its configured backend. A module switched
 * to Supabase before it has an implementation is a configuration mistake, so
 * it fails the request that needed it, naming the module, instead of quietly
 * reading Airtable.
 */
export function pick<T extends object>(
  env: Env,
  module: DataModule,
  airtable: (env: Env) => T,
  supabase?: (env: Env) => T,
): T {
  if (backendFor(env, module) === "supabase") {
    if (!supabase) throw new Error(`Data module "${module}" is set to supabase but has no Supabase implementation yet`);
    return supabase(env);
  }
  // Preview only: serve Airtable, and compare the same read on Supabase in the background.
  if (supabase && env.DATA_SHADOW_READ === "on") return shadowed(module, airtable(env), () => supabase(env));
  return airtable(env);
}
