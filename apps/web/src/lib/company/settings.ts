/**
 * Company settings: payload builders, 1:1 with the phone's hooks, and the list
 * edits (departments, tags) as pure functions so they can be tested.
 */

import {
  BUILTIN_COMPANY_TAGS,
  COMPANY_TAG_KEY_RE,
  packTags,
  type CompanyIndustry,
  type CompanyPolicies,
  type CompanyPolicyRule,
  type CompanyTag,
} from '@waves/core';

export const MAX_COMPANY_TAGS = 50;
export const MAX_DEPARTMENTS = 30;

// company.settings_set always carries both fields: the unchanged one is read off the group row.
export function settingsPayload(
  group: { company_default_daily_rate_minor?: string | null; company_approvals_enabled?: boolean },
  input: { defaultDailyRateMinor?: string | null; approvalsEnabled?: boolean },
) {
  return {
    defaultDailyRateMinor:
      input.defaultDailyRateMinor !== undefined
        ? input.defaultDailyRateMinor
        : (group.company_default_daily_rate_minor ?? null),
    approvalsEnabled: input.approvalsEnabled ?? group.company_approvals_enabled === true,
  };
}

export const mileagePayload = (rateMinor: string | null) => ({ memberId: null, rateMinor });
export const secondApprovalPayload = (enabled: boolean, thresholdMinor: string | null) => ({
  enabled,
  thresholdMinor,
});
export const policiesPayload = (rules: readonly CompanyPolicyRule[], expectedRevision: number) => ({
  policies: { version: 1, rules } as CompanyPolicies,
  expectedRevision,
});
export const projectPayload = (p: {
  projectId: string;
  name: string;
  budgetMinor: string | null;
  archived: boolean;
}) => p;
export const calendarSettingsPayload = (paidHolidays: boolean, paidLeave: boolean) => ({
  paidHolidays,
  paidLeave,
});

// ── departments ──────────────────────────────────────────────────────────────

export interface CompanyDepartment {
  readonly id: string;
  readonly name: string;
}

export function parseDepartments(raw: unknown): CompanyDepartment[] {
  return Array.isArray(raw)
    ? raw.flatMap((d) =>
        d && typeof d.id === 'string' && typeof d.name === 'string'
          ? [{ id: d.id, name: d.name }]
          : [],
      )
    : [];
}

const cleanName = (name: string): string => name.trim().slice(0, 40);
const nameTaken = (list: readonly CompanyDepartment[], name: string, exceptId?: string): boolean =>
  list.some((d) => d.id !== exceptId && d.name.toLowerCase() === name.toLowerCase());

/** The next list, or null when the name is blank, a duplicate or the list is full. */
export function addDepartment(
  list: readonly CompanyDepartment[],
  name: string,
  id: string,
): CompanyDepartment[] | null {
  const n = cleanName(name);
  if (!n || nameTaken(list, n) || list.length >= MAX_DEPARTMENTS) return null;
  return [...list, { id, name: n }];
}

export function renameDepartment(
  list: readonly CompanyDepartment[],
  id: string,
  name: string,
): CompanyDepartment[] | null {
  const n = cleanName(name);
  if (!n || nameTaken(list, n, id)) return null;
  return list.map((d) => (d.id === id ? { id, name: n } : d));
}

export const removeDepartment = (list: readonly CompanyDepartment[], id: string) =>
  list.filter((d) => d.id !== id);

// ── tags ─────────────────────────────────────────────────────────────────────

export function parseCompanyTags(value: unknown): CompanyTag[] {
  if (!Array.isArray(value)) return [];
  const out: CompanyTag[] = [];
  for (const item of value as Record<string, unknown>[]) {
    if (!item || typeof item.key !== 'string' || typeof item.label !== 'string') continue;
    if (!COMPANY_TAG_KEY_RE.test(item.key)) continue;
    out.push({
      key: item.key,
      label: item.label,
      ...(typeof item.unit === 'string' ? { unit: item.unit } : {}),
      ...(item.hidden === true ? { hidden: true } : {}),
      ...(typeof item.addedBy === 'string' ? { addedBy: item.addedBy } : {}),
    });
  }
  return out;
}

export const tagsPayload = (tags: readonly CompanyTag[], industry: CompanyIndustry | null) => ({
  tags,
  industry,
});

/** Rename one tag; blank text changes nothing. */
export function renameTag(tags: readonly CompanyTag[], key: string, label: string): CompanyTag[] {
  const clean = label.trim().slice(0, 40);
  return clean ? tags.map((t) => (t.key === key ? { ...t, label: clean } : t)) : [...tags];
}

export const toggleTagHidden = (tags: readonly CompanyTag[], key: string): CompanyTag[] =>
  tags.map((t) => {
    if (t.key !== key) return t;
    const { hidden, ...rest } = t;
    return hidden ? rest : { ...rest, hidden: true };
  });

/**
 * Adds an industry pack's tags (idempotent on key). The first pack retires the
 * everyday tags it does not carry, unless entries already use them.
 */
export function applyPack(
  all: readonly CompanyTag[],
  industry: CompanyIndustry | null,
  next: CompanyIndustry,
  usedKeys: ReadonlySet<string>,
): { tags: CompanyTag[]; industry: CompanyIndustry } {
  const have = new Set(all.map((t) => t.key));
  const pack = packTags(next);
  const fresh = pack
    .filter((p) => !have.has(p.key))
    .map(({ key, label, unit }) => ({ key, label, ...(unit ? { unit } : {}) }));
  const keep = new Set(pack.map((p) => p.key));
  const current = industry
    ? [...all]
    : all.map((t) =>
        (BUILTIN_COMPANY_TAGS as readonly string[]).includes(t.key) &&
        !keep.has(t.key) &&
        !usedKeys.has(t.key)
          ? { ...t, hidden: true }
          : t,
      );
  return { tags: [...current, ...fresh].slice(0, MAX_COMPANY_TAGS), industry: industry ?? next };
}

// ── policies ─────────────────────────────────────────────────────────────────

/** A limit rule's warn/block flip; receipt rules have no flip. */
export function flipEffect(rules: readonly CompanyPolicyRule[], id: string): CompanyPolicyRule[] {
  return rules.map((r) =>
    r.id === id && r.type === 'period_limit' ? { ...r, effect: r.effect === 'warn' ? 'block' : 'warn' } : r,
  );
}

export function newReceiptRule(id: string, limitMinor: bigint): CompanyPolicyRule {
  return { id, type: 'receipt_above', limitMinor: limitMinor.toString(), effect: 'warn' };
}

export function newLimitRule(
  id: string,
  target: string,
  period: 'day' | 'month',
  limitMinor: bigint,
): CompanyPolicyRule {
  return { id, type: 'period_limit', target, period, limitMinor: limitMinor.toString(), effect: 'warn' };
}

// ── logo ─────────────────────────────────────────────────────────────────────

export function logoPath(groupId: string, mimeType: string): string {
  const ext = /png/i.test(mimeType) ? 'png' : /webp/i.test(mimeType) ? 'webp' : 'jpg';
  return `${groupId}/logo.${ext}`;
}
