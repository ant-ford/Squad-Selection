import { HelpCircle } from 'lucide-react';
import { headerIconClass } from '@/components/AppHeader';

/**
 * The player, coach, Kit Convenor and social secretary guides, published from the eddy-site repository to
 * eddy.global. Linked rather than copied into the app, so that repository
 * stays their one source.
 */
export const GUIDE_URLS = {
  player: 'https://eddy.global/guides/players/',
  coach: 'https://eddy.global/guides/coaches/',
  kit: 'https://eddy.global/guides/kit/',
  events: 'https://eddy.global/guides/events/',
} as const;

const LABELS: Record<keyof typeof GUIDE_URLS, string> = {
  player: 'Help: the player guide',
  coach: 'Help: the coach guide',
  kit: 'Help: the Kit Convenor guide',
  events: 'Help: the social secretary guide',
};

/** Header Help icon: opens the guide in a new tab, so the app keeps its place. */
export default function HelpLink({ guide }: { guide: keyof typeof GUIDE_URLS }) {
  const label = LABELS[guide];
  return (
    <a href={GUIDE_URLS[guide]} target="_blank" rel="noopener noreferrer" className={headerIconClass} title={label} aria-label={label}>
      <HelpCircle className="h-4 w-4" />
    </a>
  );
}
