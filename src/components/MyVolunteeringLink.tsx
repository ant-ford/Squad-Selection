import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HeartHandshake } from 'lucide-react';
import { getMyVolunteering } from '@/api/volunteering';
import { VOLUNTEER_GROUPS } from '@shared/volunteering';

/**
 * On the player page: what they've offered to help with, and a link to
 * change it any time. Nothing on the Airtable backend (the call answers 409).
 */
export default function MyVolunteeringLink() {
  const { data } = useQuery({ queryKey: ['myVolunteering'], queryFn: getMyVolunteering, staleTime: 5 * 60_000, retry: false });
  if (!data) return null;
  const roles = VOLUNTEER_GROUPS.flatMap((g) => data.roles[g.key]);
  const text = roles.length
    ? `You'd help with: ${roles.slice(0, 3).join(', ')}${roles.length > 3 ? ` and ${roles.length - 3} more` : ''}.`
    : data.nothingForNow
      ? 'Volunteering: nothing for now.'
      : 'How would you like to help the section?';
  return (
    <Link to="/volunteering" className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-card p-3 hover:bg-muted/50">
      <HeartHandshake className="h-5 w-5 text-primary shrink-0" aria-hidden />
      <span className="flex-1 min-w-0 text-sm text-foreground">{text}</span>
      <span className="text-xs font-medium text-primary shrink-0">{roles.length || data.nothingForNow ? 'Update' : 'Tell us'}</span>
    </Link>
  );
}
