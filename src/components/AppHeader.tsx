import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { LogOut, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProfileData } from '@/api/getMyProfile';

export default function AppHeader({ profile }: { profile: ProfileData }) {
  const logout = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };
  const navigate = useNavigate();
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
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            <User className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">Player</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => logout()}>
            <LogOut className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">Logout</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
