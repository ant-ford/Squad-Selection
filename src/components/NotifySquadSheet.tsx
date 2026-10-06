import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check, Copy, MessageCircle, X } from 'lucide-react';
import {
  buildAvailabilityRequest,
  buildDroppedMessage,
  buildSelectionMessage,
  buildSquadAnnouncement,
  toWhatsAppNumber,
  whatsAppLink,
  type FixtureBrief,
} from '@/lib/whatsapp';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { safeFormat } from '@/lib/dateUtils';

export interface NotifyTarget {
  id: string;
  preferredName: string;
  mobile?: string;
  shirtNo?: string;
  playingPosition?: string;
}

/**
 * Tell the selected squad they're playing, over WhatsApp click-to-chat.
 *
 * Two routes, because wa.me addresses exactly one recipient - there is no
 * link that messages a whole squad:
 *  - per player: opens WhatsApp with that player's message pre-filled, and
 *    the coach presses send;
 *  - the whole squad: copy an announcement to paste into the team group.
 *
 * With nobody selected yet it asks for availability instead: one message
 * for the team group carrying the fixture link, so the coach can share it
 * before picking anyone.
 *
 * Nothing is sent by the app. A player whose stored number cannot be
 * normalised is listed as unreachable rather than given a link that would
 * open WhatsApp with no recipient and look like it worked.
 */
export default function NotifySquadSheet({
  fixture,
  players,
  sinceNotice,
  onNotified,
  onClose,
}: {
  fixture: FixtureBrief;
  players: NotifyTarget[];
  /** Who came in and went out since the squad was last sent, and when that was. */
  sinceNotice?: { at: string; added: NotifyTarget[]; removed: NotifyTarget[] } | null;
  /** The squad was sent (copied, or a WhatsApp opened): it's remembered as what the players know. */
  onNotified?: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [messaged, setMessaged] = useState<Set<string>>(new Set());

  const rows = useMemo(
    () =>
      players.map((p) => ({
        ...p,
        number: toWhatsAppNumber(p.mobile),
      })),
    [players],
  );

  const reachable = rows.filter((r) => r.number);
  const unreachable = rows.filter((r) => !r.number);
  const askingAvailability = players.length === 0;
  const announcement = askingAvailability
    ? buildAvailabilityRequest(fixture)
    : buildSquadAnnouncement(
        fixture,
        players.map((p) => ({ name: p.preferredName, shirtNo: p.shirtNo, position: p.playingPosition })),
      );

  const copyAnnouncement = async () => {
    try {
      await navigator.clipboard.writeText(announcement);
      if (!askingAvailability) onNotified?.();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Message copied — paste it into your team group');
    } catch {
      toast.error('Could not copy. Select the text and copy manually.');
    }
  };

  const notify = (row: (typeof rows)[number]) => {
    if (!row.number) return;
    const message = buildSelectionMessage(row.preferredName, fixture);
    window.open(whatsAppLink(row.number, message), '_blank', 'noopener,noreferrer');
    setMessaged((prev) => new Set(prev).add(row.id));
    onNotified?.();
  };

  // Just the players who changed since the squad was sent.
  const changed = sinceNotice && (sinceNotice.added.length > 0 || sinceNotice.removed.length > 0) ? sinceNotice : null;
  const tellOne = (p: NotifyTarget, dropped: boolean) => {
    const number = toWhatsAppNumber(p.mobile);
    if (!number) return;
    const message = dropped ? buildDroppedMessage(p.preferredName, fixture) : buildSelectionMessage(p.preferredName, fixture);
    window.open(whatsAppLink(number, message), '_blank', 'noopener,noreferrer');
    setMessaged((prev) => new Set(prev).add(`${dropped ? 'out' : 'in'}:${p.id}`));
  };

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom">
        <div className="sticky top-0 bg-background border-b border-border px-4 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {askingAvailability ? 'Ask for availability' : 'Notify squad'}
            </h2>
            <p className="text-xs text-muted-foreground">
              {askingAvailability
                ? 'Nobody selected yet'
                : `${players.length} selected · opens WhatsApp, you press send`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-muted text-muted-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-4 py-3 space-y-4">
          {changed && (
            <section>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Since you notified {safeFormat(changed.at, 'EEE HH:mm')}
              </h3>
              <ul className="space-y-1.5">
                {[...changed.added.map((p) => ({ p, out: false })), ...changed.removed.map((p) => ({ p, out: true }))].map(({ p, out }) => (
                  <li key={`${out ? 'out' : 'in'}:${p.id}`} className="flex items-center justify-between gap-2 border border-border rounded-lg px-3 py-2">
                    <span className="text-sm text-foreground truncate">
                      <span className={out ? 'text-danger-soft-foreground' : 'text-success-soft-foreground'}>{out ? '−' : '+'}</span> {p.preferredName}
                    </span>
                    {toWhatsAppNumber(p.mobile) ? (
                      <button
                        onClick={() => tellOne(p, out)}
                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border border-border text-foreground hover:bg-muted"
                      >
                        {messaged.has(`${out ? 'out' : 'in'}:${p.id}`) ? <Check className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />}
                        WhatsApp
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">No number</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {/* Whole squad: copy for the team group. */}
          <section>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              {askingAvailability ? 'Team group' : 'Whole squad'}
            </h3>
            <pre className="text-xs bg-muted/50 border border-border rounded-lg p-2.5 whitespace-pre-wrap font-sans text-foreground max-h-40 overflow-y-auto">
              {announcement}
            </pre>
            <button
              onClick={copyAnnouncement}
              className="mt-2 w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy for team group'}
            </button>
          </section>

          {/* One tap per player. */}
          {!askingAvailability && (
            <section>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Message individually
              </h3>
              {reachable.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No selected player has a usable mobile number.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {reachable.map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center gap-2 border border-border rounded-lg px-2.5 py-2"
                    >
                      <span className="flex-1 min-w-0 truncate text-sm text-foreground">
                        {row.preferredName}
                      </span>
                      <button
                        onClick={() => notify(row)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                          messaged.has(row.id)
                            ? 'border-green-300 bg-green-50 text-green-700'
                            : 'border-border text-muted-foreground hover:bg-muted/50'
                        }`}
                      >
                        {messaged.has(row.id) ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <MessageCircle className="h-3.5 w-3.5" />
                        )}
                        {messaged.has(row.id) ? 'Opened' : 'WhatsApp'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {unreachable.length > 0 && (
            <section>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                No usable number ({unreachable.length})
              </h3>
              <p className="text-xs text-muted-foreground mb-1.5">
                Ask them to correct their mobile in My details: a full international
                number, or a plain 8-digit Hong Kong one.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {unreachable.map((row) => (
                  <span
                    key={row.id}
                    className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground"
                  >
                    {row.preferredName}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
