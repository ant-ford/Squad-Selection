import { useState } from 'react';
import { useRecommendations } from '@/lib/queries';
import { Loader2, Plus, HelpCircle } from 'lucide-react';

const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'];
const POS_SHORT: Record<string, string> = { Goalkeeper: 'GK', Defender: 'DEF', Midfielder: 'MID', Forward: 'FWD' };

interface Props {
  matchId: string;
  side?: 'home' | 'away';
  excludeIds?: Set<string>;
  onSelect: (playerId: string) => void;
}

export default function RecommendationsPanel({ matchId, side, excludeIds, onSelect }: Props) {
  const [position, setPosition] = useState<string | undefined>(undefined);
  const [showLegend, setShowLegend] = useState(false);
  const { data, isLoading } = useRecommendations(matchId, side, position);

  const visible = (data?.recommendations ?? []).filter((r) => !excludeIds?.has(r.id));

  return (
    <div className="border border-border rounded-lg p-3 bg-card shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-foreground">Recommended Players</p>
          <button
            onClick={() => setShowLegend(!showLegend)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Score legend"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        </div>
        <select
          value={position ?? ''}
          onChange={(e) => setPosition(e.target.value || undefined)}
          className="text-xs border border-border rounded px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">Any position</option>
          {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {showLegend && (
        <div className="mb-2 p-2 bg-muted rounded text-xs text-muted-foreground">
          Score = Ability (50%) + Position fit (20%) + Team proximity (20%) + Play-up capacity (10%).
          “Maybe” players are heavily penalised.
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Finding best fits...
        </div>
      ) : visible.length > 0 ? (
        <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
          {visible.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-0">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground text-xs">
                  {r.preferredName}
                  <span className="text-[11px] font-normal text-muted-foreground ml-1.5">
                    · {r.playingAbility} · {POS_SHORT[r.playingPosition] || r.playingPosition}
                  </span>
                </p>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {r.reasons.map((reason, i) => (
                    <span key={i} className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                      {reason}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className="text-xs font-semibold text-muted-foreground">{r.score}%</span>
                <button
                  onClick={() => onSelect(r.id)}
                  className="p-1 rounded bg-primary text-primary-foreground hover:bg-primary/95 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
                  aria-label={`Select ${r.preferredName}`}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic py-2 text-center">No matching candidates to recommend.</p>
      )}
    </div>
  );
}