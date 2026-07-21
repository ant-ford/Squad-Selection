import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { LogOut, User, ListChecks } from 'lucide-react';
import type { ProfileData } from '@/api/getMyProfile';

export default function AppHeader({ profile }: { profile: ProfileData }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isRanking = location.pathname === '/coach/ranking';

  const logout = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  const teamNames = profile.coachTeams.map(t => t.teamName).join(', ');

  return (
    <header className="w-full border-b border-border bg-card">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-lg font-semibold text-foreground">HKFC Squad Selection</p>
          <p className="text-sm text-muted-foreground">
            {teamNames ? `Coaching: ${teamNames}` : 'No teams assigned'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => navigate('/coach/ranking')}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors ${
              isRanking
                ? 'bg-secondary text-secondary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            <ListChecks className="h-3.5 w-3.5" />
            Ranking
          </button>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground"
          >
            <User className="h-3.5 w-3.5" />
            Player View
          </button>
          <button
            onClick={() => logout()}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}