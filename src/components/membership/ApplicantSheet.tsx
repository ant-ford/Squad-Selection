import { useState, type ReactNode } from 'react';
import { FileText, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ConfirmDialog';
import { getNumberHolders, type ApplicantCard, type NumberHolder } from '@/api/membership';
import { ApiError } from '@/lib/apiClient';
import { useApproveApplicant } from '@/lib/queries';
import { safeFormat } from '@/lib/dateUtils';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { hkDateKey } from '@shared/hkDateKey';
import { Avatar, ageLabel, ageTone, applicantWhatsApp } from './ApplicantCard';

const date = (d?: string) => (d ? safeFormat(d, 'd MMM yyyy') : undefined);

const describeHolders = (holders: NumberHolder[]) =>
  holders.map((h) => (h.status ? `${h.name} (${h.status})` : h.name)).join(', ');

export function Fact({ label, value }: { label: string; value?: ReactNode }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

export function TextBlock({ label, text }: { label: string; text?: string }) {
  if (!text) return null;
  return (
    <section>
      <h3 className="text-xs font-semibold text-muted-foreground mb-1">{label}</h3>
      <p className="text-sm text-foreground whitespace-pre-line">{text}</p>
    </section>
  );
}

export default function ApplicantSheet({ card, onClose }: { card: ApplicantCard; onClose: () => void }) {
  const wide = useMediaQuery('(min-width: 640px)');
  const whatsApp = applicantWhatsApp(card);
  const age = ageLabel(card);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side={wide ? 'right' : 'bottom'} className="p-4 pb-8 overflow-y-auto">
        <SheetHeader onClose={onClose}>
          <div className="flex items-center gap-3 min-w-0">
            <Avatar card={card} size="h-12 w-12" />
            <div className="min-w-0">
              <SheetTitle>{card.name}</SheetTitle>
              <p className="text-xs text-muted-foreground">{card.stage || 'No stage'}</p>
            </div>
          </div>
        </SheetHeader>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          {age && <span className={`text-xs px-2 py-0.5 rounded ${ageTone(card.days)}`}>{age}</span>}
          {card.waitingOn && <span className="text-xs text-muted-foreground">Waiting on {card.waitingOn}</span>}
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {whatsApp && (
            <a
              href={whatsApp}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-muted hover:bg-muted/80 text-foreground"
            >
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp {card.mobileNo}
            </a>
          )}
          {card.applicationForm.map((f) => (
            <a
              key={f.url}
              href={f.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-muted hover:bg-muted/80 text-foreground max-w-full"
              title="Sports Associate Application Form"
            >
              <FileText className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{f.filename}</span>
            </a>
          ))}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 mb-5">
          <Fact label="Membership No." value={card.membershipNo} />
          <Fact label="Status" value={card.status} />
          <Fact label="Join Date" value={date(card.joinDate)} />
          <Fact label="Commitment End" value={date(card.commitmentEndDate)} />
          <Fact label="Applied" value={date(card.appliedOn)} />
          <Fact label="Applicant Type" value={card.applicantType} />
          <Fact label="Category" value={card.categoryType} />
          <Fact label="Team" value={card.team} />
          <Fact label="Position" value={card.playingPosition} />
          <Fact label="Sponsor" value={card.sponsor} />
          <Fact label="Qualified Umpire" value={card.qualifiedUmpire} />
          <Fact label="Qualified Coach" value={card.qualifiedCoach} />
          <Fact label="Playing Level" value={card.playingLevel.join(', ')} />
          <Fact label="Tour Interest" value={card.tourInterest.join(', ')} />
        </dl>

        <div className="space-y-4">
          <TextBlock label="Sports Background / Involvement" text={card.sportsBackground} />
          <TextBlock label="Personal / Family Interest" text={card.personalInterest} />
          <TextBlock label="Selection Comments / Coach Requests" text={card.selectionComments} />
        </div>

        {card.canApprove && <ApproveForm card={card} onDone={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

/**
 * The one change the board makes: stage 6 -> Accepted once the club has
 * confirmed. Everything is checked again on the Worker; this form only
 * catches the obvious before a round trip.
 */
function ApproveForm({ card, onDone }: { card: ApplicantCard; onDone: () => void }) {
  const [joinDate, setJoinDate] = useState(() => hkDateKey(new Date().toISOString()));
  const [commitmentEndDate, setCommitmentEndDate] = useState(card.commitmentEndDate ?? '');
  const [membershipNo, setMembershipNo] = useState(card.membershipNo ?? '');
  // Who else has the number, looked up when Approve is pressed. null = not
  // confirming yet; an empty list = the number is not shared.
  const [holders, setHolders] = useState<NumberHolder[] | null>(null);
  const [checking, setChecking] = useState(false);
  const approve = useApproveApplicant();

  const problem = !joinDate
    ? 'Enter the Join Date.'
    : !commitmentEndDate
    ? 'Enter the Commitment End Date.'
    : commitmentEndDate <= joinDate
    ? 'Commitment End Date must be after the Join Date.'
    : !membershipNo.trim()
    ? 'Enter the Membership No. the club confirmed.'
    : null;

  // Families share one Membership No., so a shared number is a warning in
  // the confirmation, not a refusal.
  const review = async () => {
    setChecking(true);
    try {
      setHolders(await getNumberHolders(membershipNo.trim(), card.id));
    } catch {
      toast.error('Could not check the Membership No. Please try again.');
    } finally {
      setChecking(false);
    }
  };

  const submit = () => {
    const shared = (holders?.length ?? 0) > 0;
    setHolders(null);
    approve.mutate(
      {
        personId: card.id,
        joinDate,
        commitmentEndDate,
        membershipNo: membershipNo.trim(),
        sharedNumberAcknowledged: shared,
      },
      {
        onSuccess: () => {
          toast.success(`${card.name} approved as a member`);
          onDone();
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Approval failed. Please try again.'),
      },
    );
  };

  const input =
    'w-full h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary';

  return (
    <section className="mt-6 border-t border-border pt-4">
      <h3 className="font-semibold text-foreground">Approve membership</h3>
      <p className="text-xs text-muted-foreground mb-3">
        Once the club has confirmed. Sets Status to Member and the stage to Accepted.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-muted-foreground">
          Join Date
          <input type="date" className={input} value={joinDate} onChange={(e) => setJoinDate(e.target.value)} />
        </label>
        <label className="text-xs text-muted-foreground">
          Commitment End Date
          <input
            type="date"
            className={input}
            value={commitmentEndDate}
            min={joinDate || undefined}
            onChange={(e) => setCommitmentEndDate(e.target.value)}
          />
        </label>
        <label className="text-xs text-muted-foreground col-span-2">
          Membership No.
          <input
            className={input}
            value={membershipNo}
            onChange={(e) => setMembershipNo(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
          />
        </label>
      </div>
      {problem && <p className="text-xs text-muted-foreground mt-2">{problem}</p>}
      <Button
        className="mt-3 w-full h-10 bg-primary text-primary-foreground disabled:opacity-50"
        disabled={problem !== null || approve.isPending || checking}
        onClick={review}
      >
        {approve.isPending ? 'Approving…' : checking ? 'Checking…' : 'Approve'}
      </Button>
      {holders && (
        <ConfirmDialog
          title={`Approve ${card.name}?`}
          message={
            `Status → Member, stage → Accepted, Join Date ${date(joinDate)}, Commitment End Date ${date(
              commitmentEndDate,
            )}, Membership No. ${membershipNo.trim()}.` +
            (holders.length > 0
              ? ` Note: this Membership No. is also used by ${describeHolders(holders)}. Spouses and children share a number; check this is meant to be shared.`
              : '')
          }
          confirmLabel={holders.length > 0 ? 'Approve anyway' : 'Approve'}
          onConfirm={submit}
          onCancel={() => setHolders(null)}
        />
      )}
    </section>
  );
}
