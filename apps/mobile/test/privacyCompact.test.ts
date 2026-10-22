/**
 * The privacy screen is the standard design: a plain header and a few cards of
 * one-line rows, with the long policy text behind a sheet. Nothing it used to
 * offer was lost. The source is pinned rather than mounting the native screen.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const { STRINGS_BY_LANGUAGE } = await import('../src/i18n');

const SCREEN = readFileSync(join(process.cwd(), 'src/app/settings/privacy.tsx'), 'utf8');

describe('privacy screen', () => {
  it('uses the standard components and none of its own chrome', () => {
    for (const part of [
      '<PlainHeader',
      '<StandardCard',
      '<SectionHeader',
      '<ListRow',
      '<RowTile',
    ]) {
      expect(SCREEN).toContain(part);
    }
    expect(SCREEN).not.toContain('LinearGradient');
    expect(SCREEN).not.toContain('ShieldArt');
    expect(SCREEN).not.toContain('PointArt');
    expect(SCREEN).not.toContain('SOFT_CARD');
    expect(SCREEN).not.toMatch(/#[0-9A-Fa-f]{6}/);
  });

  it('keeps every route and control', () => {
    for (const route of [
      '/settings/discovery',
      '/settings/blocked',
      '/settings/network-activity',
      '/settings/export',
      '/settings/feedback',
      '/settings/licenses',
    ]) {
      expect(SCREEN).toContain(`'${route}'`);
    }
    expect(SCREEN).toContain('openAdPrivacyOptions');
    expect(SCREEN).toContain('{adChoices ? (');
    expect(SCREEN).toContain('{clarityConfigured ? (');
    expect(SCREEN).toContain('<Toggle');
    expect(SCREEN).toContain('setSessionReplayConsent');
    expect(SCREEN).toContain('t.privacy.blockedNone');
    expect(SCREEN).toContain('{session ? (');
  });

  it('lists all seven policy points as rows and opens their text in a sheet', () => {
    for (const id of [
      'store',
      'protect',
      'device',
      'services',
      'analytics',
      'retention',
      'choices',
    ]) {
      expect(SCREEN).toContain(`id: '${id}'`);
      expect(SCREEN).toContain(`t.privacy.${id}Body`);
    }
    expect(SCREEN).toContain('<Sheet');
    expect(SCREEN).toContain('setDetail(section.id)');
    expect(SCREEN).toContain('t.privacy.policySection');
    expect(SCREEN).toContain('lastUpdated');
  });

  it('keeps policy rows to a title, with no subtitle or paragraph in the list', () => {
    const list = SCREEN.slice(
      SCREEN.indexOf('{sections.map'),
      SCREEN.indexOf('</StandardCard>', SCREEN.indexOf('{sections.map')),
    );
    expect(list).not.toContain('subtitle=');
  });

  it('has the new section title in every language', () => {
    for (const language of ['en', 'ta', 'hi', 'ar'] as const) {
      expect(STRINGS_BY_LANGUAGE[language].privacy.dataSection.length).toBeGreaterThan(0);
    }
  });
});
