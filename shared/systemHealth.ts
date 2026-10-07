/**
 * The System screen (GET /api/system, worker/src/systemHealth.ts): shapes
 * shared by the Worker and the app.
 */

/** A scheduled job's latest heartbeat (public.system_health_snapshot()). */
export interface JobRow {
  job: string;
  ran_at: string;
  ok: boolean;
  detail: unknown;
  last_ok_at: string | null;
}

/** One line of the health check. */
export interface HealthCheck {
  key: string;
  label: string;
  ok: boolean;
  note?: string;
}

/** One error_log row: a Worker 5xx (`worker`) or an app crash (`client`). */
export interface SystemError {
  at: string;
  source: string;
  route: string | null;
  status: number | null;
  message: string | null;
  request_id: string | null;
}

/** GET /api/system. */
export interface SystemView {
  ok: boolean;
  checks: HealthCheck[];
  jobs: JobRow[];
  /** The latest 50, newest first. */
  errors: SystemError[];
  serverErrors24h: number;
  clientErrors24h: number;
}
