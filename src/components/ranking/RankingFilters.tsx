import { ChipRow, FilterPanel } from '@/components/PlayerFilters';
import { POS_SHORT, shortTeam } from '@/lib/format';

const POSITIONS = Object.keys(POS_SHORT).map((key) => ({ key, label: POS_SHORT[key] }));

export interface RankingFilterState {
  search: string;
  teams: Set<string>;
  positions: Set<string>;
  showTrial: boolean;
  showSponsoring: boolean;
}

export const EMPTY_RANKING_FILTERS: RankingFilterState = {
  search: '',
  teams: new Set(),
  positions: new Set(),
  showTrial: true,
  showSponsoring: true,
};

function toggle(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** The squad screen's filter panel (search, chip rows, a sheet on phones) with the ranking's rows. */
export function RankingFilters({ filters, onChange, teamOptions }: {
  filters: RankingFilterState;
  onChange: (f: RankingFilterState) => void;
  teamOptions: string[];
}) {
  const applicantsHidden = !filters.showTrial || !filters.showSponsoring;
  const activeCount =
    filters.teams.size + filters.positions.size + (filters.search ? 1 : 0) + (applicantsHidden ? 1 : 0);
  const applicantKeys = new Set([...(filters.showTrial ? ['trial'] : []), ...(filters.showSponsoring ? ['sponsoring'] : [])]);

  return (
    <FilterPanel
      name={filters.search}
      onName={(search) => onChange({ ...filters, search })}
      activeCount={activeCount}
      onClear={() => onChange(EMPTY_RANKING_FILTERS)}
    >
      <ChipRow
        label="Team"
        options={teamOptions.map((t) => ({ key: t, label: shortTeam(t) }))}
        selected={filters.teams}
        onToggle={(t) => onChange({ ...filters, teams: toggle(filters.teams, t) })}
      />
      <ChipRow
        label="Position"
        options={POSITIONS}
        selected={filters.positions}
        onToggle={(p) => onChange({ ...filters, positions: toggle(filters.positions, p) })}
      />
      <ChipRow
        label="Applicants"
        options={[{ key: 'trial', label: 'Trial' }, { key: 'sponsoring', label: 'Sponsoring' }]}
        selected={applicantKeys}
        onToggle={(k) =>
          onChange(k === 'trial' ? { ...filters, showTrial: !filters.showTrial } : { ...filters, showSponsoring: !filters.showSponsoring })
        }
      />
    </FilterPanel>
  );
}
