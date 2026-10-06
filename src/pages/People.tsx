import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronRight, Search } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { StatusChip } from '@/components/ui/status-chip';
import { ErrorState } from '@/components/ui/error-state';
import { useMyProfile } from '@/lib/queries';
import { personChip, searchable } from '@/lib/peopleAdmin';
import { searchPeople } from '@/api/adminPeople';

/** Officers' person search (the `people` section): a name box and the matches. */
export default function People() {
  const { data: profile, isLoading: profileLoading } = useMyProfile();
  const allowed = profile?.sections?.includes('people') ?? false;
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');

  // The URL follows the box after a short pause, so Back returns to the same list.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (text.trim()) next.set('q', text.trim());
      else next.delete('q');
      if (next.toString() !== params.toString()) setParams(next, { replace: true });
    }, 250);
    return () => clearTimeout(t);
  }, [text, params, setParams]);

  const q = searchable(params.get('q') ?? '');
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['peopleSearch', q],
    queryFn: () => searchPeople(q!),
    enabled: allowed && !!q,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const body = () => {
    if (profileLoading) return <Skeleton className="h-64 w-full" />;
    if (!allowed) return <p className="text-center py-12 text-muted-foreground">This screen is for officers.</p>;
    return (
      <>
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            className="pl-9"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Name"
            aria-label="Search by name"
            autoFocus
            autoComplete="off"
            enterKeyHint="search"
          />
        </div>
        {!q ? null : isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : error || !data ? (
          <ErrorState message="The search didn't load." onRetry={() => void refetch()} retrying={isFetching} />
        ) : data.people.length === 0 ? (
          <p className="text-center py-8 text-sm text-muted-foreground">Nobody matches.</p>
        ) : (
          <ul className="rounded-xl border border-border bg-card divide-y divide-border">
            {data.people.map((p) => {
              const chip = personChip(p);
              return (
                <li key={p.id}>
                  <Link
                    to={`/people/${encodeURIComponent(p.id)}`}
                    className="flex items-center gap-2 min-h-12 px-3 py-2 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-foreground truncate">{p.name}</span>
                      {p.team && <span className="block text-xs text-muted-foreground">{p.team}</span>}
                    </span>
                    {chip && <StatusChip tone={chip.tone}>{chip.label}</StatusChip>}
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader title="People" />
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4 space-y-3">{body()}</main>
      <AppFooter />
    </div>
  );
}
