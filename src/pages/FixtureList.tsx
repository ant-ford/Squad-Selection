import { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useUpcomingFixtures } from '@/lib/queries';
import { safeFormat } from '@/lib/dateUtils';
import { Skeleton } from '@/components/ui/skeleton';
import FixtureCard from '@/components/FixtureCard';
import type { ProfileData } from '@/api/getMyProfile';
import type { UpcomingFixture } from '@/api/getUpcomingFixtures';

export default function FixtureList() {
  const { profile } = useOutletContext<{ profile: ProfileData }>();
  const [activeTab, setActiveTab] = useState('all');

  const filter = activeTab === 'all' ? undefined : activeTab;
  const { data, isLoading } = useUpcomingFixtures(filter);

  const fixtures = data?.fixtures || [];

  const coachTeams = profile?.coachTeams ?? [];
  const tabs = [
    { key: 'all', label: 'All' },
    ...coachTeams.map(t => ({ key: t.teamName, label: t.teamName })),
  ];

  const grouped = useMemo(() => {
    return fixtures.reduce<Record<string, UpcomingFixture[]>>((acc, f) => {
      const dateKey = safeFormat(f.date, 'yyyy-MM-dd', 'unknown');
      (acc[dateKey] ||= []).push(f);
      return acc;
    }, {});
  }, [fixtures]);

  const sortedDates = Object.keys(grouped).sort();

  return (
    <div className="container mx-auto px-4 pb-8">
      {tabs.length > 2 && (
        <div className="flex gap-4 border-b border-border py-2 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`text-sm pb-2 whitespace-nowrap shrink-0 ${
                activeTab === t.key
                  ? 'font-medium text-foreground border-b-2 border-primary'
                  : 'text-muted-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3 pt-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
        </div>
      ) : fixtures.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No upcoming fixtures found</p>
        </div>
      ) : (
        <div className="pt-4 space-y-4">
          {sortedDates.map(dateKey => (
            <div key={dateKey}>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                {safeFormat(dateKey, 'EEE d MMM yyyy')}
              </p>
              <div className="space-y-2">
                {grouped[dateKey].map(f => (
                  <FixtureCard key={f.id} fixture={f} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}