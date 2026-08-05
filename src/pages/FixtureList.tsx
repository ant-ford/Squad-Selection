import { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useUpcomingFixtures } from '@/lib/queries';
import { safeFormat, isPastFixture } from '@/lib/dateUtils';
import { Skeleton } from '@/components/ui/skeleton';
import FixtureCard from '@/components/FixtureCard';
import type { ProfileData } from '@/api/getMyProfile';
import type { UpcomingFixture } from '@/api/getUpcomingFixtures';
import { CoachCalendarExport } from '@/components/CoachCalendarExport';

export default function FixtureList() {
  const { profile } = useOutletContext<{ profile: ProfileData }>();
  const [activeTab, setActiveTab] = useState('all');
  const [showPast, setShowPast] = useState(false);

  // Performance: fetch ALL coached fixtures once; tabs filter client-side.
  // The Worker already returns every coached team's fixtures when no team
  // param is passed, so per-tab requests were redundant round-trips that
  // blanked the list behind skeletons on every tab switch.
  const { data, isLoading } = useUpcomingFixtures();
  const allFixtures = data?.fixtures || [];

  const fixtures = useMemo(() => {
    let filtered = activeTab === 'all' ? allFixtures : allFixtures.filter((f) => f.hkfcTeam === activeTab);
    if (!showPast) {
      filtered = filtered.filter((f) => !isPastFixture(f.date));
    }
    return filtered;
  }, [allFixtures, activeTab, showPast]);

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
      <div className="flex items-center justify-between gap-4 border-b border-border py-2">
        {tabs.length > 2 && (
          <div className="flex gap-4 overflow-x-auto flex-1">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`text-sm pb-2 whitespace-nowrap shrink-0 ${
                  activeTab === t.key ? 'font-medium text-foreground border-b-2 border-primary' : 'text-muted-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowPast((v) => !v)}
            className={`text-xs px-2 py-1 rounded-md ${showPast ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
            title={showPast ? 'Hide past fixtures' : 'Show past fixtures'}
          >
            {showPast ? 'Showing past' : 'Hide past'}
          </button>
          <CoachCalendarExport activeTab={activeTab} />
        </div>
      </div>
      {isLoading ? (
        <div className="space-y-3 pt-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
        </div>
      ) : fixtures.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">{showPast ? 'No fixtures found' : 'No upcoming fixtures found'}</p>
          {showPast && (
            <button onClick={() => setShowPast(false)} className="mt-2 text-sm text-primary hover:underline">
              Show upcoming fixtures
            </button>
          )}
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