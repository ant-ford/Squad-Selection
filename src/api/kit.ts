import { apiGet, apiPost } from '@/lib/apiClient';
import type { KitBoard, KitMove, KitMoveResult, KitSizes, MyKit } from '@shared/kit';

/** Kit (worker/src/kit.ts). The board and its actions are the kit section's. */
export function getKitBoard(orderId?: string | null): Promise<KitBoard> {
  return apiGet<KitBoard>('/api/kit/board', orderId ? { order: orderId } : undefined);
}

export function getMyKit(): Promise<MyKit> {
  return apiGet<MyKit>('/api/kit/me');
}

/**
 * Moves sets to a person, or back to the store (`to: null`). `expected` is
 * where each set was when the screen showed it, so a set someone else has
 * just handed out comes back as a conflict instead of moving twice.
 */
export function moveKit(body: { setIds: string[]; to: string | null; expected?: Record<string, string | null> }): Promise<KitMoveResult> {
  return apiPost('/api/kit/move', body);
}

export function allocateSpare(setId: string, personId: string): Promise<{ ok: true }> {
  return apiPost('/api/kit/allocate', { setId, personId });
}

export function releaseSet(setId: string): Promise<{ ok: true }> {
  return apiPost('/api/kit/release', { setId });
}

export function giveNewNumber(personId: string, team?: string): Promise<{ shirtNo: number }> {
  return apiPost('/api/kit/new-number', { personId, team });
}

export function editSetSizes(setId: string, sizes: KitSizes): Promise<{ ok: true }> {
  return apiPost(`/api/kit/sets/${encodeURIComponent(setId)}/sizes`, { sizes });
}

export function getSetHistory(setId: string): Promise<KitMove[]> {
  return apiGet(`/api/kit/sets/${encodeURIComponent(setId)}/history`);
}

export function setOrderReceived(orderId: string, receivedOn: string | null): Promise<{ ok: true }> {
  return apiPost(`/api/kit/orders/${encodeURIComponent(orderId)}/received`, { receivedOn });
}

/** Downloads who needs kit, in the order file's layout. Returns how many. */
export async function downloadTopUp(orderId?: string | null): Promise<number> {
  const { filename, csv, count } = await apiGet<{ filename: string; csv: string; count: number }>(
    '/api/kit/top-up',
    orderId ? { order: orderId } : undefined,
  );
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return count;
}
