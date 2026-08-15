import { safeFormat } from '@/lib/dateUtils';
import { useNavigate } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import type { SameDayConflict } from '@/lib/readiness';

type Fixture = {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  hkfcTeam: string;
  opponent: string;
  isHome: boolean;
  division: string;
  venue: string;
  targetSquadSize: number;
  selectedCount: number;
  maybeCount: number;
  unavailableCount: number;
  maybeNames?: string[];
  unavailableNames?: string[];
  selectedUnavailableNames?: string[];
  hasGoalkeeperSelected?: boolean;
};

/** Click-toggled name popover that positions above or below based on viewport space. */
function NamePopover({
  names,
  label,
  count,
}: {
  names: string[];
  label: string;
  count: number;
}) {
  const [open, setOpen] = useState(false);
  const [showBelow, setShowBelow] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    // If less than 120px above the trigger, show below instead
    setShowBelow(rect.top < 120);
  }, [open]);

  if (names.length === 0) {
    return <span>{count} {label}</span>;
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex items-center gap-0.5 cursor-pointer"
      >
        {count} {label}
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <>
          {/* Backdrop to close on outside click */}
          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div
            className={`absolute left-0 z-20 bg-card text-foreground text-xs rounded-md p-2 shadow-lg border border-border whitespace-normal min-w-[120px] max-w-[200px] ${
              showBelow ? 'top-full mt-1' : 'bottom-full mb-1'
            }`}
          >
            {names.join(', ')}
          </div>
        </>
      )}
    </div>
  );
}

/** Warning icon inside the player-count badge; clicking lists the clashes for this fixture. */
function ClashIndicator({
  conflicts,
  hkfcTeam,
}: {
  conflicts: SameDayConflict[];
  hkfcTeam: string;
}) {
  const [open, setOpen] = useState(false);
  const [showBelow, setShowBelow] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    setShowBelow(triggerRef.current.getBoundingClientRect().top < 120);
  }, [open]);

  return (
    <span className="relative inline-flex">
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="ml-1 inline-flex cursor-pointer items-center"
        title={`${conflicts.length} player${conflicts.length > 1 ? 's' : ''} selected for two teams on the same day`}
        aria-label="Same-day clash warning"
      >
        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div
            className={`absolute right-0 z-20 bg-card text-foreground text-xs rounded-md p-2 shadow-lg border border-border whitespace-normal min-w-[160px] max-w-[240px] ${
              showBelow ? 'top-full mt-1' : 'bottom-full mb-1'
            }`}
          >
            <p className="font-medium mb-1">Same-day clash</p>
            <ul className="space-y-0.5">
              {conflicts.map((c, idx) => {
                const other = c.teams.find((t) => t !== hkfcTeam) ?? c.teams.join(' & ');
                return <li key={idx}>{c.playerName} also selected for {other}</li>;
              })}
            </ul>
          </div>
        </>
      )}
    </span>
  );
}

export default function FixtureCard({
  fixture,
  conflicts = [],
}: {
  fixture: Fixture;
  conflicts?: SameDayConflict[];
}) {
  const navigate = useNavigate();
  const time = safeFormat(fixture.date, 'HH:mm');
  const shortfall = fixture.targetSquadSize - fixture.selectedCount;
  const isFull = shortfall <= 0;

  const openMatch = () =>
    navigate(`/coach/match/${fixture.id.replace(/-home$/, '').replace(/-away$/, '')}?side=${fixture.isHome ? 'home' : 'away'}`);

  const maybeNames = fixture.maybeNames ?? [];
  const unavailNames = fixture.unavailableNames ?? [];
  const nowUnavailable = fixture.selectedUnavailableNames ?? [];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openMatch}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMatch(); } }}
      className="w-full border border-border rounded-lg p-4 text-left hover:bg-muted/50 transition-colors cursor-pointer"
    >
      <div className="flex justify-between items-start">
        <div className="min-w-0">
          <p className="font-medium text-foreground truncate">
            {fixture.hkfcTeam === fixture.homeTeam
              ? <><span className="font-bold">{fixture.homeTeam}</span> vs {fixture.awayTeam}</>
              : <>{fixture.homeTeam} vs <span className="font-bold">{fixture.awayTeam}</span></>
            }
          </p>
          <p className="text-sm text-muted-foreground">
            Division: {fixture.division} · {fixture.venue} · {time}
          </p>
        </div>
        <div className="text-right shrink-0 ml-3">
          <span className={`relative inline-flex items-center px-2 py-1 rounded-md text-sm font-medium ${isFull ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            {fixture.selectedCount} / {fixture.targetSquadSize}
            {conflicts.length > 0 && <ClashIndicator conflicts={conflicts} hkfcTeam={fixture.hkfcTeam} />}
          </span>
          {(shortfall > 0 || fixture.maybeCount > 0) && (
            <p className="mt-1 flex items-center justify-end gap-2 text-xs font-medium">
              {shortfall > 0 && <span className="text-destructive">{shortfall} short</span>}
              {fixture.maybeCount > 0 && <span className="text-amber-600">{fixture.maybeCount} maybe</span>}
            </p>
          )}
          {nowUnavailable.length > 0 && (
            <p className="text-xs text-destructive font-semibold mt-1 flex items-center gap-1 justify-end">
              <AlertTriangle className="h-3 w-3" />
              {nowUnavailable.length} selected player{nowUnavailable.length > 1 ? 's' : ''} now unavailable
            </p>
          )}
        </div>
      </div>
      <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
        <NamePopover names={maybeNames} label="maybe" count={fixture.maybeCount} />
        <NamePopover names={unavailNames} label="unavail" count={fixture.unavailableCount} />
      </div>
    </div>
  );
}