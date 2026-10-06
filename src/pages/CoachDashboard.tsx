import FixtureList from './FixtureList';

/**
 * Coach view - deliberately minimal.
 *
 * Philosophy: exception management, not prescription. The dashboard is the
 * fixture list; positional decisions stay with the coach inside Squad
 * Selection, where the recommendation engine already lives.
 *
 * The Play-Up Watch list that used to sit above the fixtures was removed
 * (owner request, 2026-09-23): each player's play-up count is coloured on
 * the squad screen instead, where the decision is actually made. The
 * "Welcome back" line went too: the header already says whose app it is.
 */
export default function CoachDashboard() {
  return (
    <div className="pb-8">
      <FixtureList />
    </div>
  );
}
