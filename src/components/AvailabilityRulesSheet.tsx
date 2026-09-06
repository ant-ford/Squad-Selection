import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import {
  createMyAvailabilityRule,
  deleteMyAvailabilityRule,
  getMyAvailabilityRules,
  type AvailabilityRule,
  type AvailabilityRuleType,
  type RuleAvailability,
} from '@/api/availabilityRules';

const RULE_TYPES: { value: AvailabilityRuleType; label: string; hint: string }[] = [
  { value: 'Play-ups', label: 'Play-ups', hint: 'fixtures for teams above yours' },
  { value: 'Support games', label: 'Support games', hint: 'fixtures for teams below yours' },
  { value: 'Midweek', label: 'Midweek games', hint: 'anything Monday to Friday' },
  { value: 'Date range', label: 'Between dates', hint: 'a holiday, say' },
  { value: 'All future', label: 'All future fixtures', hint: 'everything from now on' },
];

const AVAILABILITY: RuleAvailability[] = ['Available', 'Maybe', 'Unavailable'];

const STATUS_STYLE: Record<RuleAvailability, string> = {
  Available: 'bg-green-100 text-green-800 border-green-200',
  Maybe: 'bg-amber-100 text-amber-800 border-amber-200',
  Unavailable: 'bg-red-100 text-red-800 border-red-200',
};

function describe(rule: AvailabilityRule): string {
  const type = RULE_TYPES.find((t) => t.value === rule.ruleType)?.label ?? rule.ruleType;
  if (rule.ruleType === 'Date range') {
    if (rule.startDate && rule.endDate) return `${rule.startDate} to ${rule.endDate}`;
    if (rule.startDate) return `From ${rule.startDate}`;
    if (rule.endDate) return `Until ${rule.endDate}`;
  }
  if (rule.ruleType === 'All future' && rule.startDate) return `All fixtures from ${rule.startDate}`;
  return type;
}

/**
 * Standing availability preferences.
 *
 * A rule is only the DEFAULT for fixtures the player has not answered
 * individually - tapping a specific fixture always wins - so setting one can
 * never silently undo an answer they already gave. Where rules overlap the
 * more specific one applies, which is stated in the sheet rather than left
 * for players to discover.
 */
export default function AvailabilityRulesSheet({ onClose }: { onClose: () => void }) {
  const [rules, setRules] = useState<AvailabilityRule[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [ruleType, setRuleType] = useState<AvailabilityRuleType>('Play-ups');
  const [availability, setAvailability] = useState<RuleAvailability>('Unavailable');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const load = () => {
    getMyAvailabilityRules()
      .then(setRules)
      .catch(() => {
        setRules([]);
        toast.error('Could not load your preferences');
      });
  };

  useEffect(load, []);

  const needsDates = ruleType === 'Date range';

  const add = async () => {
    if (needsDates && !startDate && !endDate) {
      toast.error('Add a start date, an end date, or both');
      return;
    }
    if (startDate && endDate && startDate > endDate) {
      toast.error('The start date is after the end date');
      return;
    }
    setSaving(true);
    try {
      await createMyAvailabilityRule({
        ruleType,
        availability,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      toast.success('Preference saved');
      setAdding(false);
      setStartDate('');
      setEndDate('');
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save that preference');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (rule: AvailabilityRule) => {
    const previous = rules;
    setRules((prev) => (prev ?? []).filter((r) => r.id !== rule.id)); // optimistic
    try {
      await deleteMyAvailabilityRule(rule.id);
      toast.success('Preference removed');
    } catch {
      setRules(previous ?? null);
      toast.error('Could not remove that preference');
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Availability preferences</SheetTitle>
        </SheetHeader>

        <p className="text-xs text-muted-foreground mt-1">
          Standing answers for fixtures you haven't set individually. Setting a fixture
          yourself always overrides these, and where two overlap the more specific one wins.
        </p>

        <div className="mt-3 space-y-2">
          {rules === null ? (
            <Skeleton className="h-16 w-full rounded-lg" />
          ) : rules.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No preferences set.</p>
          ) : (
            rules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center gap-2 border border-border rounded-lg px-2.5 py-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">{describe(rule)}</p>
                  {rule.notes && (
                    <p className="text-[11px] text-muted-foreground truncate">{rule.notes}</p>
                  )}
                </div>
                {rule.availability && (
                  <span
                    className={`text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${
                      STATUS_STYLE[rule.availability]
                    }`}
                  >
                    {rule.availability}
                  </span>
                )}
                <button
                  onClick={() => remove(rule)}
                  className="p-1 text-muted-foreground hover:text-red-600 transition-colors shrink-0"
                  aria-label="Remove preference"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {!adding ? (
          <button
            onClick={() => setAdding(true)}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 border border-border rounded-lg py-2 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add a preference
          </button>
        ) : (
          <div className="mt-3 border border-border rounded-lg p-3 space-y-3">
            <label className="block">
              <span className="text-[11px] text-muted-foreground">I want to set my availability for</span>
              <select
                value={ruleType}
                onChange={(e) => setRuleType(e.target.value as AvailabilityRuleType)}
                className="mt-1 w-full p-2 border border-border rounded bg-background text-foreground text-sm"
              >
                {RULE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label} — {t.hint}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <span className="text-[11px] text-muted-foreground">and I am</span>
              <div className="mt-1 flex gap-1.5">
                {AVAILABILITY.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAvailability(a)}
                    className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                      availability === a
                        ? STATUS_STYLE[a]
                        : 'border-border text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>

            {(needsDates || ruleType === 'All future') && (
              <div className="flex gap-2">
                <label className="flex-1">
                  <span className="text-[11px] text-muted-foreground">
                    {needsDates ? 'From' : 'From (optional)'}
                  </span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="mt-1 w-full p-2 border border-border rounded bg-background text-foreground text-sm"
                  />
                </label>
                {needsDates && (
                  <label className="flex-1">
                    <span className="text-[11px] text-muted-foreground">To</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="mt-1 w-full p-2 border border-border rounded bg-background text-foreground text-sm"
                    />
                  </label>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setAdding(false)}
                className="flex-1 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-muted/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={add}
                disabled={saving}
                className="flex-1 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
