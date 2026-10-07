import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import PersonPicker from '@/components/admin/PersonPicker';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ActionButton } from '@/components/ui/action-button';
import { safeFormat } from '@/lib/dateUtils';
import { checkRefusal, linkedNote } from '@/lib/dataChecks';
import { linkMatchCard, type UnlinkedCard } from '@/api/dataChecks';

/**
 * Link one unlinked match card: a suggestion or anyone found by name, and
 * whether the card's name becomes their registered name (which also links
 * this season's other cards with it).
 */
export default function LinkCardSheet({
  card,
  onClose,
  onSaved,
}: {
  card: UnlinkedCard;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [who, setWho] = useState<{ id: string; name: string } | null>(card.suggestions[0] ?? null);
  const [other, setOther] = useState(card.suggestions.length === 0);
  const [saveName, setSaveName] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const link = useMutation({
    mutationFn: () => linkMatchCard(card.id, who!.id, saveName),
    onSuccess: (r) => {
      toast.success(linkedNote(r.linked));
      onSaved();
    },
    onError: (err) => setError(checkRefusal(err)),
  });

  const choice = (selected: boolean) =>
    `w-full min-h-11 px-3 py-2 rounded-md border text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      selected ? 'border-primary bg-primary/5 text-foreground' : 'border-border bg-background text-foreground hover:bg-muted'
    }`;

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" className="sm:max-w-lg sm:mx-auto sm:left-0 sm:right-0">
        <SheetHeader onClose={onClose}>
          <SheetTitle>Link card</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-4">
          <div>
            <p className="text-sm font-medium text-foreground">{card.rawName}</p>
            <p className="text-xs text-muted-foreground">
              {[card.team, safeFormat(card.matchDate, 'd MMM yyyy', ''), card.opponent ? `v ${card.opponent}` : ''].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="space-y-2" role="radiogroup" aria-label="Whose card">
            {card.suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={!other && who?.id === s.id}
                className={choice(!other && who?.id === s.id)}
                onClick={() => {
                  setOther(false);
                  setWho(s);
                  setError(null);
                }}
              >
                <span className="block">{s.name}</span>
                {s.team && <span className="block text-xs text-muted-foreground">{s.team}</span>}
              </button>
            ))}
            {card.suggestions.length > 0 && (
              <button
                type="button"
                role="radio"
                aria-checked={other}
                className={choice(other)}
                onClick={() => {
                  setOther(true);
                  setWho(null);
                  setError(null);
                }}
              >
                Someone else
              </button>
            )}
            {other && (
              <PersonPicker
                value={who}
                onChange={(p) => {
                  setWho(p ? { id: p.id, name: p.name } : null);
                  setError(null);
                }}
              />
            )}
          </div>
          <label className="flex items-start gap-3 min-h-10 text-sm text-foreground">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
              checked={saveName}
              onChange={(e) => setSaveName(e.target.checked)}
            />
            <span>
              Save “{card.rawName}” as their registered name
            </span>
          </label>
          {error && (
            <p role="alert" className="text-sm text-danger-soft-foreground">
              {error}
            </p>
          )}
          <ActionButton fullWidth size="md" loading={link.isPending} disabled={!who} onClick={() => link.mutate()}>
            {who ? `Link to ${who.name}` : 'Link'}
          </ActionButton>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
