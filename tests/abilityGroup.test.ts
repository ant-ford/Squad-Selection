import { describe, it, expect } from 'vitest';
import { computeAbilityAssignment, emptyConfig, validateConfig } from '../shared/abilityGroup';
import type { AbilityGroupConfigMap } from '../shared/schema/domainTypes';

describe('abilityGroup — computeAbilityAssignment', () => {
  const config: AbilityGroupConfigMap = { A: 5, B: 8, C: 12, D: 15, E: 15, F: 15, G: 10 };

  it('assigns rank 1 to group A', () => {
    const result = computeAbilityAssignment(1, 80, config);
    expect(result.abilityGroup).toBe('A');
    expect(result.abilityDisplay).toMatch(/^A/);
  });

  it('assigns last rank of group A correctly', () => {
    const result = computeAbilityAssignment(5, 80, config);
    expect(result.abilityGroup).toBe('A');
  });

  it('assigns first rank of group B correctly', () => {
    const result = computeAbilityAssignment(6, 80, config);
    expect(result.abilityGroup).toBe('B');
  });

  it('assigns sub-group "+" to top third, neutral to middle, "-" to bottom', () => {
    const a1 = computeAbilityAssignment(1, 80, config);
    const a2 = computeAbilityAssignment(2, 80, config);
    const a3 = computeAbilityAssignment(3, 80, config);
    const a4 = computeAbilityAssignment(4, 80, config);
    const a5 = computeAbilityAssignment(5, 80, config);
    expect(a1.abilitySubGroup).toBe('plus');
    expect(a2.abilitySubGroup).toBe('plus');
    expect(a3.abilitySubGroup).toBe('neutral');
    expect(a4.abilitySubGroup).toBe('neutral');
    expect(a5.abilitySubGroup).toBe('minus');
  });

  it('residual players fall into group H', () => {
    const cfg: AbilityGroupConfigMap = { A: 3, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
    const result = computeAbilityAssignment(5, 10, cfg);
    expect(result.abilityGroup).toBe('H');
  });

  it('group H display uses "-" suffix for bottom sub-group', () => {
    const cfg: AbilityGroupConfigMap = { A: 3, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
    const result = computeAbilityAssignment(9, 10, cfg);
    expect(result.abilityDisplay).toBe('H-');
  });

  it('group H display uses "+" suffix for top sub-group', () => {
    const cfg: AbilityGroupConfigMap = { A: 3, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
    const result = computeAbilityAssignment(4, 10, cfg);
    expect(result.abilityDisplay).toBe('H+');
  });

  it('handles config with all zero groups (all residual H)', () => {
    const empty = emptyConfig();
    const result = computeAbilityAssignment(1, 20, empty);
    expect(result.abilityGroup).toBe('H');
  });

  it('handles out-of-range rank gracefully', () => {
    const result = computeAbilityAssignment(999, 80, config);
    expect(result.abilityGroup).toBe('H');
  });

  it('sub-group algorithm: r=0 case (divisible by 3)', () => {
    const cfg: AbilityGroupConfigMap = { A: 3, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
    const a1 = computeAbilityAssignment(1, 3, cfg);
    const a2 = computeAbilityAssignment(2, 3, cfg);
    const a3 = computeAbilityAssignment(3, 3, cfg);
    expect(a1.abilitySubGroup).toBe('plus');
    expect(a2.abilitySubGroup).toBe('neutral');
    expect(a3.abilitySubGroup).toBe('minus');
  });

  it('sub-group algorithm: r=2 case', () => {
    const cfg: AbilityGroupConfigMap = { A: 5, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
    const a1 = computeAbilityAssignment(1, 5, cfg);
    const a2 = computeAbilityAssignment(2, 5, cfg);
    const a3 = computeAbilityAssignment(3, 5, cfg);
    const a4 = computeAbilityAssignment(4, 5, cfg);
    const a5 = computeAbilityAssignment(5, 5, cfg);
    expect(a1.abilitySubGroup).toBe('plus');
    expect(a2.abilitySubGroup).toBe('plus');
    expect(a3.abilitySubGroup).toBe('neutral');
    expect(a4.abilitySubGroup).toBe('neutral');
    expect(a5.abilitySubGroup).toBe('minus');
  });

  it('single-player group gets neutral (no suffix)', () => {
    const cfg: AbilityGroupConfigMap = { A: 1, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
    const result = computeAbilityAssignment(1, 2, cfg);
    expect(result.abilityDisplay).toBe('A');
  });

  it('display reflects neutral sub-group with no suffix', () => {
    const cfg: AbilityGroupConfigMap = { A: 2, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
    const r1 = computeAbilityAssignment(1, 2, cfg);
    const r2 = computeAbilityAssignment(2, 2, cfg);
    expect(r1.abilityDisplay).toBe('A+');
    expect(r2.abilityDisplay).toBe('A');
  });
});

describe('abilityGroup — emptyConfig', () => {
  it('returns all zeros', () => {
    const cfg = emptyConfig();
    expect(cfg.A).toBe(0);
    expect(cfg.B).toBe(0);
    expect(cfg.C).toBe(0);
    expect(cfg.D).toBe(0);
    expect(cfg.E).toBe(0);
    expect(cfg.F).toBe(0);
    expect(cfg.G).toBe(0);
  });
});

describe('abilityGroup — validateConfig', () => {
  it('accepts valid config within active count', () => {
    const cfg: AbilityGroupConfigMap = { A: 10, B: 10, C: 0, D: 0, E: 0, F: 0, G: 0 };
    expect(validateConfig(cfg, 25)).toBeNull();
    expect(validateConfig(cfg, 20)).toBeNull();
  });

  it('rejects config exceeding active count', () => {
    const cfg: AbilityGroupConfigMap = { A: 15, B: 10, C: 0, D: 0, E: 0, F: 0, G: 0 };
    const err = validateConfig(cfg, 20);
    expect(err).not.toBeNull();
    expect(err).toContain('exceeds');
  });

  it('rejects negative capacity', () => {
    const cfg: AbilityGroupConfigMap = { A: -1, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
    const err = validateConfig(cfg, 10);
    expect(err).not.toBeNull();
    expect(err).toContain('non-negative');
  });

  it('rejects non-integer capacity', () => {
    const cfg: AbilityGroupConfigMap = { A: 3.5, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
    const err = validateConfig(cfg, 10);
    expect(err).not.toBeNull();
    expect(err).toContain('non-negative integer');
  });
});