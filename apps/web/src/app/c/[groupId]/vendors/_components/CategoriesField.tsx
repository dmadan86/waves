'use client';

import { useState } from 'react';

import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Pick a vendor's categories: tick the presets and the ones this company already uses, or type a new one. Up to 10, 40 characters each. */
export function CategoriesField({
  value,
  onChange,
  used,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  used: readonly string[];
}) {
  const { t } = useStrings();
  const s = t.company.vendors;
  const [draft, setDraft] = useState('');
  const presets = [
    s.catMaterials,
    s.catCement,
    s.catElectrical,
    s.catPlumbing,
    s.catPainting,
    s.catHardware,
    s.catLabour,
  ];
  const options = [...presets, ...used, ...value].filter(
    (c, i, all) => all.findIndex((x) => same(x, c)) === i,
  );
  const add = (raw: string) => {
    const name = raw.trim().slice(0, 40).trim();
    if (name && value.length < 10 && !value.some((c) => same(c, name))) onChange([...value, name]);
  };
  const toggle = (c: string) =>
    value.some((x) => same(x, c)) ? onChange(value.filter((x) => !same(x, c))) : add(c);
  return (
    <fieldset className="field">
      <legend className="field-label">{s.categories}</legend>
      {options.map((c) => (
        <label key={c} style={{ display: 'inline-flex', gap: 6, marginInlineEnd: 12 }}>
          <input
            type="checkbox"
            checked={value.some((x) => same(x, c))}
            onChange={() => toggle(c)}
          />
          {c}
        </label>
      ))}
      <input
        aria-label={s.addOrSelectCategory}
        placeholder={s.addOrSelectCategory}
        value={draft}
        maxLength={40}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          add(draft);
          setDraft('');
        }}
      />{' '}
      <button
        type="button"
        className="btn soft"
        onClick={() => {
          add(draft);
          setDraft('');
        }}
      >
        {s.addCategory}
      </button>
      {value.map((c) => (
        <button
          key={c}
          type="button"
          className="btn soft"
          aria-label={fill(s.removeCategory, { name: c })}
          onClick={() => toggle(c)}
        >
          {c} ×
        </button>
      ))}
    </fieldset>
  );
}
