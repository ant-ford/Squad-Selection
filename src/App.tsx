import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { useAuth } from '@/lib/useAuth';
import Login from './pages/Login';
import CoachLayout from './components/CoachLayout';
import FixtureList from './pages/FixtureList';
import SquadSelection from './pages/SquadSelection';
import PlayerDashboard from './pages/PlayerDashboard';
import PlayerFixtures from './pages/PlayerFixtures';

function AppRoutes() {
  const { user, isLoading } = useAuth();

  if (isLoading) return <div>Loading...</div>;
  if (!user) return <Login />;

  return (
    <Routes>
      <Route path="/" element={<PlayerDashboard />} />
      <Route path="/player/:playerId" element={<PlayerFixtures />} />
      <Route path="/coach" element={<CoachLayout />}>
        <Route index element={<FixtureList />} />
        <Route path="match/:matchId" element={<SquadSelection />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
      <Toaster />
    </BrowserRouter>
  );
}