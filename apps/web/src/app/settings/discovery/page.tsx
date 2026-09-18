'use client';

/**
 * Your own say in how findable you are, and how much of you shows.
 *
 * Three real profile columns, so a choice made here is the same choice the
 * phone reads — this is one setting that genuinely follows the person rather
 * than the device.
 *
 * Two things the screen is careful to say. The first is what these switches do
 * **not** do: somebody who found you by typing your number will see that
 * number, because they already had it, and none of this ever changes who owes
 * what. The second is the direction of the visibility choice — it is about what
 * people already in your groups can see, which is a different question from
 * whether a stranger can find you.
 *
 * Each switch saves on change and rolls back on failure. A privacy toggle that
 * shows one state while the server holds another is worse than one that refuses
 * to move.
 */

import { useEffect, useState } from 'react';

import { DEFAULT_DISCOVERY, type DiscoverySettings } from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';
import { waves } from '@/lib/waves';

export default function DiscoveryPage() {
  return <AppFrame current={Section.Settings}>{() => <Discovery />}</AppFrame>;
}

function Discovery() {
  const { t } = useStrings();

  const [settings, setSettings] = useState<DiscoverySettings>(DEFAULT_DISCOVERY);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const loaded = await waves.discovery();
        if (active) setSettings(loaded);
      } catch (caught) {
        if (active)
          setFailed(
            friendlyError(caught, 'web.discovery.load', {
              fallback: t.errors.couldNotLoad,
              offline: t.errors.offline,
            }),
          );
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [t.errors.couldNotLoad, t.errors.offline]);

  /**
   * Optimistic, and rolled back on failure.
   *
   * A switch that stays where somebody put it while the server kept the old
   * value is a privacy setting that lies. Showing it snap back is unpleasant
   * and correct.
   */
  const apply = async (next: DiscoverySettings): Promise<void> => {
    const previous = settings;
    setSettings(next);
    setStatus(null);
    setBusy(true);
    try {
      await waves.saveDiscovery(next);
      setStatus(t.discovery.saved);
    } catch (caught) {
      setSettings(previous);
      setStatus(friendlyError(caught, 'web.discovery.save', { fallback: t.errors.couldNotSave }));
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <SkeletonRows rows={4} />;
  if (failed) return <p className="error">{failed}</p>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.discovery.discoveryTitle}</h1>
          <div className="sub">{t.discovery.discoveryIntro}</div>
        </div>
      </div>

      {status ? <p className="meta">{status}</p> : null}

      <section className="panel">
        <div className="panel-head">
          <h2>{t.discovery.findTitle}</h2>
        </div>

        <label className="field row-field">
          <input
            type="checkbox"
            checked={settings.discoverableByPhone}
            disabled={busy}
            onChange={(event) =>
              void apply({ ...settings, discoverableByPhone: event.target.checked })
            }
          />
          <span className="grow">
            <span className="title">{t.discovery.discoveryPhone}</span>
            <span className="meta">{t.discovery.discoveryPhoneHint}</span>
          </span>
        </label>

        <label className="field row-field">
          <input
            type="checkbox"
            checked={settings.discoverableByEmail}
            disabled={busy}
            onChange={(event) =>
              void apply({ ...settings, discoverableByEmail: event.target.checked })
            }
          />
          <span className="grow">
            <span className="title">{t.discovery.discoveryEmail}</span>
            <span className="meta">{t.discovery.discoveryEmailHint}</span>
          </span>
        </label>
      </section>

      {/* A different question from the two above: not whether a stranger can
          find you, but what the people already in your groups can see. */}
      <section className="panel">
        <div className="panel-head">
          <h2>{t.discovery.visibilityTitle}</h2>
        </div>
        <div className="lang-list" role="radiogroup" aria-label={t.discovery.visibilityTitle}>
          {(['groups', 'nobody'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={settings.contactVisibility === option}
              className={settings.contactVisibility === option ? 'lang-option on' : 'lang-option'}
              disabled={busy}
              onClick={() => void apply({ ...settings, contactVisibility: option })}
            >
              {option === 'groups' ? t.discovery.visibilityGroups : t.discovery.visibilityNobody}
            </button>
          ))}
        </div>
      </section>

      <p className="faint">{t.discovery.discoveryFootnote}</p>
    </div>
  );
}
