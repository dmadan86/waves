/** Shared company catalog; hidden tags remain available to historical rows. */
export interface CompanyTag {
  readonly key: string;
  readonly label: string;
  readonly unit?: string;
  readonly hidden?: boolean;
  readonly addedBy?: string;
}
export const COMPANY_TAG_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
export const BUILTIN_COMPANY_TAGS = [
  'food',
  'transport',
  'fuel',
  'travel',
  'office',
  'stay',
  'other',
] as const;
export type CompanyIndustry = 'construction' | 'transport' | 'field_sales';
export type CompanyPackTag = CompanyTag & {
  readonly starred?: boolean;
  readonly labels?: { readonly hi?: string; readonly ta?: string };
};

export function slugifyTagKey(label: string): string {
  const key = label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  if (key) return key;
  let hash = 2166136261;
  for (const ch of label.normalize('NFC')) {
    hash = Math.imul(hash ^ (ch.codePointAt(0) ?? 0), 16777619) >>> 0;
  }
  return `t-${hash.toString(36)}`;
}

export function companyTagLabel(
  key: string,
  tags: readonly CompanyTag[],
  builtinLabel?: (key: string) => string | undefined,
): string {
  return (
    tags.find((tag) => tag.key === key)?.label ??
    builtinLabel?.(key) ??
    key.replace(/[-_]+/g, ' ').replace(/^./, (ch) => ch.toUpperCase())
  );
}

/** Stored order wins; append only historical builtin keys that are absent. */
export function mergeCompanyTags(
  stored: readonly CompanyTag[],
  builtinsKeysUsed: readonly string[],
): CompanyTag[] {
  const result: CompanyTag[] = [];
  const seen = new Set<string>();
  for (const tag of stored) {
    if (!seen.has(tag.key)) {
      result.push({ ...tag });
      seen.add(tag.key);
    }
  }
  for (const key of BUILTIN_COMPANY_TAGS) {
    if (builtinsKeysUsed.includes(key) && !seen.has(key)) {
      result.push({ key, label: companyTagLabel(key, []) });
      seen.add(key);
    }
  }
  return result;
}

// TODO-verify: report §2 vocabulary and star order need native-worker validation.
// English only in phase 1. Unit choices use the report enum; monetary tags omit unit.
const tag = (key: string, label: string, unit?: string, starred = false): CompanyPackTag => ({
  key,
  label,
  ...(unit ? { unit } : {}),
  ...(starred ? { starred: true } : {}),
});
export const INDUSTRY_PACKS: Readonly<
  Record<'common' | CompanyIndustry, readonly CompanyPackTag[]>
> = {
  common: [
    tag('diesel', 'Diesel', 'litre', true),
    tag('petrol', 'Petrol', 'litre', true),
    tag('food', 'Tea / food', undefined, true),
    tag('travel', 'Travel (bus/auto)'),
    tag('labour', 'Labour', 'day', true),
    tag('transport', 'Transport / freight', 'trip', true),
    tag('recharge', 'Recharge'),
    tag('repair', 'Repair'),
    tag('rent', 'Rent', 'month'),
    tag('other', 'Misc'),
  ],
  construction: [
    tag('cement', 'Cement', 'bag', true),
    tag('sand', 'Sand', 'load', true),
    tag('jalli', 'Jalli / gravel', 'load', true),
    tag('steel', 'Steel / TMT', 'kg', true),
    tag('bricks', 'Bricks', 'nos'),
    tag('mason', 'Mason', 'day'),
    tag('helper', 'Helper', 'day', true),
    tag('centering', 'Centering', 'sqft'),
    tag('bar-bending', 'Bar bending', 'day'),
    tag('binding-wire', 'Binding wire', 'kg'),
    tag('water-tanker', 'Water tanker', 'tanker'),
    tag('jcb', 'JCB / machine', 'hour'),
    tag('mixer', 'Mixer / RMC', 'hour'),
    tag('hamali', 'Hamali (loading)', 'load'),
    tag('tiles-paint-hardware', 'Tiles / paint / hardware', 'sqft'),
  ],
  transport: [
    tag('diesel', 'Diesel', 'litre', true),
    tag('toll', 'Toll / FASTag', undefined, true),
    tag('driver-bhatta', 'Driver bhatta', 'day', true),
    tag('driver-salary', 'Driver salary', 'month'),
    tag('tyre', 'Tyre', 'nos', true),
    tag('repair', 'Repair', undefined, true),
    tag('challan', 'Challan / fine'),
    tag('rto', 'RTO / permit'),
    tag('entry-police', 'Entry / police'),
    tag('hamali', 'Hamali', 'load'),
    tag('parking', 'Parking'),
    tag('oil-grease', 'Oil / grease', 'litre'),
    tag('insurance-emi', 'Insurance / EMI', 'month'),
    tag('cleaner', 'Cleaner / helper', 'day'),
    tag('weighbridge', 'Weighbridge', 'trip'),
  ],
  field_sales: [
    tag('petrol', 'Petrol', 'litre', true),
    tag('da', 'DA / bhatta', 'day', true),
    tag('food', 'Tea / food', undefined, true),
    tag('vehicle-freight', 'Vehicle freight', 'trip', true),
    tag('hamali', 'Hamali', 'load'),
    tag('tempo', 'Tempo', 'trip'),
    tag('travel', 'Bus / auto'),
    tag('recharge', 'Recharge', 'month'),
    tag('salesman-salary', 'Salesman salary', 'month'),
    tag('damage-return', 'Damage / return', 'nos'),
    tag('scheme-discount', 'Scheme / discount'),
    tag('retailer-gift', 'Retailer gift'),
    tag('hotel', 'Hotel / stay', undefined, true),
    tag('parking', 'Parking'),
  ],
};

/** Common order, industry overrides on overlapping keys, no duplicate keys. */
export function packTags(industry: CompanyIndustry | 'common' | null): CompanyPackTag[] {
  const result = new Map<string, CompanyPackTag>();
  for (const item of [
    ...INDUSTRY_PACKS.common,
    ...(industry && industry !== 'common' ? INDUSTRY_PACKS[industry] : []),
  ]) {
    result.set(item.key, { ...item });
  }
  return [...result.values()];
}
