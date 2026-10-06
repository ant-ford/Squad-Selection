import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import FileUpload from '@/components/profile/FileUpload';
import { safeFormat } from '@/lib/dateUtils';
import { uploadPaymentProof } from '@/api/events';
import { READ_STATUS_LABEL, priceText, type MyEvent } from '@shared/events';

const isLink = (v: string) => /^https?:\/\//i.test(v.trim());

/**
 * What they owe for a paid event (their own place, anyone they signed up,
 * and the guests), how to pay it, and for PayMe / FPS their screenshot and
 * where it stands.
 */
export default function BillBox({ event }: { event: MyEvent }) {
  const queryClient = useQueryClient();
  const bill = event.bill!;
  const total = priceText(bill.total) ?? 'HK$0';
  const payment = bill.payment;
  const details = event.paymentDetails ?? '';

  return (
    <section className="rounded-xl border border-border p-3 space-y-2">
      <h3 className="text-sm font-semibold text-foreground">Your bill</h3>
      {bill.lines.length > 0 ? (
        <ul className="text-sm text-foreground">
          {bill.lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span className="truncate">
                {l.name}
                {l.what !== 'Member' && <span className="text-muted-foreground"> ({l.what.toLowerCase()})</span>}
              </span>
              <span>{priceText(l.amount) ?? '—'}</span>
            </li>
          ))}
          <li className="flex justify-between gap-2 font-semibold border-t border-border mt-1 pt-1">
            <span>Total</span>
            <span>{total}</span>
          </li>
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing to pay just now.</p>
      )}
      <p className="text-xs text-muted-foreground">No-shows are still charged.</p>

      {event.paymentMode === 'on_the_night' && bill.total > 0 && <p className="text-sm text-foreground">Bring {total} on the night.</p>}
      {event.paymentMode === 'account' && bill.total > 0 && <p className="text-sm text-foreground">{total} will be charged to your membership account.</p>}

      {event.paymentMode === 'payme_fps' && (bill.total > 0 || payment) && (
        <div className="space-y-2">
          {bill.total > 0 && (
            <div className="text-sm text-foreground">
              <p>Pay {total} by PayMe or FPS to:</p>
              <div className="flex items-center gap-2 mt-1">
                {isLink(details) ? (
                  <a href={details.trim()} target="_blank" rel="noreferrer" className="text-primary underline break-all">
                    {details}
                  </a>
                ) : (
                  <span className="font-medium break-all">{details}</span>
                )}
                <button className="p-1.5 rounded-md hover:bg-muted text-muted-foreground" aria-label="Copy payment details" onClick={() => void navigator.clipboard.writeText(details).then(() => toast.success('Copied'))}>
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
          {payment && (
            <div className="text-xs rounded-md bg-muted p-2 space-y-0.5">
              <p className="font-medium text-foreground">
                {payment.confirmedAt ? `Payment confirmed by ${payment.confirmedBy ?? 'the social secretary'}` : `Screenshot received · ${READ_STATUS_LABEL[payment.status]}`}
              </p>
              {payment.amountRead != null && (
                <p className="text-muted-foreground">
                  Read: {priceText(payment.amountRead)}
                  {payment.paidOn ? ` on ${safeFormat(payment.paidOn, 'd MMM')}` : ''}
                  {payment.amountDue != null && payment.amountRead !== payment.amountDue ? ` (you owed ${priceText(payment.amountDue)})` : ''}
                </p>
              )}
              {!payment.confirmedAt && <p className="text-muted-foreground">The social secretary will check it against their PayMe or bank record.</p>}
              {payment.amountDue != null && bill.total !== payment.amountDue && <p className="text-amber-700">Your bill has changed since: now {total}. Upload a new screenshot once you've paid the difference.</p>}
            </div>
          )}
          {bill.total > 0 && (
            <FileUpload
              kind="document"
              label="Payment screenshot"
              hint="The PayMe or FPS confirmation, as a picture"
              hasFile={!!payment}
              onUploaded={() => void queryClient.invalidateQueries({ queryKey: ['myEvents'] })}
              upload={(dataUrl) => uploadPaymentProof(event.id, dataUrl)}
            />
          )}
        </div>
      )}
    </section>
  );
}
