import { apiGet } from '@/lib/apiClient';

/** Mirrors worker/src/myTasks.ts MyTask. */
export interface MyTask {
  key: 'statement' | 'waivers';
  /** The member's own form, when the base has a link for them. */
  url?: string;
}

export function getMyTasks(): Promise<{ tasks: MyTask[] }> {
  return apiGet<{ tasks: MyTask[] }>('/api/my-tasks');
}
