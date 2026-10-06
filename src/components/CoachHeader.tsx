import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { User, ListChecks, Home, IdCard } from 'lucide-react';
import type { ProfileData } from '@/api/getMyProfile';
import AppHeader, { headerNavClass } from '@/components/AppHeader';
import { MainMenu, ProfileMenu, officerItems } from '@/components/HeaderMenus';
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
    <AppHeader
      subtitle={teamNames ? `Coaching ${teamNames}` : 'No teams assigned'}
      menu={<MainMenu officer={officerItems(profile)} profile={profile} />}
    >
      <button onClick={() => navigate(coachDashboardPath())} className={headerNavClass(isDashboard)} aria-label="Dashboard">
        <span className="hidden sm:inline">Dashboard</span>
        <Home className="h-3.5 w-3.5 sm:hidden" />
      </button>
      <button onClick={() => navigate('/coach/ranking')} className={headerNavClass(isRanking)}>
        <ListChecks className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Ranking</span>
      </button>
      <button onClick={() => navigate('/')} className={headerNavClass()}>
        <User className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Player View</span>
      </button>
      <ProfileMenu guide="coach" onLogout={logout} entries={[{ to: '/my-details', label: 'My details', icon: IdCard }]} />
    </AppHeader>
  );
}
