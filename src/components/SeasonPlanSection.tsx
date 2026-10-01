import type { ReactNode } from 'react';
import {
  AVAILABILITY_HALVES,
  AVAILABILITY_LEVELS,
  CAPTAINCY_OPTIONS,
  PLAYING_PREFERENCES,
  SEASON_PLAN_QUESTIONS,
  type SeasonPlanAnswers,
} from '@shared/seasonPlan';

function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`text-left text-sm px-3 py-2 rounded-md border ${
        selected ? 'border-primary bg-primary/10 text-foreground font-medium' : 'border-border bg-background text-foreground hover:bg-muted'
      }`}
    >
      {children}
    </button>
  );
}

function Question({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium text-foreground">{label}</legend>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div role="radiogroup" aria-label={label} className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
        {children}
      </div>
    </fieldset>
  );
}

/**
 * The season plan questions, for the member details update and the new
 * joiner form: how much of the season they can play (and whether only one
 * half), their playing preference and captaincy interest. It helps allocate
 * players to teams. Controlled: the form holds the answers and saves them
 * with submitSeasonPlan.
 */
export default function SeasonPlanSection({
  season,
  value,
  onChange,
}: {
  season: string;
  value: SeasonPlanAnswers;
  onChange: (next: SeasonPlanAnswers) => void;
}) {
  const set = (patch: Partial<SeasonPlanAnswers>) => onChange({ ...value, ...patch });
  const playing = value.availabilityLevel !== 'none';

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Season plan {season.replace('-', '–')}</h2>
        <p className="text-xs text-muted-foreground">This helps the Section Captain put players in the right teams.</p>
      </div>

      <Question label={SEASON_PLAN_QUESTIONS.availabilityLevel}>
        {AVAILABILITY_LEVELS.map((l) => (
          <Choice
            key={l.key}
            selected={value.availabilityLevel === l.key}
            onClick={() => set({ availabilityLevel: l.key, ...(l.key === 'none' ? { availabilityHalf: null, playingPreference: null } : {}) })}
          >
            {l.label}
          </Choice>
        ))}
      </Question>

      {value.availabilityLevel && playing && (
        <Question label={SEASON_PLAN_QUESTIONS.availabilityHalf}>
          <Choice selected={!value.availabilityHalf} onClick={() => set({ availabilityHalf: null })}>
            The whole season
          </Choice>
          {AVAILABILITY_HALVES.map((h) => (
            <Choice key={h.key} selected={value.availabilityHalf === h.key} onClick={() => set({ availabilityHalf: h.key })}>
              {h.label}
            </Choice>
          ))}
        </Question>
      )}

      {playing && (
        <Question label={SEASON_PLAN_QUESTIONS.playingPreference}>
          {PLAYING_PREFERENCES.map((p) => (
            <Choice key={p.value} selected={value.playingPreference === p.value} onClick={() => set({ playingPreference: p.value })}>
              {p.label}
            </Choice>
          ))}
        </Question>
      )}

      <Question label={SEASON_PLAN_QUESTIONS.captaincyInterest}>
        {CAPTAINCY_OPTIONS.map((c) => (
          <Choice key={c} selected={value.captaincyInterest === c} onClick={() => set({ captaincyInterest: c })}>
            {c}
          </Choice>
        ))}
      </Question>
    </section>
  );
}
