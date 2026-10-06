import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HeartHandshake } from 'lucide-react';
import { getMyVolunteering } from '@/api/volunteering';
import { hkDateKey } from '@shared/hkDateKey';
import { seasonStartYear } from '@shared/season';

/**
 * On the player page, until they've saved their volunteering this season
 * (owner, 2026-10-01: the page stays for important items). They can still
 * change it any time from My details. Nothing on the Airtable backend (the
 * call answers 409).
 */
export default function MyVolunteeringLink() {
  const { data } = useQuery({ queryKey: ['myVolunteering'], queryFn: getMyVolunteering, staleTime: 5 * 60_000, retry: false });
  if (!data) return null;
  const today = hkDateKey(new Date().toISOString());
  if (data.updatedAt && hkDateKey(data.updatedAt) >= `${seasonStartYear(today)}-07-01`) return null;
  return (
    <Link to="/volunteering" className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-card p-3 hover:bg-muted/50">
      <HeartHandshake className="h-5 w-5 text-primary shrink-0" aria-hidden />
      <span className="flex-1 min-w-0 text-sm text-foreground">How would you like to help the section this season?</span>
      <span className="text-xs font-medium text-primary shrink-0">Tell us</span>
    </Link>
  );
}
