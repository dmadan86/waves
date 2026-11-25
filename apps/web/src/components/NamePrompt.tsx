'use client';

/**
 * "What should friends call you?" — asked once after sign-in on the web, as the
 * phone app does in onboarding, when the profile still has no name. Without it
 * everyone in the group sees the "Guest" placeholder. Skippable; a skip lasts
 * for this browser session so it does not nag on every page.
 */

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

import { useStrings } from '@/i18n-context';
import { useAuth } from '@/lib/auth';
import { needsName } from '@/lib/needsName';
import { waves } from '@/lib/waves';

const skipKey = (id: string) => `waves.nameSkipped.${id}`;

export function NamePrompt() {
  const { t } = useStrings();
  const { session } = useAuth();
  const pathname = usePathname();
  const userId = session && session.user.is_anonymous !== true ? session.user.id : null;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId) return;
    try {
      if (sessionStorage.getItem(skipKey(userId))) return;
    } catch {
      // Storage blocked: ask again rather than never.
    }
    let active = true;
    void waves
      .myProfile()
      .then((row) => {
        if (active && row && needsName(row.display_name)) setOpen(true);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [userId]);

  if (!open || !userId || pathname === '/auth/callback') return null;

  const close = () => {
    try {
      sessionStorage.setItem(skipKey(userId), '1');
    } catch {
      // Not remembered; harmless.
    }
    setOpen(false);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await waves.updateProfile({ display_name: trimmed });
      setOpen(false);
    } catch {
      // A name that did not save is asked again next time; never block the page.
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="name-prompt-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        background: 'rgba(0,0,0,0.45)',
      }}
    >
      <form
        className="card"
        style={{ width: '100%', maxWidth: 380 }}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2 id="name-prompt-title">{t.account.nameTitle}</h2>
        <p className="faint">{t.account.nameHint}</p>
        <input
          autoFocus
          value={name}
          maxLength={60}
          placeholder={t.account.namePlaceholder}
          aria-label={t.account.nameTitle}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" className="btn block lg" disabled={busy || !name.trim()}>
          {t.account.nameSave}
        </button>
        <button type="button" className="btn soft block" onClick={close}>
          {t.account.nameSkip}
        </button>
      </form>
    </div>
  );
}
