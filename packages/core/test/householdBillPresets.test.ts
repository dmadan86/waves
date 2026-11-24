import { describe, expect, it } from 'vitest';

import { billPresetLabelKey, normaliseBillPresetId } from '../src/group/household';

describe('household bill presets', () => {
  it('reads old preset IDs as their neutral saved IDs', () => {
    expect(normaliseBillPresetId('emi')).toBe('home_loan');
    expect(normaliseBillPresetId('maid')).toBe('household_help');
    expect(normaliseBillPresetId('cook')).toBe('household_help');
    expect(normaliseBillPresetId('driver')).toBe('household_help');
    expect(normaliseBillPresetId('sip')).toBe('investment_contribution');
    expect(normaliseBillPresetId('ott')).toBe('streaming');
    expect(normaliseBillPresetId('petrol')).toBe('fuel');
    expect(normaliseBillPresetId('milk')).toBe('milk');
    expect(normaliseBillPresetId('unknown')).toBeNull();
  });

  it('selects regional display hints while keeping neutral defaults', () => {
    expect(billPresetLabelKey('home_loan', 'IN')).toBe('emi');
    expect(billPresetLabelKey('household_help', 'IN')).toBe('maid_cook_driver');
    expect(billPresetLabelKey('streaming', 'IN')).toBe('ott');
    expect(billPresetLabelKey('fuel', 'IN')).toBe('petrol');
    expect(billPresetLabelKey('building_fees', 'IN')).toBe('society_maintenance');
    expect(billPresetLabelKey('building_fees', 'US')).toBe('hoa');
    expect(billPresetLabelKey('fuel', 'US')).toBe('fuel_gas');
    expect(billPresetLabelKey('childcare_school', 'GB')).toBe('council_tax');
    expect(billPresetLabelKey('building_fees', 'GB')).toBe('service_charge');
    expect(billPresetLabelKey('building_fees', 'AU')).toBe('strata');
    expect(billPresetLabelKey('childcare_school', 'AU')).toBe('rates');
    expect(billPresetLabelKey('electricity', 'AE')).toBe('dewa');
    expect(billPresetLabelKey('water', 'AE')).toBe('chiller');
    expect(billPresetLabelKey('home_loan', 'CA')).toBe('home_loan');
  });
});
