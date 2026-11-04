'use client';

import { Suspense, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

import { CLIENT_SOURCES, type ClientSource } from '@waves/core';

import { useStrings } from '@/i18n-context';
import {
  addFollowUpPayload,
  clientKinds,
  clientSetPayload,
  inquirySetPayload,
} from '@/lib/company/clients';
import { CompanyPage, minorFrom, useSourceLabel } from '@/lib/company/ClientParts';
import { useCompanyClients, useCompanyWrite } from '@/lib/company/useClients';
import { addDays } from '@waves/core';
import { fill } from '@/i18n';
import { todayIso } from '@/lib/company/view';

type Follow = 'today' | 'tomorrow' | 'three' | 'pick' | 'none';

export default function NewClientPage() {
  return (
    <Suspense fallback={null}>
      <Form />
    </Suspense>
  );
}

function Form() {
  const { groupId } = useParams<{ groupId: string }>();
  const edit = useSearchParams().get('edit');
  const router = useRouter();
  const { t } = useStrings();
  const s = t.company.clients;
  const view = useCompanyClients(groupId);
  const sourceLabel = useSourceLabel();
  const { run, busy, error } = useCompanyWrite(groupId);
  const existing = edit ? view.clients.find((c) => c.id === edit) : undefined;
  const today = todayIso();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [need, setNeed] = useState('');
  const [source, setSource] = useState<ClientSource>('walk_in');
  const [owner, setOwner] = useState<string | null | undefined>(undefined);
  const [follow, setFollow] = useState<Follow>('today');
  const [pickedDay, setPickedDay] = useState(today);
  const [value, setValue] = useState('');
  const [address, setAddress] = useState('');
  const [loaded, setLoaded] = useState<string | null>(null);
  // Fill the form once from the client being edited.
  if (existing && loaded !== existing.id) {
    setLoaded(existing.id);
    setName(existing.name);
    setPhone(existing.phone ?? '');
    setNeed(existing.need ?? '');
    setSource(existing.source);
    setOwner(existing.ownerMemberId);
    setFollow('none');
    setValue(existing.expectedValueMinor ? String(Number(existing.expectedValueMinor) / 100) : '');
    setAddress(existing.address ?? '');
  }
  const ownerId = owner === undefined ? view.myMemberId : owner;
  const co = view.company;
  // A manager can hand work only to their own team or themself; the server refuses the rest.
  const assignable = view.owners.filter(
    (m) => co.isOwner || m.id === view.myMemberId || co.manageableIds.has(m.id),
  );
  const day = {
    today,
    tomorrow: addDays(today, 1),
    three: addDays(today, 3),
    pick: pickedDay,
    none: null,
  }[follow];

  const submit = async () => {
    if (busy || !name.trim()) return;
    const minor = minorFrom(value, co.currency);
    const valueMinor = minor > 0n ? minor.toString() : null;
    const saved = clientSetPayload({
      clientId: existing?.id,
      name,
      phone,
      need,
      source,
      address,
      expectedValueMinor: valueMinor,
      ownerMemberId: ownerId,
      stage: existing?.stage ?? 'inquiry',
      lostReason: existing?.lostReason ?? null,
    });
    if (!(await run(clientKinds.set, saved.payload))) return;
    if (!existing) {
      // A new client starts with its first inquiry, carrying what they need and the expected value.
      const inq = inquirySetPayload({
        clientId: saved.clientId,
        title: need.trim() || name.trim(),
        details: need.trim().length > 120 ? need.trim() : null,
        expectedValueMinor: valueMinor,
        inquiryDate: today,
      });
      if (!(await run(clientKinds.inquirySet, inq.payload))) return;
      if (day && ownerId) {
        const task = addFollowUpPayload({
          clientId: saved.clientId,
          memberId: ownerId,
          day,
          title: fill(s.followTitle, { name: name.trim() }),
        });
        if (!(await run(clientKinds.work, task as unknown as Record<string, unknown>))) return;
      }
    }
    router.replace(`/c/${groupId}/clients/${saved.clientId}`);
  };

  const blocked = co.suspended || !view.canAdd;
  return (
    <CompanyPage
      groupId={groupId}
      title={existing ? s.editClient : s.newInquiry}
      back={{ href: `/c/${groupId}/clients`, label: t.company.common.back }}
    >
      {blocked ? (
        <p>{co.suspended ? s.suspended : s.noAccess}</p>
      ) : (
        <div className="card">
          <label className="field">
            <span className="field-label">{s.namePh}</span>
            <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">{s.phonePh}</span>
            <input
              type="tel"
              value={phone}
              maxLength={32}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">{s.needPh}</span>
            <input value={need} maxLength={500} onChange={(e) => setNeed(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">{s.cameFrom}</span>
            <select value={source} onChange={(e) => setSource(e.target.value as ClientSource)}>
              {CLIENT_SOURCES.map((src) => (
                <option key={src} value={src}>
                  {sourceLabel(src)}
                </option>
              ))}
            </select>
          </label>
          {!existing ? (
            <label className="field">
              <span className="field-label">{s.followUp}</span>
              <select value={follow} onChange={(e) => setFollow(e.target.value as Follow)}>
                <option value="today">{s.fuToday}</option>
                <option value="tomorrow">{s.fuTomorrow}</option>
                <option value="three">{s.fuThreeDays}</option>
                <option value="pick">{s.fuPick}</option>
                <option value="none">{s.fuNone}</option>
              </select>
              {follow === 'pick' ? (
                <input
                  type="date"
                  min={today}
                  value={pickedDay}
                  onChange={(e) => setPickedDay(e.target.value)}
                />
              ) : null}
            </label>
          ) : null}
          {view.canManage && assignable.length > 1 ? (
            <label className="field">
              <span className="field-label">{s.whoFollows}</span>
              <select value={ownerId ?? ''} onChange={(e) => setOwner(e.target.value || null)}>
                {assignable.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="field">
            <span className="field-label">{s.expectedValue}</span>
            <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">{s.addressPh}</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>
          {error ? <p role="alert">{error || s.saveFailed}</p> : null}
          <button
            className="btn brand"
            disabled={busy || !name.trim()}
            onClick={() => void submit()}
          >
            {existing ? s.save : s.saveInquiry}
          </button>
        </div>
      )}
    </CompanyPage>
  );
}
