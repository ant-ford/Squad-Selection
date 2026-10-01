import { isRequired, type Audience, type FieldSpec, type ProfileValues } from '@shared/profile';

export const fieldInput =
  'w-full h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary';

type Value = string | string[] | boolean | null;

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
  if (f.type === 'textarea') {
    return (
      <div className="space-y-1 sm:col-span-2">
        {label}
        <textarea id={id} rows={3} className={`${fieldInput} h-auto py-1.5`} value={str} onChange={(e) => onChange(e.target.value)} />
        {hint}
      </div>
    );
  }
  const type = f.type === 'phone' ? 'tel' : f.type === 'suggest' ? 'text' : f.type === 'number' ? 'number' : f.type;
  return (
    <div className="space-y-1">
      {label}
      <input
        id={id}
        type={type}
        inputMode={f.type === 'phone' ? 'tel' : f.type === 'number' ? 'decimal' : undefined}
        list={f.type === 'suggest' ? `${id}-list` : undefined}
        className={fieldInput}
        value={str}
        onChange={(e) => onChange(e.target.value)}
      />
      {f.type === 'suggest' && (
        <datalist id={`${id}-list`}>
          {f.options!.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
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
}: {
  fields: FieldSpec[];
  values: ProfileValues;
  onChange: (next: ProfileValues) => void;
  /** Who is answering: decides which questions are required. */
  who?: Audience;
}) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {fields.map((f) => (
        <Field key={f.key} f={f} who={who} value={values[f.key] ?? null} onChange={(v) => onChange({ ...values, [f.key]: v })} />
      ))}
    </div>
  );
}
