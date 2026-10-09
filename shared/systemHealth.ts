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
  build?: string | null;
  browser?: string | null;
  stack?: string | null;
}

export type SystemErrorDays = 1 | 7 | 30;

export interface SystemErrorGroup {
  key: string;
  kind: 'screen-load' | 'database' | 'server' | 'app' | 'scheduled';
  source: string;
  status: number | null;
  message: string | null;
  count: number;
  recentCount: number;
  firstSeen: string;
  lastSeen: string;
  routes: string[];
  routeCount: number;
  buildCount: number;
  builds: { build: string | null; count: number; lastSeen: string }[];
  /** At most five recent examples, with no person ids or full user agents. */
  samples: SystemError[];
}

export interface SystemErrorSummary {
  days: SystemErrorDays;
  totalGroups: number;
  totalOccurrences: number;
  /** At most 50 groups, most recently seen first; counts cover the full period. */
  groups: SystemErrorGroup[];
}

/** GET /api/system. */
export interface SystemView {
  ok: boolean;
  checks: HealthCheck[];
  jobs: JobRow[];
  /** The latest 50, newest first. */
  errors: SystemError[];
  /** Optional while an older API is still deployed. */
  errorSummary?: SystemErrorSummary;
  serverErrors24h: number;
  clientErrors24h: number;
}
