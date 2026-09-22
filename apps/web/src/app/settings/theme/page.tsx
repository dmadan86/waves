'use client';

/**
 * Light, dark, or whatever the machine is set to.
 *
 * The switch itself already existed — `lib/theme` has held the three-value
 * choice and the `data-theme` stamp since the web got a dark palette. What it
 * had no home for was a *setting*: the only way to change it was a cycling
 * button in the account menu, which is the last place somebody looks and the
 * one place that cannot say what the three states are.
 *
 * This is the same state read through the same hook, not a second copy. Flipping
 * it here moves the button in the menu in the same frame, because there is one
 * store and both are subscribed to it. A second setting would be a fork, and
 * two halves of a fork fall out of step.
 *
 * Three options, not two. "Device" is the default and stamps nothing, leaving
 * `prefers-color-scheme` to decide, which is the answer for most people most of
 * the time. Its subtitle says which way the machine currently leans, so the
 * default is never a mystery.
 */

import Link from 'next/link';
import { Check, Monitor, Moon, Sun } from 'lucide-react';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';
import { useTheme, type ThemeChoice } from '@/lib/theme';

export default function ThemePage() {
  return <AppFrame current={Section.Settings}>{() => <Appearance />}</AppFrame>;
}

function Appearance() {
  const { t } = useStrings();
  const { choice, setChoice, resolved } = useTheme();

  const options: { id: ThemeChoice; title: string; body: string; Icon: typeof Sun }[] = [
    {
      id: 'system',
      title: t.theme.system,
      // What the machine is saying, but only while the machine is the one being
      // asked: `resolved` is the choice itself once there is an explicit one, so
      // reading it under Light would report Light as the device's setting.
      body:
        choice === 'system'
          ? fill(t.theme.currently, {
              scheme: resolved === 'dark' ? t.theme.dark : t.theme.light,
            })
          : t.theme.systemHint,
      Icon: Monitor,
    },
    { id: 'light', title: t.theme.light, body: t.theme.lightHint, Icon: Sun },
    { id: 'dark', title: t.theme.dark, body: t.theme.darkHint, Icon: Moon },
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.theme.label}</h1>
        </div>
      </div>

      <section className="panel">
        <div className="list" role="radiogroup" aria-label={t.theme.label}>
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={choice === option.id}
              className="item"
              onClick={() => setChoice(option.id)}
            >
              <option.Icon size={18} strokeWidth={1.75} aria-hidden />
              <span className="grow">
                <span className="title">{option.title}</span>
                <span className="meta">{option.body}</span>
              </span>
              {choice === option.id ? <Check size={16} strokeWidth={2} aria-hidden /> : null}
            </button>
          ))}
        </div>
      </section>

      <p className="faint">{t.theme.footnote}</p>

      <p className="faint">
        <Link className="plain-link" href="/settings">
          {t.settings.title}
        </Link>
      </p>
    </div>
  );
}
