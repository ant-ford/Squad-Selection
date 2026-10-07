import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, MessageCircle } from 'lucide-react';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { toWhatsAppNumber, whatsAppLink } from '@/lib/whatsapp';
import { fillMessage } from '@shared/messageTemplates';
import { getMessageTemplates, logMessage } from '@/api/messages';

export interface WhatsAppPerson {
  id: string;
  name: string;
  firstName?: string;
  mobile?: string;
}

/**
 * "WhatsApp these people" (review item D3): one message, filled in per
 * person ({first name}, or a template's {{Preferred Name}}), and one
 * WhatsApp link each. wa.me reaches one person at a time, so the sender
 * taps down the list and presses send in WhatsApp. Each tap is logged
 * (message_log), as the Airtable "Send WhatsApp" button did.
 */
export default function WhatsAppListSheet({
  title,
  people,
  defaultMessage = 'Hi {first name}, ',
  onClose,
}: {
  title: string;
  people: WhatsAppPerson[];
  defaultMessage?: string;
  onClose: () => void;
}) {
  const [message, setMessage] = useState(defaultMessage);
  const [templateId, setTemplateId] = useState('');
  const [sent, setSent] = useState<Set<string>>(new Set());
  const templates = useQuery({ queryKey: ['messageTemplates'], queryFn: getMessageTemplates, staleTime: 5 * 60_000 });

  const rows = useMemo(() => people.map((p) => ({ ...p, number: toWhatsAppNumber(p.mobile) })), [people]);
  const reachable = rows.filter((r) => r.number);
  const unreachable = rows.length - reachable.length;

  const chooseTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.data?.templates.find((x) => x.id === id);
    if (t) setMessage(t.body);
  };

  const send = (row: (typeof rows)[number]) => {
    if (!row.number) return;
    const text = fillMessage(message, row);
    window.open(whatsAppLink(row.number, text), '_blank', 'noopener,noreferrer');
    setSent((prev) => new Set(prev).add(row.id));
    void logMessage({ personId: row.id, message: text, templateId: templateId || undefined }).catch(() => {});
  };

  return (
    <Sheet open dirty={sent.size > 0 && sent.size < reachable.length} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" className="sm:max-w-lg sm:mx-auto sm:left-0 sm:right-0">
        <SheetHeader onClose={onClose}>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-3">
          {(templates.data?.templates.length ?? 0) > 0 && (
            <select
              value={templateId}
              onChange={(e) => chooseTemplate(e.target.value)}
              className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
              aria-label="Template"
            >
              <option value="">Your own message</option>
              {templates.data!.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} aria-label="Message" />
          <p className="text-xs text-muted-foreground">
            {'{first name}'} becomes each person's name. {sent.size} of {reachable.length} opened
            {unreachable > 0 ? ` · ${unreachable} without a usable number` : ''}.
          </p>
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                <span className="text-sm text-foreground truncate">{r.name}</span>
                {r.number ? (
                  <button
                    onClick={() => send(r)}
                    disabled={!message.trim()}
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border border-border text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    {sent.has(r.id) ? <Check className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />}
                    WhatsApp
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground">No number</span>
                )}
              </li>
            ))}
          </ul>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
