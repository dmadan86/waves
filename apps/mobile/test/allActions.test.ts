import { describe, expect, it } from 'vitest';

import {
  buildActionSections,
  filterActionSections,
  visibleChips,
  type ActionsContext,
} from '@/lib/allActions';

const base: ActionsContext = { family: [], companies: [], companiesEnabled: true };
const keys = (ctx: ActionsContext, id: string) =>
  buildActionSections(ctx)
    .find((s) => s.id === id)
    ?.tiles.map((t) => t.key);

describe('buildActionSections', () => {
  it('has a Groups tile (was Remind) that opens the Groups list', () => {
    const remind = buildActionSections(base)
      .find((s) => s.id === 'groups')
      ?.tiles.find((t) => t.key === 'groups');
    expect(remind?.target).toEqual({ kind: 'route', href: '/groups' });
  });

  it('has no Family or Company without a couple/family space or a company', () => {
    const ids = buildActionSections(base).map((s) => s.id);
    expect(ids).toEqual(['quick', 'personal', 'groups']);
  });

  it('shows Family for a couple space, with its name and routes', () => {
    const s = buildActionSections({
      ...base,
      family: [{ id: 'c1', type: 'couple', name: 'Renny' }],
    }).find((x) => x.id === 'family');
    expect(s?.sub).toBe('Renny');
    expect(s?.tiles.map((t) => t.key)).toEqual(['coupleSpace', 'sharedRentals', 'dates']);
    expect(s?.tiles[1]?.target).toEqual({ kind: 'route', href: '/rentals?space=c1' });
  });

  it('adds the family group tile for a home space', () => {
    const k = keys({ ...base, family: [{ id: 'h1', type: 'home', name: 'Home' }] }, 'family');
    expect(k).toEqual(['sharedRentals', 'familyGroup', 'dates']);
  });

  it('opens Recurring, Budgets and Loans through the planning helper', () => {
    const personal = buildActionSections(base).find((s) => s.id === 'personal');
    const targets = personal?.tiles
      .filter((t) => ['budgets', 'recurring', 'loans'].includes(t.key))
      .map((t) => t.target);
    expect(targets).toEqual([
      { kind: 'planning', segment: 'budgets' },
      { kind: 'planning', segment: 'recurring' },
      { kind: 'planning', segment: 'loans' },
    ]);
  });

  it('gives each company its own section and gates tiles by role', () => {
    const ctx: ActionsContext = {
      ...base,
      companies: [
        { id: 'a', name: 'Acme', role: 'admin' },
        { id: 'b', name: 'Beta', role: 'member' },
      ],
    };
    const sections = buildActionSections(ctx);
    expect(sections.filter((s) => s.space === 'company').map((s) => s.sub)).toEqual([
      'Acme',
      'Beta',
    ]);
    expect(keys(ctx, 'company:a')).toContain('wages');
    expect(keys(ctx, 'company:b')).not.toContain('wages');
    expect(keys(ctx, 'company:b')).not.toContain('payments');
    expect(keys(ctx, 'company:b')).toContain('entries');
    expect(
      keys({ ...ctx, companies: [{ id: 'm', name: 'M', role: 'manager' }] }, 'company:m'),
    ).toContain('vendors');
  });

  it('hides companies when they are switched off', () => {
    const ids = buildActionSections({
      ...base,
      companiesEnabled: false,
      companies: [{ id: 'a', name: 'Acme', role: 'admin' }],
    }).map((s) => s.id);
    expect(ids).not.toContain('company:a');
  });
});

describe('filterActionSections', () => {
  const sections = buildActionSections({
    family: [{ id: 'c1', type: 'couple', name: 'Renny' }],
    companies: [{ id: 'a', name: 'Acme', role: 'admin' }],
    companiesEnabled: true,
  });
  const label = (k: string) => (k === 'budgets' ? 'பட்ஜெட்' : k);

  it('keeps everything on All with no query', () => {
    expect(filterActionSections(sections, 'all', '', label)).toHaveLength(sections.length);
  });

  it('a chip keeps Quick plus its own space', () => {
    expect(filterActionSections(sections, 'family', '', label).map((s) => s.id)).toEqual([
      'quick',
      'family',
    ]);
  });

  it('searches the localized label, any script', () => {
    const r = filterActionSections(sections, 'all', ' பட்', label);
    expect(r.flatMap((s) => s.tiles.map((t) => t.key))).toEqual(['budgets']);
  });

  it('drops sections with no match', () => {
    expect(filterActionSections(sections, 'all', 'zzzz', label)).toEqual([]);
  });
});

describe('visibleChips', () => {
  it('only offers chips that have tiles', () => {
    expect(visibleChips(buildActionSections(base))).toEqual(['all', 'personal', 'groups']);
  });
});
