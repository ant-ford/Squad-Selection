import { apiGet, apiPost } from '@/lib/apiClient';
import type { UmpiringBoard, UmpiringReport } from '@shared/umpiring';

/** Umpiring duties (worker/src/umpiring.ts). */
export function getUmpiringBoard(week: string | null): Promise<UmpiringBoard> {
  return apiGet<UmpiringBoard>('/api/umpiring', week ? { week } : undefined);
}

export function getUmpiringReport(season: string | null): Promise<UmpiringReport> {
  return apiGet<UmpiringReport>('/api/umpiring/report', season ? { season } : undefined);
}

/** An umpire puts their own name down: unpaid is confirmed at once, paid waits for the coordinator. */
export function takeDuty(dutyId: string, paid: boolean): Promise<{ ok: true; status: 'offered' | 'confirmed' }> {
  return apiPost(`/api/umpiring/duties/${dutyId}/take`, { paid });
}

/** The coordinator puts a club umpire or an outside umpire down. */
export function assignDuty(dutyId: string, body: { personId?: string; externalName?: string; paid?: boolean }): Promise<{ ok: true }> {
  return apiPost(`/api/umpiring/duties/${dutyId}/assign`, body);
}

export function withdrawAssignment(id: string): Promise<{ ok: true }> {
  return apiPost(`/api/umpiring/assignments/${id}/withdraw`, {});
}

export function confirmAssignment(id: string): Promise<{ ok: true }> {
  return apiPost(`/api/umpiring/assignments/${id}/confirm`, {});
}

export function setNoShow(id: string, noShow: boolean): Promise<{ ok: true }> {
  return apiPost(`/api/umpiring/assignments/${id}/no-show`, { noShow });
}
