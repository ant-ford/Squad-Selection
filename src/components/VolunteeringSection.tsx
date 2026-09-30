import {
  COACH_LEVELS,
  EMPTY_ROLES,
  UMPIRE_LEVELS,
  VOLUNTEER_GROUPS,
  type VolunteeringAnswers,
} from '@shared/volunteering';

const select =
  'w-full h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary';

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex gap-2 items-start py-1 cursor-pointer">
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm text-foreground">{label}</span>
    </label>
  );
}

/**
 * The volunteering questions, for the new joiner form, the start-of-season
 * form and "My volunteering": a checklist per group (unticked is no), one
 * "Nothing for now", and coaching and umpiring levels. Controlled: the page
 * holds the answers and saves them with saveVolunteering.
 */
export default function VolunteeringSection({ value, onChange }: { value: VolunteeringAnswers; onChange: (next: VolunteeringAnswers) => void }) {
  const toggle = (group: keyof typeof EMPTY_ROLES, option: string, on: boolean) => {
    const current = value.roles[group];
    const next = on ? [...current, option] : current.filter((o) => o !== option);
    onChange({ ...value, nothingForNow: false, roles: { ...value.roles, [group]: next } });
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Volunteering</h2>
        <p className="text-xs text-muted-foreground">
          Tick anything you'd help with. Officers, coaches and captains see this when they need a hand. You can change it any time.
        </p>
      </div>

      {VOLUNTEER_GROUPS.map((g) => (
        <fieldset key={g.key}>
          <legend className="text-sm font-medium text-foreground mb-0.5">{g.label}</legend>
          <div className="grid sm:grid-cols-2 gap-x-4">
            {g.options.map((o) => (
              <Check key={o} label={o} checked={value.roles[g.key].includes(o)} onChange={(on) => toggle(g.key, o, on)} />
            ))}
          </div>
        </fieldset>
      ))}

      <div className="border-t border-border pt-2">
        <Check
          label="Nothing for now"
          checked={value.nothingForNow}
          onChange={(on) => onChange({ ...value, nothingForNow: on, roles: on ? { ...EMPTY_ROLES } : value.roles })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
        <label className="text-xs text-muted-foreground">
          Coaching qualification
          <select className={select} value={value.qualifiedCoach ?? ''} onChange={(e) => onChange({ ...value, qualifiedCoach: e.target.value || null })}>
            <option value="">None</option>
            {COACH_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          Umpiring qualification
          <select className={select} value={value.qualifiedUmpire ?? ''} onChange={(e) => onChange({ ...value, qualifiedUmpire: e.target.value || null })}>
            <option value="">None</option>
            {UMPIRE_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
