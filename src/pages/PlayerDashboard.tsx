import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/useAuth';
import { getMyFixtures, GetMyFixturesOutput } from '@/api/getMyFixtures';
import { Skeleton } from '@/components/ui/skeleton';
import { LogOut, Shield } from 'lucide-react';
import PlayerFixtureCard from '@/components/PlayerFixtureCard';
import PlayerAvailabilitySheet from '@/components/PlayerAvailabilitySheet';

type Fixture = GetMyFixturesOutput['fixtures'][0];

export default function PlayerDashboard() {
  const { user, isLoading, logout } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<GetMyFixturesOutput | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedFixture, setSelectedFixture] = useState<Fixture | null>(null);

  const loadData = useCallback(() => {
    if (!user) return;
    setLoading(true);
    getMyFixtures()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  if (isLoading || !user) {
    return <DashboardSkeleton />;
  }

  if (loading || !data) {
    return <DashboardSkeleton />;
  }

  // Count stats
  const selectedCount = data.fixtures.filter(f => f.selectionStatus === 'Selected').length;
  const reserveCount = data.fixtures.filter(f => f.selectionStatus === 'Reserve').length;
  const unavailableCount = data.fixtures.filter(f => f.availabilityStatus === 'Unavailable').length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-foreground">HKFC Hockey</h1>
              <p className="text-sm text-muted-foreground">Squad Selection</p>
            </div>
            <div className="flex items-center gap-2">
              {data.isCoach && (
                <button
                  onClick={() => navigate('/coach')}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground"
                >
                  <Shield className="h-3.5 w-3.5" />
                  Coach View
                </button>
              )}
              <button
                onClick={() => logout()}
                className="p-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Player Info Card */}
      <div className="container mx-auto px-4 py-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-lg font-bold text-primary">
                {(data.playerName || '?')[0].toUpperCase()}
              </span>
            </div>
            <div className="flex-1">
              <p className="font-semibold text-foreground">{data.playerName}</p>
              <p className="text-sm text-muted-foreground">
                {data.registeredTeam || 'No team'}{data.playingPosition ? ` · ${data.playingPosition}` : ''}{data.shirtNoValue ? ` · #${data.shirtNoValue}` : ''}
              </p>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-3 mt-4">
            <StatBox label="Selected" value={selectedCount} color="bg-primary/10 text-primary" />
            <StatBox label="Reserve" value={reserveCount} color="bg-accent text-accent-foreground" />
            <StatBox label="Unavailable" value={unavailableCount} color="bg-destructive/10 text-destructive" />
          </div>
        </div>
      </div>

      {/* Fixtures List */}
      <div className="container mx-auto px-4 pb-8">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Upcoming Fixtures ({data.fixtures.length})
        </h2>

        {data.fixtures.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-xl">
            <p className="text-muted-foreground">No upcoming fixtures for your team</p>
          </div>
        ) : (
          <div className="space-y-2">
            {data.fixtures.map(f => (
              <PlayerFixtureCard
                key={f.id}
                fixture={f}
                onTap={() => setSelectedFixture(f)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedFixture && (
        <PlayerAvailabilitySheet
          fixture={selectedFixture}
          onClose={() => setSelectedFixture(null)}
          onSaved={() => { setSelectedFixture(null); loadData(); }}
        />
      )}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-lg p-3 text-center ${color}`}>
      <p className="text-xl font-bold">{value}</p>
      <p className="text-xs mt-0.5">{label}</p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card px-4 py-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-24 mt-1" />
      </div>
      <div className="container mx-auto px-4 py-4 space-y-4">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    </div>
  );
}
