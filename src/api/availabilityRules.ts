import { apiGet, apiPost } from '@/lib/apiClient';

export type AvailabilityRuleType =
  | 'Play-ups'
  | 'Support games'
  | 'Midweek'
  | 'Date range'
  | 'All future';

export type RuleAvailability = 'Available' | 'Maybe' | 'Unavailable';

export interface AvailabilityRule {
  id: string;
  ruleType: AvailabilityRuleType | '';
  availability: RuleAvailability | '';
  active: boolean;
  startDate: string;
  endDate: string;
  notes: string;
  lastModified: string;
}

export interface NewAvailabilityRule {
  ruleType: AvailabilityRuleType;
  availability: RuleAvailability;
  startDate?: string;
  endDate?: string;
  notes?: string;
}

/** The caller's own standing rules. Identity comes from the session. */
export async function getMyAvailabilityRules(): Promise<AvailabilityRule[]> {
  const { rules } = await apiGet<{ rules: AvailabilityRule[] }>('/api/my-availability-rules');
  return rules ?? [];
}

export async function createMyAvailabilityRule(
  rule: NewAvailabilityRule,
): Promise<AvailabilityRule> {
  return apiPost<AvailabilityRule>('/api/my-availability-rules', rule);
}

export async function deleteMyAvailabilityRule(ruleId: string): Promise<{ success: boolean }> {
  return apiPost(`/api/my-availability-rules/${encodeURIComponent(ruleId)}`, {});
}
