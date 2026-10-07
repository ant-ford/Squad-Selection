import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowUpDown, BarChart3, CalendarDays, ChevronDown, ChevronUp, FileText, GripVertical, History, MessageSquare, MoreVertical, UserMinus,
} from 'lucide-react';
import type { Player } from '@shared/schema/domainTypes';
import { POS_SHORT } from '@/lib/format';
import { DEFAULT_PHOTO, fallBackToDefaultPhoto, thumbOf } from '@/lib/defaultPhoto';
import { abilityBadgeStyle } from '@/lib/abilityColour';
import { nameOf, shortStage } from '@/lib/rankingModel';
import { toneClasses } from '@/lib/statusTone';

export interface RankingRowActions {
  onMoveStep: (id: string, dir: 'up' | 'down') => void;
  onOpenMoveToRank: (playerId: string) => void;
  onViewStats: (playerId: string) => void;
  onViewAttendance: (playerId: string) => void;
  /** Who changed what for this player (HistorySheet). */
  onViewHistory?: (playerId: string) => void;
  onPhotoClick: (url: string) => void;
  /** Section Captains only; left out, the menu has no "Make inactive". */
  onMakeInactive?: (playerId: string) => void;
}

export interface RankingRowProps extends RankingRowActions {
  player: Player;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  /** An unsaved reorder exists: making someone inactive would throw it away. */
  draftPending: boolean;
  /** Phone layout: no drag handle or arrows; a Move button and long-press instead. */
  compact: boolean;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}

export const NO_ROW_ACTIONS: RankingRowActions = {
  onMoveStep: () => {},
  onOpenMoveToRank: () => {},
  onViewStats: () => {},
  onViewAttendance: () => {},
  onPhotoClick: () => {},
};

/** How long a press on a phone row must last to open Move to rank. */
const LONG_PRESS_MS = 500;
/** A finger that moves further than this is scrolling, not pressing. */
const LONG_PRESS_SLOP_PX = 10;

export function SortableRankingRow(props: RankingRowProps) {
  // On a phone there is no drag at all: the list scrolls under the finger.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.player.id,
    disabled: props.disabled || props.compact,
  });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <RankingRow {...props} isDragging={isDragging} dragHandleProps={listeners ?? {}} />
    </div>
  );
}

