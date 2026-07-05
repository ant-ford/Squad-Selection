import { apiPost } from '@/lib/apiClient';

export async function removeSelection(selectionId: string) {
  return apiPost<{ success: boolean }>('/api/remove-selection', { selectionId });
}
