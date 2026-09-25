import { apiGet, apiPost } from '@/lib/apiClient';
import type { DirectoryPerson } from '@shared/emailLists';

export interface ChairmanDirectory {
  people: DirectoryPerson[];
  generatedAt: string;
}

export type ExportKind = 'outlook' | 'gmail' | 'csv' | 'mailto';

export function getChairmanDirectory(): Promise<ChairmanDirectory> {
  return apiGet<ChairmanDirectory>('/api/chairman/directory');
}

/**
 * Tells the Worker a list left the app, for the Membership Events log.
 * Best effort: the copy or download has already happened, so a failed log
 * call must not look like a failed export.
 */
export function logExport(input: { kind: ExportKind; people: number; addresses: number; description: string }) {
  return apiPost('/api/chairman/export-log', input).catch(() => undefined);
}
