import { useState, type ReactNode } from 'react';
import PhoneInput from '@/components/profile/PhoneInput';
import { normaliseHkid } from '@shared/phone';
import { isRequired, regionOfDistrict, type Audience, type FieldSpec, type ProfileValues } from '@shared/profile';

export const fieldInput =
  'w-full h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary';

type Value = string | string[] | boolean | null;

const OTHER = '__other__';

/**
 * A list with "Other (type it)" at the end, for answers the list may not have
 * (a district, a nationality). A plain menu rather than a type-ahead: phones
 * showed the type-ahead's suggestions off the side of the screen.
 */
/**
 * An HKID number: shown and tidied the standard way, A123456(7), when it's
 * a valid one (including one saved before the check existed); a number that
 * fails the check digit says so as soon as they leave the box.
 */
export function HkidInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  // Starts as left, so a saved number that fails the check says so at once.
  const [left, setLeft] = useState(true);
  const shown = normaliseHkid(value) ?? value;
  const bad = left && !!value.trim() && !normaliseHkid(value);
  return (
    <>
      <input
        id={id}
        className={`${fieldInput} uppercase ${bad ? 'border-destructive' : ''}`}
        autoCapitalize="characters"
        autoComplete="off"
        placeholder="A123456(7)"
        aria-invalid={bad}
        value={left ? shown : value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        onFocus={() => setLeft(false)}
        onBlur={() => {
          setLeft(true);
          const tidy = normaliseHkid(value);
          if (tidy && tidy !== value) onChange(tidy);
        }}
      />
      {bad && <p className="text-[11px] text-destructive">Check the number and the digit in brackets, e.g. A123456(7).</p>}
    </>
  );
}

export function ChoiceOrOther({ f, id, value, required, onChange }: { f: FieldSpec; id: string; value: string; required: boolean; onChange: (v: string | null) => void }) {
  const listed = !value || f.options!.includes(value);
  const [typing, setTyping] = useState(!listed);
  const option = (o: string) => (
    <option key={o} value={o}>
      {o}
    </option>
  );
  return (
    <div className="space-y-1.5">
      <select
        id={id}
        className={fieldInput}
        value={typing ? OTHER : value}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setTyping(true);
            onChange(listed ? null : value);
          } else {
            setTyping(false);
            onChange(e.target.value || null);
          }
        }}
      >
        <option value="">{required ? 'Choose…' : 'None'}</option>
        {f.groups
          ? f.groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map(option)}
              </optgroup>
            ))
          : f.options!.map(option)}
        <option value={OTHER}>Other (type it)</option>
      </select>
      {typing && (
        <input className={fieldInput} aria-label={`${f.label} (other)`} placeholder={`Type the ${f.label.toLowerCase()}`} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function Field({ f, value, onChange, who }: { f: FieldSpec; value: Value; onChange: (v: Value) => void; who: Audience }) {
  const id = `f-${f.key}`;
  const required = isRequired(f, who);
  const label = (
    <label htmlFor={id} className="text-xs font-medium text-foreground">
      {f.label}
      {required && <span className="text-destructive"> *</span>}
    </label>
  );
  const hint = f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>;
  const str = typeof value === 'string' ? value : '';

  if (f.type === 'yesno') {
    return (
      <fieldset className="space-y-1 sm:col-span-2">
        <legend className="text-xs font-medium text-foreground">
          {f.label}
          {required && <span className="text-destructive"> *</span>}
        </legend>
        <div className="flex gap-2" role="radiogroup">
          {[true, false].map((b) => (
            <button
              key={String(b)}
              type="button"
              role="radio"
              aria-checked={value === b}
              onClick={() => onChange(b)}
              className={`text-sm px-4 py-1.5 rounded-md border ${value === b ? 'border-primary bg-primary/10 font-medium' : 'border-border bg-background hover:bg-muted'}`}
            >
              {b ? 'Yes' : 'No'}
            </button>
          ))}
        </div>
        {hint}
      </fieldset>
    );
  }
  if (f.type === 'multi') {
    const list = Array.isArray(value) ? value : [];
    return (
      <fieldset className="sm:col-span-2">
        <legend className="text-xs font-medium text-foreground">
          {f.label}
          {required && <span className="text-destructive"> *</span>}
        </legend>
        <div className="grid sm:grid-cols-2 gap-x-4">
          {f.options!.map((o) => (
            <label key={o} className="flex gap-2 items-start py-1 text-sm text-foreground">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                checked={list.includes(o)}
                onChange={(e) => onChange(e.target.checked ? [...list, o] : list.filter((x) => x !== o))}
              />
              {o}
            </label>
          ))}
        </div>
        {hint}
      </fieldset>
    );
  }
  if (f.type === 'select') {
    return (
      <div className="space-y-1">
        {label}
        <select id={id} className={fieldInput} value={str} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">{required ? 'Choose…' : 'None'}</option>
          {/* An older answer not on today's list still shows. */}
          {[...(str && !f.options!.includes(str) ? [str] : []), ...f.options!].map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {hint}
      </div>
    );
  }
  if (f.type === 'suggest') {
    return (
      <div className="space-y-1">
        {label}
        <ChoiceOrOther f={f} id={id} value={str} required={required} onChange={onChange} />
        {hint}
      </div>
    );
  }
  if (f.type === 'phone') {
    return (
      <div className="space-y-1">
        {label}
        <PhoneInput id={id} value={str} onChange={onChange} />
        {hint}
      </div>
    );
  }
  if (f.type === 'hkid') {
    return (
      <div className="space-y-1">
        {label}
        <HkidInput id={id} value={str} onChange={onChange} />
        {hint}
      </div>
    );
  }
  if (f.type === 'textarea') {
    return (
      <div className="space-y-1 sm:col-span-2">
        {label}
        <textarea id={id} rows={3} className={`${fieldInput} h-auto py-1.5`} value={str} onChange={(e) => onChange(e.target.value)} />
        {hint}
      </div>
    );
  }
  const digits = f.type === 'branch' || f.type === 'account';
  const type = f.type === 'number' ? 'number' : digits ? 'text' : f.type;
  return (
    <div className="space-y-1">
      {label}
      <input
        id={id}
        type={type}
        inputMode={f.type === 'number' ? 'decimal' : digits ? 'numeric' : undefined}
        maxLength={f.type === 'branch' ? 3 : undefined}
        autoComplete={digits ? 'off' : undefined}
        className={fieldInput}
        value={str}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint}
    </div>
  );
}

/** A section's questions, drawn from shared/profile.ts. Controlled. */
export default function ProfileFields({
  fields,
  values,
  onChange,
  who = 'member',
  extra,
}: {
  fields: FieldSpec[];
  values: ProfileValues;
  onChange: (next: ProfileValues) => void;
  /** Who is answering: decides which questions are required. */
  who?: Audience;
  /** Something to show under a field (the Polish button). */
  extra?: (f: FieldSpec) => ReactNode;
}) {
  const change = (f: FieldSpec, v: Value) => {
    const next = { ...values, [f.key]: v };
    // A district fills in its region (an address's two last parts).
    const region = f.key.endsWith('District') && typeof v === 'string' ? regionOfDistrict(v) : null;
    if (region) next[f.key.replace(/District$/, 'Region')] = region;
    onChange(next);
  };
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {fields.map((f) => (
        <div key={f.key} className={f.type === 'textarea' || f.type === 'multi' || f.type === 'yesno' ? 'sm:col-span-2' : undefined}>
          <Field f={f} who={who} value={values[f.key] ?? null} onChange={(v) => change(f, v)} />
          {extra?.(f)}
        </div>
      ))}
    </div>
  );
}
