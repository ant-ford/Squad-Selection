import { COUNTRY_CODES, joinPhone, splitPhone } from '@shared/phone';

const box = 'h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary';

/**
 * A phone number as a country code (Hong Kong first) and the number. Reports
 * it as stored, "+852 9123 4567"; while the number is part-typed it reports
 * the code and digits so far, which the form's check then flags.
 */
export default function PhoneInput({ id, value, onChange }: { id?: string; value: string | null; onChange: (v: string) => void }) {
  const { code, number } = splitPhone(value);
  const known = COUNTRY_CODES.some((c) => c.code === code);
  const report = (c: string, n: string) => onChange(n.replace(/\D/g, '') ? joinPhone(c, n) || `${c} ${n}` : '');
  return (
    <div className="flex gap-1.5">
      <select aria-label="Country code" className={`${box} w-[6.5rem] shrink-0`} value={code} onChange={(e) => report(e.target.value, number)}>
        {!known && <option value={code}>{code}</option>}
        {COUNTRY_CODES.map((c) => (
          <option key={c.code + c.name} value={c.code}>
            {c.code} {c.name}
          </option>
        ))}
      </select>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        className={`${box} w-full min-w-0`}
        placeholder={code === '+852' ? '9123 4567' : 'Number'}
        value={number}
        onChange={(e) => report(code, e.target.value)}
      />
    </div>
  );
}
