'use client';

/** Add a vendor: paste a link or look up a Waves ID to prefill, then the form. (Camera QR scan is device-only.) */
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { CompanyFrame } from '@/components/CompanyFrame';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';
import { channelFor } from '@/lib/lookup';
import { useAction, useVendorsData } from '@/lib/company/useVendors';
import { parseVendorShare, vendorSetMutation } from '@/lib/company/vendors';
import { waves } from '@/lib/waves';
import { Field, Page } from '../_components/parts';

type Mode = 'link' | 'id';

export default function AddVendorPage() {
  const { groupId } = useParams<{ groupId: string }>();
  return (
    <CompanyFrame groupId={groupId}>
      <Inner groupId={groupId} />
    </CompanyFrame>
  );
}

function Inner({ groupId }: { groupId: string }) {
  const { t } = useStrings();
  const s = t.company.vendors;
  const router = useRouter();
  const d = useVendorsData(groupId);
  const save = useAction();
  const [mode, setMode] = useState<Mode>('link');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [category, setCategory] = useState('');
  const categories = [
    s.catSupplier,
    s.catContractor,
    s.catLandlord,
    s.catUtilities,
    s.catTransport,
    s.catOther,
  ];

  if (!d.canManage)
    return (
      <Page title={s.addVendor}>
        <p className="faint">{s.notFound}</p>
      </Page>
    );

  const apply = (found: { name?: string; phone?: string } | null) => {
    if (!found) return setNote(s.lookupFailed);
    setName(found.name ?? '');
    setPhone(found.phone ?? '');
    setNote(null);
  };
  const run = async () => {
    if (mode === 'link') return apply(parseVendorShare(code));
    const channel = channelFor(code);
    if (!channel) return setNote(s.idHint);
    setBusy(true);
    try {
      const person = await waves.findPerson(channel, code.trim());
      apply(
        person
          ? { name: person.display_name, ...(channel === 'phone' && { phone: code.trim() }) }
          : null,
      );
    } catch {
      setNote(s.lookupFailed);
    } finally {
      setBusy(false);
    }
  };
  const valid = name.trim().length > 0 && !save.busy;
  const submit = () => {
    const vendorId = crypto.randomUUID();
    const m = vendorSetMutation({ vendorId, name, phone, category });
    void save
      .run(
        () => d.mutate(m.kind, groupId, m.payload),
        (e) => friendlyError(e, 'web.vendors.add', { fallback: s.failed }),
      )
      .then((ok) => ok && router.replace(`/c/${groupId}/vendors/${vendorId}`));
  };

  return (
    <Page title={s.addVendor}>
      <p className="sub">{s.addSubtitle}</p>
      <div className="panel">
        <div className="row-field">
          <button
            type="button"
            className={mode === 'link' ? 'btn brand' : 'btn soft'}
            onClick={() => {
              setMode('link');
              setNote(null);
            }}
          >
            {s.fromLink}
          </button>
          <button
            type="button"
            className={mode === 'id' ? 'btn brand' : 'btn soft'}
            onClick={() => {
              setMode('id');
              setNote(null);
            }}
          >
            {s.wavesId}
          </button>
        </div>
        <p className="faint">{mode === 'link' ? s.helpLink : s.helpId}</p>
        <Field
          label={mode === 'link' ? s.linkPlaceholder : s.idPlaceholder}
          value={code}
          onChange={setCode}
          maxLength={300}
        />
        <button
          type="button"
          className="btn soft"
          disabled={busy || !code.trim()}
          onClick={() => void run()}
        >
          {mode === 'link' ? s.useLink : s.findId}
        </button>
        {note ? <p className="error">{note}</p> : null}
      </div>
      <div className="panel">
        <h2>{s.enterManually}</h2>
        <Field label={`${s.name} *`} value={name} onChange={setName} />
        <Field
          label={s.phoneOptional}
          value={phone}
          onChange={setPhone}
          maxLength={20}
          type="tel"
          inputMode="tel"
        />
        <label className="field">
          <span className="field-label">{s.categoryOptional}</span>
          <input
            list="vendor-categories"
            value={category}
            maxLength={120}
            onChange={(e) => setCategory(e.target.value)}
          />
          <datalist id="vendor-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        {save.error ? <p className="error">{save.error}</p> : null}
        <button type="button" className="btn brand" disabled={!valid} onClick={submit}>
          {s.saveVendor}
        </button>
      </div>
    </Page>
  );
}
