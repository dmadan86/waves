'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { MutationKind } from '@waves/core';

import { AppFrame } from '@/components/AppFrame';
import { ErrorLine } from '@/components/company/Bits';
import { Section } from '@/components/Shell';
import { useStrings } from '@/i18n-context';
import { createGate, fetchSlotStatus, isSlotRequired } from '@/lib/company/slots';
import { friendlyError } from '@/lib/errors';
import { useSync } from '@/lib/sync';
import { putImage } from '@/lib/upload';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/waves';

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD'] as const;

export default function NewCompanyPage() {
  return <AppFrame current={Section.Companies}>{() => <NewCompany />}</AppFrame>;
}

function NewCompany() {
  const { t } = useStrings();
  const c = t.company.create;
  const router = useRouter();
  const { mirror, mutate, refresh } = useSync();
  const { profileId } = useAuth();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<string>('INR');
  const [logo, setLogo] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ownedCount = Object.values(mirror.tables.groups).filter((g) => {
    const row = g as { type?: string; deleted_at?: string | null; created_by?: string | null };
    return row.type === 'company' && !row.deleted_at && row.created_by === profileId;
  }).length;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      // The first company you own is free; another needs a slot bought in the app.
      if (createGate(await fetchSlotStatus(), ownedCount) === 'paywall') {
        setError(c.slotRequired);
        return;
      }
      const groupId = crypto.randomUUID();
      try {
        await mutate(MutationKind.GroupCreate, groupId, {
          name: name.trim() || null,
          type: 'company',
          currency,
          emoji: '🏢',
          simplify: false,
          photoPath: null,
          country: null,
          creatorMemberId: crypto.randomUUID(),
          creatorProfileId: profileId,
        });
      } catch (caught) {
        if (
          isSlotRequired(caught) ||
          (caught as { code?: string }).code === 'COMPANY_SLOT_REQUIRED'
        ) {
          setError(c.slotRequired);
          return;
        }
        throw caught;
      }
      if (logo) {
        // The group exists on the server now (the write is synchronous), so the logo can go up at once.
        try {
          const ext =
            logo.type === 'image/png' ? 'png' : logo.type === 'image/webp' ? 'webp' : 'jpg';
          const path = `${groupId}/logo.${ext}`;
          await putImage({
            bucket: 'group-photos',
            path,
            body: logo,
            contentType: logo.type || 'image/jpeg',
            groupId,
          });
          const { error: linkError } = await supabase
            .from('groups')
            .update({ photo_path: path })
            .eq('id', groupId);
          if (linkError) throw new Error(linkError.message);
        } catch {
          window.alert(c.logoLater);
        }
      }
      await refresh().catch(() => undefined);
      router.replace(`/c/${groupId}`);
    } catch (caught) {
      setError(
        friendlyError(caught, 'web.company.create', {
          fallback: t.company.common.couldNotSave,
          offline: t.errors.offline,
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-body">
      <div className="app-main">
        <div className="page-head">
          <h1>{c.title}</h1>
        </div>
        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label>
            {c.nameLabel}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={c.namePlaceholder}
              maxLength={80}
              autoFocus
            />
          </label>
          <label>
            {c.currencyLabel}
            <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label>
            {c.logoLabel}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => setLogo(event.target.files?.[0] ?? null)}
            />
          </label>
          <ErrorLine message={error} />
          <button type="submit" className="btn brand" disabled={busy || !name.trim()}>
            {c.submit}
          </button>
        </form>
      </div>
    </div>
  );
}
