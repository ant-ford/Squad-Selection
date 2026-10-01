import { useState } from 'react';
import { KIT_SIZE_CHARTS, KIT_SIZE_OPTIONS, type KitSizes } from '@shared/kit';
import type { DetailsKit } from '@shared/profile';
import { fieldInput } from './ProfileFields';

function SizeSelect({ label, value, options, onChange, disabled }: { label: string; value: string | null; options: string[]; onChange: (v: string | null) => void; disabled?: boolean }) {
  return (
    <label className="space-y-1 text-xs font-medium text-foreground">
      {label}
      <select className={fieldInput} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Choose…</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Kit sizes for the current supplier, with its size chart. A shirt already
 * printed with their number keeps its size (it can't be changed).
 */
export default function KitSizesSection({ kit, value, onChange }: { kit: DetailsKit; value: KitSizes; onChange: (next: KitSizes) => void }) {
  const [showChart, setShowChart] = useState(false);
  const charts = (KIT_SIZE_CHARTS[kit.supplier] ?? []).filter((c) => kit.goalkeeper || !/goalkeeper/i.test(c.garment));
  const set = (k: keyof KitSizes) => (v: string | null) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Sizes for {kit.supplier} kit, used for the next kit order.</p>
      <div className="grid grid-cols-3 gap-3">
        <SizeSelect label="Shirt" value={value.shirt} options={KIT_SIZE_OPTIONS.shirt} onChange={set('shirt')} disabled={!!kit.printedShirt?.size} />
        <SizeSelect label="Shorts" value={value.shorts} options={KIT_SIZE_OPTIONS.shorts} onChange={set('shorts')} />
        <SizeSelect label="Socks" value={value.socks} options={KIT_SIZE_OPTIONS.socks} onChange={set('socks')} />
      </div>
      {kit.printedShirt?.size && (
        <p className="text-[11px] text-muted-foreground">
          Your #{kit.printedShirt.shirtNo} shirt is printed in {kit.printedShirt.size}, so its size can't change.
        </p>
      )}
      {kit.goalkeeper && (
        <div className="grid grid-cols-2 gap-3">
          <SizeSelect label="Goalkeeper smock" value={value.goalieSmock} options={KIT_SIZE_OPTIONS.goalieSmock} onChange={set('goalieSmock')} />
          <SizeSelect label="Smock style" value={value.goalieSmockStyle} options={KIT_SIZE_OPTIONS.goalieSmockStyle} onChange={set('goalieSmockStyle')} />
        </div>
      )}
      {charts.length > 0 && (
        <div>
          <button type="button" className="text-xs text-primary underline" onClick={() => setShowChart((v) => !v)}>
            {showChart ? 'Hide the size chart' : `${kit.supplier} size chart`}
          </button>
          {showChart &&
            charts.map((c) => (
              <table key={c.garment} className="mt-2 w-full text-xs border border-border">
                <caption className="text-left text-xs font-medium text-foreground py-1">{c.garment} (inches)</caption>
                <thead>
                  <tr className="bg-muted">
                    <th className="text-left px-2 py-1">Size</th>
                    {c.columns.map((h) => (
                      <th key={h} className="text-left px-2 py-1">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {c.rows.map(([size, ...cells]) => (
                    <tr key={size} className="border-t border-border">
                      <td className="px-2 py-1 font-medium">{size}</td>
                      {cells.map((n, i) => (
                        <td key={i} className="px-2 py-1">
                          {n}″
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
        </div>
      )}
    </div>
  );
}
