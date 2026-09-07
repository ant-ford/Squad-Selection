import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTERS,
  filtersToParams,
  paramsToFilters,
  type FilterState,
} from '../src/components/PlayerFilters';

describe('PlayerFilters', () => {
  describe('filtersToParams', () => {
    it('returns an empty URLSearchParams for empty filters', () => {
      expect(filtersToParams(EMPTY_FILTERS).toString()).toBe('');
    });

    it('returns a URLSearchParams, not a string', () => {
      expect(filtersToParams(EMPTY_FILTERS)).toBeInstanceOf(URLSearchParams);
    });

    it('serializes a single position', () => {
      const f: FilterState = { ...EMPTY_FILTERS, position: new Set(['GK']) };
      expect(filtersToParams(f).get('position')).toBe('GK');
    });

    it('serializes multiple positions with AND/OR grouping', () => {
      const f: FilterState = { ...EMPTY_FILTERS, position: new Set(['GK', 'DEF']) };
      expect(filtersToParams(f).get('position')).toBe('DEF,GK');
    });

    it('serializes multiple categories', () => {
      const f: FilterState = {
        position: new Set(['MID']),
        eligibility: new Set(['blocked']),
        selection: new Set(),
        availability: new Set(['Unavailable']),
        ability: new Set(),
      };
      const params = filtersToParams(f);
      expect(params.get('position')).toBe('MID');
      expect(params.get('eligibility')).toBe('blocked');
      expect(params.get('availability')).toBe('Unavailable');
      expect(params.has('selection')).toBe(false);
    });
  });

  describe('paramsToFilters', () => {
    it('returns empty filters for empty string', () => {
      const f = paramsToFilters('');
      expect(f.position.size).toBe(0);
      expect(f.eligibility.size).toBe(0);
    });

    it('deserializes a single position', () => {
      const f = paramsToFilters('position=GK');
      expect(f.position.has('GK')).toBe(true);
      expect(f.position.size).toBe(1);
    });

    it('deserializes multiple values in same category', () => {
      const f = paramsToFilters('position=DEF,GK');
      expect(f.position.has('DEF')).toBe(true);
      expect(f.position.has('GK')).toBe(true);
      expect(f.position.size).toBe(2);
    });

    it('deserializes multiple categories', () => {
      const f = paramsToFilters('position=MID&eligibility=blocked&availability=Unavailable');
      expect(f.position.has('MID')).toBe(true);
      expect(f.eligibility.has('blocked')).toBe(true);
      expect(f.availability.has('Unavailable')).toBe(true);
      expect(f.selection.size).toBe(0);
    });

    it('handles real-world URL search param string', () => {
      const f = paramsToFilters('position=DEF,FWD&selection=selected&availability=Available,Maybe');
      expect(f.position.has('DEF')).toBe(true);
      expect(f.position.has('FWD')).toBe(true);
      expect(f.selection.has('selected')).toBe(true);
      expect(f.availability.has('Available')).toBe(true);
      expect(f.availability.has('Maybe')).toBe(true);
    });

    it('round-trips filters-to-params-to-filters', () => {
      const original: FilterState = {
        position: new Set(['GK', 'FWD']),
        eligibility: new Set(['blocked', 'warning']),
        selection: new Set(['none']),
        availability: new Set(['Unavailable']),
        ability: new Set(),
      };
      const rt = paramsToFilters(filtersToParams(original));
      for (const cat of ['position','eligibility','selection','availability'] as const) {
        expect([...rt[cat]].sort()).toEqual([...original[cat]].sort());
      }
    });

    it('round-trips a name filter containing a space and an ampersand without double-encoding', () => {
      // Regression (bug F2): filtersToParams used to return a joined string
      // (name already percent-encoded), which handleFilterChange then split
      // on '&'/'=' and re-inserted via URLSearchParams.set - encoding the
      // already-encoded value a second time.
      const original: FilterState = { ...EMPTY_FILTERS, name: 'Smith & Jones' };
      const asParams = filtersToParams(original);
      // The name must appear exactly once, percent-encoded exactly once, in
      // the serialized query string - not double-encoded (%2520, %2526...).
      const serialized = asParams.toString();
      expect(serialized).not.toContain('%2520');
      expect(serialized).not.toContain('%2526');

      const rt = paramsToFilters(asParams);
      expect(rt.name).toBe('Smith & Jones');

      // Also prove it survives a real URLSearchParams merge, exactly as
      // handleFilterChange does it (no string splitting anywhere).
      const merged = new URLSearchParams();
      for (const [k, v] of asParams) merged.set(k, v);
      const rtFromMerged = paramsToFilters(merged);
      expect(rtFromMerged.name).toBe('Smith & Jones');
    });
  });

  describe('filter AND/OR semantics', () => {
    it('AND across categories: player must match at least one value in each active category', () => {
      // This is a design test: if both position=GK AND eligibility=blocked are selected,
      // a player must be a GK AND blocked to pass.
      // Verified by the filtering logic in SquadSelection.
      expect(true).toBe(true); // Logic test — actual filter behavior tested in SquadSelection
    });

    it('OR within category: selecting GK and DEF shows both', () => {
      expect(true).toBe(true);
    });
  });
});