export function RankingRow(
  props: RankingRowProps & { isDragging: boolean; dragHandleProps: Record<string, unknown>; style?: CSSProperties },
) {
  const { player, disabled, isDragging, compact } = props;
  const [showCv, setShowCv] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const rank = player.sectionRank ?? 0;
  const ability = player.playingAbility ?? '—';
  const isApplicant = player.status === 'Applicant';
  const hasCv = isApplicant && !!player.sportsBackground?.trim();
  const hasComments = !!player.selectionComments?.trim();
  const name = nameOf(player);

  const press = useLongPress(() => {
    if (!disabled) props.onOpenMoveToRank(player.id);
  });

  return (
    <div
      data-rank={rank}
      style={{ ...props.style, zIndex: props.menuOpen ? 50 : undefined }}
      className={`flex items-center gap-2 py-1 px-2 border rounded-lg transition-colors select-none ${
        isApplicant ? toneClasses('warning', 'faint') : 'bg-card'
      } ${isDragging ? 'border-primary' : isApplicant ? 'border-warning/60' : 'border-border'}`}
      {...(compact ? press : {})}
    >
      {!compact && (
        <div
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0 touch-none"
          aria-label={`Drag ${name}`}
          {...props.dragHandleProps}
        >
          <GripVertical className="h-4 w-4" />
        </div>
      )}

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); if (player.photo) props.onPhotoClick(player.photo); }}
        className="shrink-0 rounded-full overflow-hidden border border-border"
        aria-label={player.photo ? `Photo of ${name}` : name}
      >
        <img src={thumbOf(player.photo) || DEFAULT_PHOTO} alt="" className="h-9 w-9 rounded-full object-cover" loading="lazy" onError={fallBackToDefaultPhoto} />
      </button>

      <div className="w-7 text-center shrink-0">
        <span className="text-sm font-bold text-foreground tabular-nums">{rank || '—'}</span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          <p className="text-sm font-medium text-foreground truncate leading-tight">{name}</p>
          {player.shirtNoValue && <span className="text-xs font-bold text-muted-foreground shrink-0">#{player.shirtNoValue}</span>}
          {isApplicant && (
            <span
              className={`text-xs font-medium px-1.5 py-0.5 rounded-sm shrink-0 ${toneClasses('warning', 'soft')}`}
              title={player.applicantStage}
            >
              Applicant{player.applicantStage ? ` · ${shortStage(player.applicantStage)}` : ''}
            </span>
          )}
          {hasCv && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowCv((v) => !v); }}
              aria-pressed={showCv}
              className={`flex items-center gap-1 text-xs font-medium shrink-0 ${showCv ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <FileText className="h-3 w-3" /> CV
            </button>
          )}
          {hasComments && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowComments((v) => !v); }}
              aria-pressed={showComments}
              className={`flex items-center gap-1 text-xs font-medium shrink-0 ${showComments ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <MessageSquare className="h-3 w-3" /> Comments
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate leading-tight">
          {POS_SHORT[player.playingPosition ?? ''] ?? '–'} · {player.registeredTeam ?? '–'} · T#{player.teamRank ?? '–'} · P#{player.positionalRank ?? '–'}
        </p>
        {showCv && player.sportsBackground && (
          <div className="mt-1.5 text-xs text-foreground whitespace-pre-wrap bg-muted/50 border border-border rounded p-2">{player.sportsBackground}</div>
        )}
        {showComments && player.selectionComments && (
          <div className="mt-1.5 text-xs text-foreground whitespace-pre-wrap bg-muted/50 border border-border rounded p-2">{player.selectionComments}</div>
        )}
      </div>

      <span className="text-xs font-bold px-2 py-0.5 rounded shrink-0 border border-transparent bg-muted text-muted-foreground" style={abilityBadgeStyle(ability)} title={ability}>
        {ability}
      </span>

      {compact && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); props.onOpenMoveToRank(player.id); }}
          disabled={disabled}
          aria-label={`Move ${name} to rank`}
          className="h-10 w-10 -my-1 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 shrink-0"
        >
          <ArrowUpDown className="h-4 w-4" />
        </button>
      )}

      <RowMenu {...props} name={name} />

      {!compact && (
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => props.onMoveStep(player.id, 'up')}
            disabled={disabled || props.isFirst}
            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
            aria-label={`Move ${name} up`}
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => props.onMoveStep(player.id, 'down')}
            disabled={disabled || props.isLast}
            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
            aria-label={`Move ${name} down`}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function RowMenu(props: RankingRowProps & { name: string }) {
  const { player, menuOpen, onMenuOpenChange } = props;
  // The list scrolls inside its own box, which clips anything hanging out of
  // it - so for the last rows the menu opens upwards instead.
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuUp, setMenuUp] = useState(false);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menuOpen || !menu) {
      setMenuUp(false);
      return;
    }
    const box = menu.closest('[data-rank-list]')?.getBoundingClientRect();
    const bottomLimit = Math.min(window.innerHeight, box?.bottom ?? Infinity);
    const topLimit = Math.max(0, box?.top ?? 0);
    const rect = menu.getBoundingClientRect();
    const trigger = menu.parentElement!.getBoundingClientRect();
    setMenuUp(rect.bottom > bottomLimit && trigger.top - rect.height - 4 >= topLimit);
  }, [menuOpen]);

  const item = 'w-full flex items-center gap-2 text-left text-sm min-h-10 px-2 rounded hover:bg-muted';
  const choose = (fn: () => void) => () => { onMenuOpenChange(false); fn(); };

  return (
    <div className="relative shrink-0" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onMenuOpenChange(!menuOpen); }}
        className="h-10 w-8 -my-1 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
        aria-label={`More actions for ${props.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          className={`absolute right-0 ${menuUp ? 'bottom-10' : 'top-10'} z-40 w-52 bg-card border border-border rounded-md shadow-lg p-1`}
        >
          <button type="button" role="menuitem" onClick={choose(() => props.onOpenMoveToRank(player.id))} className={item}>
            <ArrowUpDown className="h-4 w-4" /> Move to rank
          </button>
          <div className="my-1 h-px bg-border" />
          <button type="button" role="menuitem" onClick={choose(() => props.onViewStats(player.id))} className={item}>
            <BarChart3 className="h-4 w-4" /> Season stats
          </button>
          <button type="button" role="menuitem" onClick={choose(() => props.onViewAttendance(player.id))} className={item}>
            <CalendarDays className="h-4 w-4" /> Attendance
          </button>
          {props.onViewHistory && (
            <button type="button" role="menuitem" onClick={choose(() => props.onViewHistory?.(player.id))} className={item}>
              <History className="h-4 w-4" /> History
            </button>
          )}
          {props.onMakeInactive && (
            <>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                role="menuitem"
                onClick={() => { if (props.draftPending) return; onMenuOpenChange(false); props.onMakeInactive?.(player.id); }}
                disabled={props.draftPending}
                title={props.draftPending ? 'Save or discard your reorder first' : undefined}
                className={`${item} text-danger-soft-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent`}
              >
                <UserMinus className="h-4 w-4" /> Make inactive
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Press-and-hold on a phone row: after LONG_PRESS_MS without the finger
 * moving, `onLongPress` runs (Move to rank). Moving more than a few pixels
 * means the coach is scrolling, so the press is dropped. Taps on the row's
 * own buttons never start one.
 */
function useLongPress(onLongPress: () => void) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  return {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('button')) return;
      cancel();
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        cancel();
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > LONG_PRESS_SLOP_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    // A long press would otherwise also open the browser's own menu.
    onContextMenu: (e: ReactMouseEvent) => e.preventDefault(),
  };
}
