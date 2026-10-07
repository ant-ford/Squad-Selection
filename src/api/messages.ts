import { apiGet, apiPost } from '@/lib/apiClient';

/** Message templates and the message log (worker/src/messages.ts). */
export interface MessageTemplate {
  id: string;
  name: string;
  body: string;
}

export function getMessageTemplates(): Promise<{ templates: MessageTemplate[] }> {
  return apiGet('/api/messages/templates');
}

export function logMessage(body: { personId: string; message: string; templateId?: string }): Promise<{ ok: true }> {
  return apiPost('/api/messages/log', body);
}
