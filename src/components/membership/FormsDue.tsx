import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import WhatsAppListSheet from '@/components/WhatsAppListSheet';
import { getFormsDue } from '@/api/membership';

type Form = 'waivers' | 'details';

const FORMS: { key: Form; title: string; path: string; message: (link: string) => string }[] = [
  {
    key: 'waivers',
    title: 'Waivers & declarations',
    path: '/waivers',
    message: (link) => `Hi {first name}, please sign this season's waivers & declarations in Eddy: ${link}`,
  },
  {
    key: 'details',
    title: 'My details',
    path: '/my-details',
    message: (link) => `Hi {first name}, please check your details in Eddy for the new season: ${link}`,
  },
];

/**
 * The Membership screen's Forms tab (review item D3): how many Active
 * people still owe this season's waivers or details check, and a WhatsApp
 * list for each (worker/src/formsDue.ts).
 */
export default function FormsDue() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({ queryKey: ['formsDue'], queryFn: getFormsDue, staleTime: 60_000 });
  const [open, setOpen] = useState<Form | null>(null);

  if (isLoading) return <Skeleton className="h-32 w-full max-w-lg" />;
  if (error || !data) return <ErrorState message="The forms list didn't load." onRetry={() => void refetch()} retrying={isFetching} />;

  const form = FORMS.find((f) => f.key === open);

  return (
    <>
      <ul className="max-w-lg rounded-xl border border-border bg-card divide-y divide-border">
        {FORMS.map((f) => (
          <li key={f.key} className="flex items-center gap-3 px-3 py-2 min-h-12">
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium text-foreground">{f.title}</span>
              <span className="block text-xs text-muted-foreground">{data[f.key].length} not done</span>
            </span>
            {data[f.key].length > 0 && (
              <button
                onClick={() => setOpen(f.key)}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border border-border text-foreground hover:bg-muted"
              >
                <MessageCircle className="h-3.5 w-3.5" aria-hidden /> WhatsApp
              </button>
            )}
          </li>
        ))}
      </ul>
      {form && (
        <WhatsAppListSheet
          title={`${form.title}: not done`}
          people={data[form.key]}
          defaultMessage={form.message(`${window.location.origin}${form.path}`)}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
