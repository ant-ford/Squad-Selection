import { useLocation, useNavigate } from 'react-router-dom';
import { Flag } from 'lucide-react';
import { headerNavClass } from '@/components/AppHeader';

/**
 * The header's "Umpire View": the umpiring duties, for the club's umpires
 * and the Umpire Coordinator. A button of its own like Coach View, since
 * umpires open it every week (owner, 7 Oct 2026).
 */
export default function UmpireViewButton() {
  const navigate = useNavigate();
  const here = useLocation().pathname === '/umpiring';
  return (
    <button onClick={() => navigate('/umpiring')} className={headerNavClass(here)}>
      <Flag className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Umpire View</span>
    </button>
  );
}
