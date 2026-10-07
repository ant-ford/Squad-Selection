import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import { errorText, secondary } from '@/components/profile/steps';
import { LONG_DATE, safeFormat } from '@/lib/dateUtils';
import { saveCsv } from '@/lib/saveCsv';
import { confirmPayment, getCharges, markChargesSent } from '@/api/events';
import { READ_STATUS_LABEL, chargesCsv, priceText, type ManagedEvent, type ReadStatus } from '@shared/events';

const READ_CHIP: Record<ReadStatus, string> = {
  matched: 'bg-emerald-500/15 text-emerald-700',
  amount_differs: 'bg-amber-500/15 text-amber-700',
  duplicate: 'bg-destructive/10 text-destructive',
  unreadable: 'bg-muted text-muted-foreground',
};

/**
 * Who owes what for a paid event: one line per payer (their own place,
 * anyone they signed up, and guests). Membership account events download
 * the list for the treasurer and are marked sent; PayMe / FPS events show
 * each payer's screenshot, what Qwen read from it, and a Confirm button.
 */
export default function PaymentsSection({ event }: { event: ManagedEvent }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['eventCharges', event.id], queryFn: () => getCharges(event.id) });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['eventCharges', event.id] });
    void queryClient.invalidateQueries({ queryKey: ['eventResponses', event.id] });
  };
  const sent = useMutation({
    mutationFn: () => markChargesSent(event.id),
    onSuccess: () => {
      toast.success('Marked as sent to the treasurer');
      refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const confirm = useMutation({
    mutationFn: ({ personId, confirmed }: { personId: string; confirmed: boolean }) => confirmPayment(event.id, personId, confirmed),
    onSuccess: refresh,
    onError: (err) => toast.error(errorText(err)),
  });
  const list = q.data;
  if (!list) return null;
  const payme = event.paymentMode === 'payme_fps';
  const account = event.paymentMode === 'account';
  const owing = list.payers.filter((p) => p.total > 0);
  const confirmedTotal = owing.filter((p) => p.payment?.confirmedAt).reduce((t, p) => t + p.total, 0);
  const csvName = `${event.title.replace(/[^\w ]+/g, '').trim() || 'event'} charges.csv`;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Payments</h3>
        <button
          className="text-xs text-primary inline-flex items-center gap-1 disabled:opacity-50"
          disabled={!owing.length}
          onClick={() => saveCsv(csvName, chargesCsv(event.title, safeFormat(event.startsAt, LONG_DATE), list.payers))}
        >
          <Download className="h-3.5 w-3.5" /> Download list
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {priceText(list.total) ?? 'HK$0'} from {owing.length} payer{owing.length === 1 ? '' : 's'}
        {payme ? ` · ${priceText(confirmedTotal) ?? 'HK$0'} confirmed` : ''}. No-shows are still charged; let someone off from the answers list.
      </p>
      {account && (
        <div className="rounded-md bg-muted p-2 space-y-1">
          {list.sentAt ? (
            <p className="text-xs text-foreground">Sent to the treasurer on {safeFormat(list.sentAt, 'EEE d MMM, h:mm a')}.</p>
          ) : (
            <p className="text-xs text-foreground">Download the list, send it to the treasurer, then mark it sent.</p>
          )}
          {list.changedSince.length > 0 && (
            <p className="text-xs text-amber-700">Changed since it was sent: {list.changedSince.join(', ')}. Send the treasurer a correction.</p>
          )}
          <button className={`${secondary} h-8 text-xs`} disabled={sent.isPending} onClick={() => sent.mutate()}>
            {list.sentAt ? 'Mark as sent again' : 'Mark as sent to the treasurer'}
          </button>
        </div>
      )}
      <ul className="divide-y divide-border">
        {owing.map((p) => (
          <li key={p.payerId} className="py-2 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground flex-1 min-w-0 truncate">
                {p.name}
                {p.membershipNo && <span className="text-xs text-muted-foreground"> · {p.membershipNo}</span>}
              </span>
              <span className="text-sm font-medium text-foreground">{priceText(p.total)}</span>
            </div>
            {p.lines.length > 1 && (
              <p className="text-xs text-muted-foreground">{p.lines.map((l) => (l.what === 'Member' ? l.name : `${l.name} (${l.what.toLowerCase()})`)).join(', ')}</p>
            )}
            {payme &&
              (p.payment ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`font-medium px-2 py-0.5 rounded ${p.payment.confirmedAt ? READ_CHIP.matched : READ_CHIP[p.payment.status]}`}>
                    {p.payment.confirmedAt ? 'Confirmed' : READ_STATUS_LABEL[p.payment.status]}
                  </span>
                  <span className="text-muted-foreground">
                    {[p.payment.amountRead != null ? priceText(p.payment.amountRead) : null, p.payment.paidOn ? safeFormat(p.payment.paidOn, 'd MMM') : null, p.payment.reference, p.payment.payee ? `to ${p.payment.payee}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {p.payment.amountDue != null && p.payment.amountDue !== p.total && <span className="text-amber-700">Bill changed since: was {priceText(p.payment.amountDue)}</span>}
                  {p.payment.proofUrl && (
                    <a href={p.payment.proofUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                      Screenshot
                    </a>
                  )}
                  <button className="ml-auto text-primary" disabled={confirm.isPending} onClick={() => confirm.mutate({ personId: p.payerId, confirmed: !p.payment!.confirmedAt })}>
                    {p.payment.confirmedAt ? 'Undo' : 'Confirm paid'}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No payment screenshot yet</p>
              ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
