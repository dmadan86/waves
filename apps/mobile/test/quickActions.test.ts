import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { SHORTCUT_ACTIONS, actionForId, routeForShortcut } from '../src/lib/quickActions';

describe('app-icon quick shortcuts', () => {
  it('publishes the three user entry points in stable menu order', () => {
    expect(SHORTCUT_ACTIONS).toEqual(['add', 'scan', 'voice']);
  });

  it('ignores ids that are not Waves shortcut actions', () => {
    expect(actionForId('waves.shortcut.add')).toBe('add');
    expect(actionForId('waves.shortcut.scan')).toBe('scan');
    expect(actionForId('waves.shortcut.voice')).toBe('voice');
    expect(actionForId('waves.shortcut.settings')).toBeNull();
    expect(actionForId('other.shortcut.add')).toBeNull();
  });

  it('routes add, scan, and voice to the same places as in-app quick add', () => {
    expect(routeForShortcut('add')).toBe('/capture');
    expect(routeForShortcut('scan', 12345)).toBe('/capture?scan=12345');
    expect(routeForShortcut('voice')).toBe('/voice');
  });
});
