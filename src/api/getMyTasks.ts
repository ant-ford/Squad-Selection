import { apiGet } from '@/lib/apiClient';

/** Mirrors worker/src/myTasks.ts MyTask. */
export interface MyTask {
  /** Unique within the list. */
  id: string;
  key: 'joiner' | 'statement' | 'waivers' | 'invite' | 'application' | 'review';
  /** The applicant or member the line is about; absent for the person's own forms. */
  subject?: string;
  /** The part the signed-in person plays for them. */
  role?: 'Section Captain' | 'Sponsor' | 'Chairman' | 'Membership Officer';
  /** The form to open, when the base has a link. */
  url?: string;
}

export function getMyTasks(): Promise<{ tasks: MyTask[] }> {
  return apiGet<{ tasks: MyTask[] }>('/api/my-tasks');
}
