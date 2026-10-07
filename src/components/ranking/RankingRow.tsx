import { useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent } from 'react';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

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
      style={props.style}
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
  return (
    // The row drags and long-presses on pointer down; the menu is neither.
    <div className="shrink-0" onPointerDown={(e) => e.stopPropagation()}>
      <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger
          onClick={(e) => e.stopPropagation()}
          className="h-10 w-8 -my-1 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
          aria-label={`More actions for ${props.name}`}
        >
          <MoreVertical className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-52" onPointerDown={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => props.onOpenMoveToRank(player.id)}>
            <ArrowUpDown className="h-4 w-4" /> Move to rank
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => props.onViewStats(player.id)}>
            <BarChart3 className="h-4 w-4" /> Season stats
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => props.onViewAttendance(player.id)}>
            <CalendarDays className="h-4 w-4" /> Attendance
          </DropdownMenuItem>
          {props.onViewHistory && (
            <DropdownMenuItem onSelect={() => props.onViewHistory?.(player.id)}>
              <History className="h-4 w-4" /> History
            </DropdownMenuItem>
          )}
          {props.onMakeInactive && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => props.onMakeInactive?.(player.id)}
                disabled={props.draftPending}
                title={props.draftPending ? 'Save or discard your reorder first' : undefined}
                className="text-danger-soft-foreground"
              >
                <UserMinus className="h-4 w-4" /> Make inactive
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
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
