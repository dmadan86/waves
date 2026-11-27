/** Words for renewals and due-soon lines: generic name, plus the regional hint when the country has one. */
import type { RenewalKind } from '@waves/core';

import type { VehicleStrings } from '@/i18n/vehicles';
import { fill } from '@/i18n';
import type { Region } from '@/lib/wealthPlan';
import { renewalHint, type DueItem } from '@/lib/vehiclePlan';

export function kindName(
  v: VehicleStrings,
  kind: RenewalKind | 'licence',
  region: Region,
  label?: string | null,
): string {
  if (kind === 'licence') return v.licence;
  if (label) return label;
  const hint = renewalHint(kind, region);
  return hint ?? v.renewalKinds[kind];
}

export function dueText(v: VehicleStrings, d: DueItem, region: Region): string {
  const kind = kindName(v, d.kind, region, d.label);
  if (d.inDays === 0) return fill(v.dueToday, { kind });
  return d.inDays > 0
    ? fill(v.dueIn, { kind, n: d.inDays })
    : fill(v.overdueBy, { kind, n: -d.inDays });
}
