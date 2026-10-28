/**
 * A company's shared expense tags, read local-first. Tags a member adds offline
 * show at once (the queued add is replayed over the synced list), and the list
 * is ranked by what this person uses most — no server round trip, no refusal
 * to show: the entry screen only ever offers keys the server will accept.
 */

import { useMemo } from 'react';

import {
  BUILTIN_COMPANY_TAGS,
  COMPANY_TAG_KEY_RE,
  MutationKind,
  companyTagLabel,
  packTags,
  rankTags,
  slugifyTagKey,
  type CompanyIndustry,
  type CompanyTag,
  type CompanyTagAddPayload,
  type CompanyTagsSetPayload,
} from '@waves/core';

import { useCompanyEntries, type CompanyView } from '@/data/companyEntries';
import { useGroup } from '@/data/hooks';
import { useStrings } from '@/i18n';
import { useSync } from '@/sync';

export const MAX_COMPANY_TAGS = 50;

const BUILTIN_LABEL_KEY = {
  fuel: 'catFuel',
  transport: 'catTransport',
  travel: 'catTravel',
  food: 'catFood',
  office: 'catOffice',
  other: 'catOther',
} as const;

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

/** The label of any tag key, built-in, shared or long-gone: it always renders. */
export function useCompanyTagLabel(groupId: string): (key: string) => string {
  const view = useCompanyEntries(groupId);
  return useCompanyTags(groupId, view).label;
}

export interface CompanyTags {
  /** Every tag including hidden ones, in stored order. */
  readonly all: readonly CompanyTag[];
  /** Visible tags, most used first. */
  readonly ranked: readonly CompanyTag[];
  readonly industry: CompanyIndustry | null;
  label: (key: string) => string;
  /** Finds or creates a tag by name; null when the list is full. */
  add: (label: string) => string | null;
  setTags: (tags: readonly CompanyTag[], industry: CompanyIndustry | null) => void;
  /** Adds a pack's tags (idempotent on key) and records the industry. */
  addPack: (industry: CompanyIndustry) => void;
}

export function useCompanyTags(groupId: string, view: CompanyView): CompanyTags {
  const { group } = useGroup(groupId);
  const { queue, mutate } = useSync();
  const { t } = useStrings();
  const builtinLabel = (key: string): string | undefined =>
    key in BUILTIN_LABEL_KEY
      ? (t.company[BUILTIN_LABEL_KEY[key as keyof typeof BUILTIN_LABEL_KEY]] as string)
      : undefined;

  const { stored, industry } = useMemo(() => {
    let stored = parseCompanyTags(group.data?.company_tags);
    let industry = (group.data?.company_industry ?? null) as CompanyIndustry | null;
    for (const m of [...queue].sort((a, b) => a.seq - b.seq)) {
      if (m.groupId !== groupId || m.rejection) continue;
      if (m.kind === MutationKind.CompanyTagAdd) {
        const p = m.payload as unknown as CompanyTagAddPayload;
        if (!stored.some((tag) => tag.key === p.key)) {
          stored = [...stored, { key: p.key, label: p.label, ...(p.unit ? { unit: p.unit } : {}) }];
        }
      } else if (m.kind === MutationKind.CompanyTagsSet) {
        const p = m.payload as unknown as CompanyTagsSetPayload;
        stored = parseCompanyTags(p.tags);
        industry = p.industry;
      }
    }
    return { stored, industry };
  }, [group.data?.company_tags, group.data?.company_industry, queue, groupId]);

  const usedKeys = useMemo(
    () => new Set(view.entries.flatMap((e) => (e.category ? [e.category] : []))),
    [view.entries],
  );

  // Before an industry is chosen the six everyday tags are always on offer; after,
  // only the ones the pack kept or that entries already use.
  const all = useMemo(() => {
    const seen = new Set(stored.map((tag) => tag.key));
    const extra: CompanyTag[] = [];
    for (const key of BUILTIN_COMPANY_TAGS) {
      if (seen.has(key) || (industry && !usedKeys.has(key))) continue;
      extra.push({ key, label: builtinLabel(key) ?? key });
      seen.add(key);
    }
    for (const key of usedKeys) {
      if (!seen.has(key)) extra.push({ key, label: companyTagLabel(key, [], builtinLabel) });
    }
    return [...stored, ...extra];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, industry, usedKeys, t]);

  const ranked = useMemo(() => {
    const visible = all.filter((tag) => !tag.hidden);
    const mine = view.entries.filter(
      (e) => e.kind === 'expense' && e.category && e.memberId === view.me?.id,
    );
    const order = rankTags({
      keys: visible.map((tag) => tag.key),
      uses: mine.map((e) => ({ key: e.category as string, at: e.createdAt || e.occurredOn })),
      now: Date.now(),
      starred: packTags(industry)
        .filter((p) => p.starred)
        .map((p) => p.key),
    });
    return order.map((key) => visible.find((tag) => tag.key === key) as CompanyTag);
  }, [all, view.entries, view.me?.id, industry]);

  const label = (key: string): string => companyTagLabel(key, all, builtinLabel);

  const add = (name: string): string | null => {
    const clean = name.trim().slice(0, 40);
    if (!clean) return null;
    const same = all.find((tag) => tag.label.toLowerCase() === clean.toLowerCase());
    if (same) return same.key;
    if (all.length >= MAX_COMPANY_TAGS) return null;
    let key = slugifyTagKey(clean);
    for (let n = 2; all.some((tag) => tag.key === key); n += 1) {
      key = `${slugifyTagKey(clean).slice(0, 36)}-${n}`;
    }
    void mutate(MutationKind.CompanyTagAdd, groupId, {
      key,
      label: clean,
    } satisfies CompanyTagAddPayload);
    return key;
  };

  const setTags = (tags: readonly CompanyTag[], next: CompanyIndustry | null): void => {
    void mutate(MutationKind.CompanyTagsSet, groupId, {
      tags,
      industry: next,
    } satisfies CompanyTagsSetPayload);
  };

  const addPack = (next: CompanyIndustry): void => {
    const have = new Set(all.map((tag) => tag.key));
    const fresh = packTags(next)
      .filter((p) => !have.has(p.key))
      .map(({ key, label: text, unit }) => ({ key, label: text, ...(unit ? { unit } : {}) }));
    const keep = new Set(packTags(next).map((p) => p.key));
    // The first pack retires the everyday tags it does not carry, unless entries use them.
    const current = industry
      ? all
      : all.map((tag) =>
          (BUILTIN_COMPANY_TAGS as readonly string[]).includes(tag.key) &&
          !keep.has(tag.key) &&
          !usedKeys.has(tag.key)
            ? { ...tag, hidden: true }
            : tag,
        );
    setTags([...current, ...fresh].slice(0, MAX_COMPANY_TAGS), industry ?? next);
  };

  return { all, ranked, industry, label, add, setTags, addPack };
}
