import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { LogOut, User, ListChecks, Home } from 'lucide-react';
import type { ProfileData } from '@/api/getMyProfile';

export default function AppHeader({ profile }: { profile: ProfileData }) {
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
    <header className="w-full border-b border-border bg-card">
      <div className="container mx-auto px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between gap-1">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-7 w-7 sm:h-8 sm:w-8 shrink-0">
            <img src="/assets/logo-plain.svg" alt="Eddy" className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0 hidden sm:block">
            <p className="text-lg font-semibold text-foreground">HKFC Squad Selection</p>
            <p className="text-sm text-muted-foreground truncate">
              {teamNames ? `Coaching: ${teamNames}` : 'No teams assigned'}
            </p>
          </div>
          <div className="sm:hidden">
            <p className="text-sm font-semibold text-foreground">HKFC Squad</p>
          </div>
        </div>
        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          <button onClick={() => navigate('/coach')} className={navBtn(isDashboard)} aria-label="Dashboard">
            <span className="hidden sm:inline">Dashboard</span>
            <Home className="h-3.5 w-3.5 sm:hidden" />
          </button>
          <button onClick={() => navigate('/coach/ranking')} className={navBtn(isRanking)}>
            <ListChecks className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Ranking</span>
          </button>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1 text-xs px-2 sm:px-3 py-1.5 rounded-md bg-primary text-primary-foreground"
          >
            <User className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Player View</span>
          </button>
          <button
            onClick={logout}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

function navBtn(active: boolean) {
  return `flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors ${active ? 'bg-secondary text-secondary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`;
}