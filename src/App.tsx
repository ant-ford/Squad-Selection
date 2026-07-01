import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import CoachLayout from '@/components/CoachLayout';
import FixtureList from '@/pages/FixtureList';
import SquadSelection from '@/pages/SquadSelection';
import PlayerDashboard from '@/pages/PlayerDashboard';
import PlayerFixtures from '@/pages/PlayerFixtures';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Player dashboard (auth) — default landing */}
        <Route path="/" element={<PlayerDashboard />} />

        {/* Legacy player link (no auth, URL-based) */}
        <Route path="/player/:playerId" element={<PlayerFixtures />} />

        {/* Coach/Admin routes (auth required) */}
        <Route path="/coach" element={<CoachLayout />}>
          <Route index element={<FixtureList />} />
          <Route path="match/:matchId" element={<SquadSelection />} />
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}
