import { useOutletContext } from 'react-router-dom';
import FixtureList from './FixtureList';
import type { ProfileData } from '@/api/getMyProfile';

/**
 * Coach Command Centre — deliberately minimal.
 *
 * Philosophy: exception management, not prescription. The dashboard is the
 * fixture list; positional decisions stay with the coach inside Squad
 * Selection, where the recommendation engine already lives.
 *
 * The Play-Up Watch list that used to sit above the fixtures was removed
 * (owner request, 2026-09-23): each player's play-up count is coloured on
 * the squad screen instead, where the decision is actually made.
 */
export default function CoachDashboard() {
  const { profile } = useOutletContext<{ profile: ProfileData }>();

  return (
    <div className="pb-8">
      {/* ── Welcome header ── */}
      <div className="container mx-auto px-4 pt-4 pb-2">
        <h1 className="text-xl font-semibold text-foreground">Coach Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Welcome back, {profile?.preferredName}.
        </p>
      </div>

      {/* ── Fixtures with team tabs (shared query, no duplicate fetch) ── */}
      <FixtureList />
    </div>
  );
}
