import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { ApiError } from '@/lib/apiClient';
import { polishAnswer } from '@/api/apply';

/**
 * Under a longer answer: "Polish" asks the AI for a clearer version of what
 * they wrote (keeping their facts), which they can use or ignore. Nothing is
 * saved until they save the step.
 */
export default function PolishButton({ field, text, onUse }: { field: string; text: string; onUse: (better: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const polish = useMutation({ mutationFn: () => polishAnswer(field, text), onSuccess: (r) => setDraft(r.text) });
  const enough = text.trim().split(/\s+/).filter(Boolean).length >= 3;
  return (
    <div className="mt-1 space-y-1.5">
      <button
        type="button"
        disabled={!enough || polish.isPending}
        onClick={() => polish.mutate()}
        className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md border border-border bg-background text-foreground hover:bg-muted disabled:opacity-50"
        title={enough ? 'Suggest a clearer version of your answer' : 'Write a few words first'}
      >
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        {polish.isPending ? 'Polishing…' : 'Polish'}
      </button>
      {polish.error && <p className="text-xs text-destructive">{polish.error instanceof ApiError ? polish.error.message : "Couldn't polish it just now."}</p>}
      {draft && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-2.5 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">A suggestion, keeping what you wrote. Check it's right before using it.</p>
          <p className="text-sm text-foreground whitespace-pre-line">{draft}</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="text-xs font-medium px-2.5 py-1 rounded-md bg-primary text-primary-foreground"
              onClick={() => {
                onUse(draft);
                setDraft(null);
              }}
            >
              Use this
            </button>
            <button type="button" className="text-xs px-2.5 py-1 rounded-md border border-border" onClick={() => setDraft(null)}>
              Keep mine
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
