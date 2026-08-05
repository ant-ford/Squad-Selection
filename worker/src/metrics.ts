/**
 * Operational metrics for the eligibility engine.
 *
 * Pure in-isolate counters (same lifetime model as src/lib/cache.ts).
 * Recording is additive-only: it can never influence a rule result.
 * Used for operational insight only — never for eligibility decisions.
 */

interface MetricsState {
  evaluations: number;
  totalMs: number;
  statusCounts: Record<string, number>;
  blockedByRule: Record<string, number>;
  warningByRule: Record<string, number>;
  startedAt: string;
}

function freshState(): MetricsState {
  return {
    evaluations: 0,
    totalMs: 0,
    statusCounts: {},
    blockedByRule: {},
    warningByRule: {},
    startedAt: new Date().toISOString(),
  };
}

let state = freshState();

export function recordEligibilityEvaluation(args: {
  status: "eligible" | "warning" | "blocked";
  ruleId: string | null;
  warningRuleIds: string[];
  durationMs: number;
}): void {
  state.evaluations += 1;
  state.totalMs += args.durationMs;
  state.statusCounts[args.status] = (state.statusCounts[args.status] ?? 0) + 1;
  if (args.status === "blocked" && args.ruleId) {
    state.blockedByRule[args.ruleId] = (state.blockedByRule[args.ruleId] ?? 0) + 1;
  }
  for (const w of args.warningRuleIds) {
    state.warningByRule[w] = (state.warningByRule[w] ?? 0) + 1;
  }
}

export interface EligibilityMetricsSummary {
  evaluations: number;
  avgEvaluationMs: number;
  blockedPct: number;
  warningPct: number;
  statusCounts: Record<string, number>;
  blockedByRule: Record<string, number>;
  warningByRule: Record<string, number>;
  topBlockRules: { ruleId: string; count: number }[];
  windowStartedAt: string;
}

export function getEligibilityMetrics(): EligibilityMetricsSummary {
  const n = state.evaluations;
  return {
    evaluations: n,
    avgEvaluationMs: n > 0 ? Math.round((state.totalMs / n) * 100) / 100 : 0,
    blockedPct: n > 0 ? Math.round(((state.statusCounts["blocked"] ?? 0) / n) * 1000) / 10 : 0,
    warningPct: n > 0 ? Math.round(((state.statusCounts["warning"] ?? 0) / n) * 1000) / 10 : 0,
    statusCounts: { ...state.statusCounts },
    blockedByRule: { ...state.blockedByRule },
    warningByRule: { ...state.warningByRule },
    topBlockRules: Object.entries(state.blockedByRule)
      .map(([ruleId, count]) => ({ ruleId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    windowStartedAt: state.startedAt,
  };
}

export function resetEligibilityMetrics(): void {
  state = freshState();
}