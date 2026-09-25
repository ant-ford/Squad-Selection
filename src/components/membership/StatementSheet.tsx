import { useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ConfirmDialog';
import type { StatementCard } from '@/api/membership';
import { ApiError } from '@/lib/apiClient';
import { useRequestReviewEmail } from '@/lib/queries';
import { safeFormat } from '@/lib/dateUtils';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { AUTO_NOTICE_DAYS, NOT_STARTED, SPONSOR_SUBMITTED } from '@shared/statementStages';
import { Fact, TextBlock } from './ApplicantSheet';
import { Initial, periodLabel, statementStatus } from './StatementCard';

const date = (d?: string) => (d ? safeFormat(d, 'd MMM yyyy') : undefined);

/** Rich-text fields arrive as Markdown; the sheet shows them as plain text. */
const plain = (s?: string) => s?.replace(/\*\*|__/g, '').replace(/\\([*_#\-.])/g, '$1').trim() || undefined;

const count = (n?: number) => (n === undefined ? undefined : String(n));

const linkClass =
  'inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-muted hover:bg-muted/80 text-foreground max-w-full';

export default function StatementSheet({
  card,
  today,
  onClose,
}: {
  card: StatementCard;
  today: string;
  onClose: () => void;
}) {
  const wide = useMediaQuery('(min-width: 640px)');
  const status = statementStatus(card, today);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side={wide ? 'right' : 'bottom'} className="p-4 pb-8 overflow-y-auto">
        <SheetHeader onClose={onClose}>
          <div className="flex items-center gap-3 min-w-0">
            <Initial name={card.name} size="h-12 w-12" />
            <div className="min-w-0">
              <SheetTitle>{card.name}</SheetTitle>
              <p className="text-xs text-muted-foreground">{card.stage || 'No Review Progress'}</p>
            </div>
          </div>
        </SheetHeader>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          {status && <span className={`text-xs px-2 py-0.5 rounded ${status.tone}`}>{status.label}</span>}
          {card.waitingOn && card.stage !== NOT_STARTED && (
            <span className="text-xs text-muted-foreground">Waiting on {card.waitingOn}</span>
          )}
        </div>

        {(card.playerStatement.length > 0 || (card.stage === SPONSOR_SUBMITTED && card.officerFormUrl)) && (
          <div className="flex flex-wrap gap-2 mb-4">
            {card.stage === SPONSOR_SUBMITTED && card.officerFormUrl && (
              <a href={card.officerFormUrl} target="_blank" rel="noreferrer" className={linkClass}>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" /> Open my review form
              </a>
            )}
            {card.playerStatement.map((f) => (
              <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className={linkClass} title="Player Statement">
                <FileText className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{f.filename}</span>
              </a>
            ))}
          </div>
        )}

        {card.stage === NOT_STARTED && <NotifySection card={card} today={today} onDone={onClose} />}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 mb-5">
          <Fact label="Membership No." value={card.membershipNo} />
          <Fact label="Period" value={periodLabel(card)} />
          <Fact label="Join Date" value={date(card.joinDate)} />
          <Fact label="Commitment End" value={date(card.commitmentEndDate)} />
          <Fact label="Team" value={card.team} />
          <Fact label="Sponsor" value={card.sponsor} />
          <Fact label="Matches Played" value={count(card.matchesPlayed)} />
          <Fact label="Team Played" value={count(card.matchesTeamPlayed)} />
          <Fact label="Available, Did Not Play" value={count(card.matchesAvailable)} />
          <Fact label="Not Available" value={count(card.matchesNotAvailable)} />
          <Fact label="Teams Played" value={card.teamsPlayed.join(', ')} />
          <Fact label="Practices" value={card.practices} />
          <Fact label="Social Functions" value={card.socialFunctions.join(', ')} />
          <Fact label="Games Umpired" value={card.gamesUmpired} />
          <Fact label="Qualified Umpire" value={card.qualifiedUmpire} />
          <Fact label="Recommended Reduction" value={card.recommendedReduction} />
          <Fact label="Member Submitted" value={date(card.memberSubmittedOn)} />
          <Fact label="Sponsor Submitted" value={date(card.sponsorSubmittedOn)} />
          <Fact label="Officer Submitted" value={date(card.officerSubmittedOn)} />
        </dl>

        <div className="space-y-4">
          <TextBlock label="Reason for Low Participation (Member)" text={plain(card.lowParticipationReason)} />
          <TextBlock label="Other Contributions (Member)" text={plain(card.otherContributions)} />
          <TextBlock label="Section Service and Involvement (Member)" text={plain(card.sectionServiceMember)} />
          <TextBlock label="HKFC Service and Involvement (Member)" text={plain(card.hkfcServiceMember)} />
          <TextBlock label="Recommendation (Sponsor)" text={plain(card.sponsorRecommendation)} />
          <TextBlock label="Section Service and Involvement (Sponsor)" text={plain(card.sectionServiceSponsor)} />
          <TextBlock label="HKFC Service and Involvement (Sponsor)" text={plain(card.hkfcServiceSponsor)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The board's one action: ask Airtable to send the review email now rather
 * than on the automatic date. The app ticks Notify Now and the same
 * automation sends the email and moves the review on; everything is checked
 * again on the Worker.
 */
function NotifySection({ card, today, onDone }: { card: StatementCard; today: string; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const notify = useRequestReviewEmail();
  const first = card.name.split(' ')[0] || card.name;

  const submit = () => {
    setConfirming(false);
    notify.mutate(card.id, {
      onSuccess: () => {
        toast.success(`Email requested for ${card.name}. Airtable sends it within a minute or two.`);
        onDone();
      },
      onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not request the email. Please try again.'),
    });
  };

  let note: string;
  if (card.notifyRequested) {
    note = 'The email has been requested. It moves to Notified Member once Airtable has sent it.';
  } else if (card.inAutoWindow) {
    note = `The period ends within ${AUTO_NOTICE_DAYS} days, so the automatic email should already have gone. If ${first} has not received it, check the automation's run history in Airtable.`;
  } else if (!card.personId) {
    note = 'No member is linked to this row, so there is no one to email. Fix the People link in Airtable.';
  } else if (card.periodEnd && card.periodEnd < today) {
    note = `The period has ended, so the automatic email will not go. Send it now to start ${first}'s review.`;
  } else if (card.autoNoticeOn) {
    note = `The automatic email goes on ${date(card.autoNoticeOn)}. You can send it now instead.`;
  } else {
    note = 'You can send the review email now.';
  }

  return (
    <section className="mb-5 p-3 rounded-lg border border-border bg-muted/30">
      <h3 className="font-semibold text-sm text-foreground">Review email</h3>
      <p className="text-xs text-muted-foreground mt-1">{note}</p>
      {card.canNotify && (
        <Button
          className="mt-3 w-full h-10 bg-primary text-primary-foreground disabled:opacity-50"
          disabled={notify.isPending}
          onClick={() => setConfirming(true)}
        >
          {notify.isPending ? 'Requesting…' : 'Notify member now'}
        </Button>
      )}
      {confirming && (
        <ConfirmDialog
          title={`Email ${card.name} now?`}
          message={`Airtable sends the Commitment Review email to ${first}, copying the Membership Officer, and moves this review to Notified Member.`}
          confirmLabel="Send email"
          onConfirm={submit}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  );
}
