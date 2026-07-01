import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { getUpcomingFixtures, GetUpcomingFixturesOutputType } from 'zite-endpoints-sdk';
import { Skeleton } from '@/components/ui/skeleton';
import FixtureCard from '@/components/FixtureCard';
import type { ProfileData } from '@/components/CoachLayout';

type Fixture = GetUpcomingFixturesOutputType['fixtures'][0];

export default function FixtureList() {
  const { profile } = useOutletContext<{ profile: ProfileData }>();
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    const filter = activeTab === 'all' ? undefined : activeTab;
    setLoading(true);
    getUpcomingFixtures({ teamFilter: filter })
      .then(data => setFixtures(data.fixtures))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeTab]);

  const tabs = [
    { key: 'all', label: 'All' },
    ...profile.coachedTeams.map(t => ({ key: t.teamName, label: t.teamName })),
  ];

  // Group fixtures by date
  const grouped = fixtures.reduce<Record<string, Fixture[]>>((acc, f) => {
    const dateKey = format(parseISO(f.date), 'yyyy-MM-dd');
    (acc[dateKey] ||= []).push(f);
    return acc;
  }, {});
  const sortedDates = Object.keys(grouped).sort();

  return (
    <div className="container mx-auto px-4 pb-8">
      {/* Team filter tabs */}
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

      {loading ? (
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
                {format(parseISO(dateKey), 'EEE d MMM yyyy')}
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
