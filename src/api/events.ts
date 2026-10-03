import { apiGet, apiPost } from '@/lib/apiClient';
import type { ChargeList, EventInput, EventPerson, EventResponses, ManageView, MyEvent, PaymentInfo, RespondInput } from '@shared/events';
import type { Selection } from '@shared/emailLists';

/** Special events (worker/src/events.ts). */

export function getMyEvents(): Promise<{ events: MyEvent[] }> {
  return apiGet('/api/events/mine');
}

export function respondToEvent(id: string, input: RespondInput & { asManager?: boolean }): Promise<{ ok: true }> {
  return apiPost(`/api/events/${id}/respond`, input);
}

export function searchEventPeople(id: string, q: string): Promise<{ people: EventPerson[] }> {
  return apiGet(`/api/events/${id}/people`, { q });
}

export function getManageView(): Promise<ManageView> {
  return apiGet('/api/events/manage');
}

export function saveEvent(input: EventInput): Promise<{ id: string }> {
  return apiPost('/api/events', input);
}

export function setEventStatus(id: string, status: 'draft' | 'published' | 'cancelled'): Promise<{ ok: true }> {
  return apiPost(`/api/events/${id}/status`, { status });
}

export function deleteEvent(id: string): Promise<{ ok: true }> {
  return apiPost(`/api/events/${id}/delete`, {});
}

export function uploadPoster(id: string, dataUrl: string): Promise<{ url: string }> {
  return apiPost(`/api/events/${id}/poster`, { dataUrl });
}

export function getEventResponses(id: string): Promise<EventResponses> {
  return apiGet(`/api/events/${id}/responses`);
}

export function countAudience(audience: Selection, team: string | null): Promise<{ count: number }> {
  return apiPost('/api/events/audience', { audience, team });
}

export function findPeople(q: string): Promise<{ people: { personId: string; name: string; team: string | null }[] }> {
  return apiGet('/api/events/find-people', { q });
}

export function setSocialSecretaries(team: string, personIds: string[]): Promise<{ ok: true }> {
  return apiPost('/api/events/social-secretaries', { team, personIds });
}

export function getCharges(id: string): Promise<ChargeList> {
  return apiGet(`/api/events/${id}/charges`);
}

export function markChargesSent(id: string): Promise<{ ok: true }> {
  return apiPost(`/api/events/${id}/charges-sent`, {});
}

export function uploadPaymentProof(id: string, dataUrl: string): Promise<PaymentInfo> {
  return apiPost(`/api/events/${id}/payment-proof`, { dataUrl });
}

export function confirmPayment(id: string, personId: string, confirmed: boolean): Promise<{ ok: true }> {
  return apiPost(`/api/events/${id}/confirm-payment`, { personId, confirmed });
}

export function markNoShow(id: string, personId: string, noShow: boolean): Promise<{ ok: true }> {
  return apiPost(`/api/events/${id}/no-show`, { personId, noShow });
}

export function waiveCharge(id: string, personId: string, waived: boolean): Promise<{ ok: true }> {
  return apiPost(`/api/events/${id}/waive`, { personId, waived });
}
