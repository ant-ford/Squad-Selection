import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { getPlayerFixtures, GetPlayerFixturesOutputType } from 'zite-endpoints-sdk';
import { Skeleton } from '@/components/ui/skeleton';
import AvailabilitySheet from '@/components/AvailabilitySheet';

type Fixture = GetPlayerFixturesOutputType['fixtures'][0];

export default function PlayerFixtures() {
  const { playerId } = useParams<{ playerId: string }>();
  const [data, setData] = useState<GetPlayerFixturesOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedFixture, setSelectedFixture] = useState<Fixture | null>(null);

  const loadData = useCallback(() => {
    if (!playerId) return;
    setLoading(true);
    getPlayerFixtures({ playerId })
      .then(setData)
      .catch(() => setError('Player not found or inactive'))
      .finally(() => setLoading(false));
  }, [playerId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6 space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-32" />
        {[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <p className="text-muted-foreground">{error || 'Something went wrong'}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-4">
          <p className="text-lg font-semibold text-foreground">My Fixtures</p>
          <p className="text-sm text-muted-foreground">{data.playerName} · {data.registeredTeam}</p>
        </div>
      </header>

      <div className="container mx-auto px-4 py-4 space-y-2">
        {data.fixtures.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No upcoming fixtures</p>
        ) : (
          data.fixtures.map(f => (
            <FixtureRow key={f.id} fixture={f} onTap={() => setSelectedFixture(f)} />
          ))
        )}
      </div>

      {selectedFixture && (
        <AvailabilitySheet
          fixture={selectedFixture}
          playerId={playerId!}
          onClose={() => setSelectedFixture(null)}
          onSaved={() => { setSelectedFixture(null); loadData(); }}
        />
      )}
    </div>
  );
}

function FixtureRow({ fixture, onTap }: { fixture: Fixture; onTap: () => void }) {
  const d = parseISO(fixture.date);
  const isUnavailable = fixture.availabilityStatus === 'Unavailable';

  return (
    <button
      onClick={onTap}
      className={`w-full border border-border rounded-lg p-4 text-left transition-colors hover:bg-muted/50 ${
        isUnavailable ? 'bg-muted/30' : ''
      }`}
    >
      <div className="flex justify-between items-start">
        <div>
          <p className="font-medium text-sm text-foreground">{fixture.homeTeam} vs {fixture.awayTeam}</p>
          <p className="text-xs text-muted-foreground">
            {format(d, 'EEE d MMM')} · {format(d, 'HH:mm')} · {fixture.venue}
          </p>
        </div>
        <div className="text-right space-y-1">
          {fixture.selectionStatus ? (
            <span className="inline-block text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground">
              {fixture.selectionStatus}
            </span>
          ) : (
            <span className="inline-block text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
              Not selected
            </span>
          )}
          <span className={`block text-xs ${
            fixture.availabilityStatus === 'Unavailable'
              ? 'text-destructive'
              : fixture.availabilityStatus === 'Maybe'
              ? 'text-secondary-foreground'
              : 'text-muted-foreground'
          }`}>
            {fixture.availabilityStatus}
          </span>
        </div>
      </div>
      {fixture.playerNotes && (
        <p className="text-xs text-muted-foreground mt-2 italic">"{fixture.playerNotes}"</p>
      )}
    </button>
  );
}
