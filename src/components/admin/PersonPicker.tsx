import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ActionButton } from '@/components/ui/action-button';
import { searchable } from '@/lib/peopleAdmin';
import { searchPeople, type PersonSearchRow } from '@/api/adminPeople';

/**
 * Choose one person by name (GET /api/admin/people). Shows the chosen name
 * with Change, or a search box and up to 20 matches.
 */
export default function PersonPicker({
  value,
  onChange,
  id,
}: {
  value: { id: string; name: string } | null;
  onChange: (p: PersonSearchRow | null) => void;
  id?: string;
}) {
  const [text, setText] = useState('');
  const [q, setQ] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(searchable(text)), 250);
    return () => clearTimeout(t);
  }, [text]);
  const { data, isFetching, error } = useQuery({
    queryKey: ['peopleSearch', q],
    queryFn: () => searchPeople(q!),
    enabled: !!q && !value,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 text-sm font-medium text-foreground truncate">{value.name}</span>
        <ActionButton variant="ghost" onClick={() => onChange(null)}>
          Change
        </ActionButton>
      </div>
    );
  }
  const people = q ? data?.people ?? [] : [];
  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <Input
          id={id}
          type="search"
          className="pl-9"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Name"
          autoComplete="off"
          aria-label="Search by name"
        />
      </div>
      {q && error && <p className="text-xs text-danger-soft-foreground">The search didn't load.</p>}
      {q && !error && !isFetching && people.length === 0 && <p className="text-xs text-muted-foreground">Nobody matches.</p>}
      {people.length > 0 && (
        <ul className="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border">
          {people.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onChange(p)}
                className="w-full min-h-10 px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="block text-sm text-foreground">{p.name}</span>
                {p.team && <span className="block text-xs text-muted-foreground">{p.team}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
