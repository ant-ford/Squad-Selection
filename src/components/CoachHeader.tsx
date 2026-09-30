import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { LogOut, User, ListChecks, Home } from 'lucide-react';
import type { ProfileData } from '@/api/getMyProfile';
import AppHeader, { headerNavClass, headerIconClass } from '@/components/AppHeader';
import HelpLink from '@/components/HelpLink';
import OfficersMenu, { officerItems } from '@/components/OfficersMenu';
import { coachDashboardPath } from '@/lib/scrollMemory';

export default function CoachHeader({ profile }: { profile: ProfileData }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout: signOut } = useAuth();
  const isDashboard = location.pathname === '/coach';
  const isRanking = location.pathname === '/coach/ranking';

  const logout = async () => {
    await signOut();
    navigate('/');
  };

  const teamNames = profile.coachTeams.map(t => t.teamName).join(', ');

  return (
    <AppHeader subtitle={teamNames ? `Coaching ${teamNames}` : 'No teams assigned'}>
      <button onClick={() => navigate(coachDashboardPath())} className={headerNavClass(isDashboard)} aria-label="Dashboard">
        <span className="hidden sm:inline">Dashboard</span>
        <Home className="h-3.5 w-3.5 sm:hidden" />
      </button>
      <button onClick={() => navigate('/coach/ranking')} className={headerNavClass(isRanking)}>
        <ListChecks className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Ranking</span>
      </button>
      <OfficersMenu items={officerItems(profile)} />
      <button onClick={() => navigate('/')} className={headerNavClass()}>
        <User className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Player View</span>
      </button>
      <HelpLink guide="coach" />
      <button onClick={logout} className={headerIconClass} aria-label="Log out">
        <LogOut className="h-4 w-4" />
      </button>
    </AppHeader>
  );
}
