'use client';

/**
 * Add / edit one company entry (web port of mobile company-entry.tsx). Same payload
 * as the phone. Skipped: custom tags, per-tag units/quantity, wages screen link.
 */
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  allowanceAmount,
  BUILTIN_COMPANY_TAGS,
  companyTagLabel,
  evaluateCompanyPolicies,
  findDuplicateEntry,
  formatMinorInput,
  gstFromInclusive,
  materialiseCompanyProjects,
  mileageAmount,
  normaliseDecimalInput,
  normaliseGstin,
  parseMinorInput,
  resolveMileageRate,
  validateGstin,
  type CompanyCalcMode,
  type CompanyEntry,
  type CompanyEntryData,
  type CompanyEntryKind,
  type CurrencyCode,
  type PolicyFlag,
} from '@waves/core';

import { useSync, NO_QUEUE } from '@/lib/sync';
import { money } from '@/lib/money';
import { memberName, todayIso, useCompanyView } from './view';
import { useEntryActions } from './entryActions';
import { attachEntryPhoto, MAX_COMPANY_PHOTOS } from './entryPhotos';
import { entryStrings as s } from './entryStrings';

type Direction = 'company_to_employee' | 'employee_to_company';
type SaveKind = 'expense' | 'advance' | 'allowance' | 'wages' | 'reimbursement';

const COMPANY_PAID_TAGS = [
  'materials',
  'repair',
  'rent',
  'utilities',
  'transport',
  'equipment',
  'office',
  'other',
] as const;
const GST_RATES = [0, 500, 1200, 1800, 2800];

export function CompanyEntryForm({ groupId, entry }: { groupId: string; entry?: CompanyEntry }) {
  const router = useRouter();
  const params = useSearchParams();
  const { mirror } = useSync();
  const view = useCompanyView(groupId);
  const actions = useEntryActions(groupId);
  const currency = view.currency as CurrencyCode;
  const editing = !!entry;
  const fmt = (minor: bigint): string => money(minor, currency);

  const projects = materialiseCompanyProjects(mirror, NO_QUEUE, { groupId }).filter(
    (p) => !p.deleted_at && !p.archived_at,
  );
  const liveMembers = view.members.filter((m) => !m.left_at);

  const memberParam = params.get('member');
  const kindParam = params.get('kind');
  const [projectId, setProjectId] = useState<string | null>(entry?.projectId ?? null);
  const [pickedKind, setKind] = useState<CompanyEntryKind | null>(entry?.kind ?? null);
  const [memberId, setMemberId] = useState<string | null>(entry?.memberId || memberParam || null);
  const [payer, setPayer] = useState<'employee' | 'company'>(
    entry?.paidByCompany ? 'company' : 'employee',
  );
  const paidByCompany = payer === 'company' && (view.isOwner || view.isManager);
  const employee = paidByCompany
    ? undefined
    : memberId === null
      ? (view.me ?? undefined)
      : view.members.find((m) => m.id === memberId);
  // A manager's own entries are expense / bata only; money to the team comes from their pool.
  const moneyKinds = view.isAdmin && (view.isOwner || employee?.id !== view.me?.id);
  const kinds: CompanyEntryKind[] = moneyKinds
    ? view.isOwner
      ? ['expense', 'allowance', 'advance', 'wages', 'reimbursement']
      : ['expense', 'allowance', 'advance', 'reimbursement']
    : ['expense', 'allowance'];
  const kind: CompanyEntryKind =
    (paidByCompany ? 'expense' : null) ??
    pickedKind ??
    (moneyKinds && kindParam === 'advance' ? 'advance' : null) ??
    (moneyKinds && memberParam && memberParam !== view.me?.id ? 'advance' : 'expense');

  const [pickedTag, setPickedTag] = useState<string | null>(entry?.category ?? null);
  const category = pickedTag ?? (paidByCompany ? 'materials' : 'other');
  const tagKeys = [
    ...(paidByCompany ? COMPANY_PAID_TAGS : BUILTIN_COMPANY_TAGS),
    ...(pickedTag &&
    !(paidByCompany ? COMPANY_PAID_TAGS : BUILTIN_COMPANY_TAGS).includes(pickedTag as never)
      ? [pickedTag]
      : []),
  ] as string[];

  const [amountText, setAmountText] = useState(
    entry ? formatMinorInput(entry.amount, currency) : '',
  );
  const [days, setDays] = useState(entry?.days ?? '1');
  const [rateText, setRateText] = useState<string | null>(
    entry?.calcMode === 'days_rate' && entry.rateMinor !== null
      ? formatMinorInput(entry.rateMinor, currency)
      : null,
  );
  const [wagesMode, setWagesMode] = useState<CompanyCalcMode>(
    entry?.kind === 'wages' && entry.calcMode ? entry.calcMode : 'typed',
  );
  const [direction, setDirection] = useState<Direction>(
    (entry?.direction as Direction | null) ?? 'company_to_employee',
  );
  const [date, setDate] = useState(entry?.occurredOn ?? todayIso());
  const [note, setNote] = useState(entry?.note ?? '');
  const [mileage, setMileage] = useState(entry?.calcMode === 'distance_rate');
  const [distance, setDistance] = useState(entry?.distanceKm ?? '');
  const [kmRateText, setKmRateText] = useState<string | null>(
    entry?.calcMode === 'distance_rate' && entry.rateMinor !== null
      ? formatMinorInput(entry.rateMinor, currency)
      : null,
  );
  const [fromText, setFromText] = useState(entry?.fromText ?? '');
  const [toText, setToText] = useState(entry?.toText ?? '');
  const [vendor, setVendor] = useState(entry?.vendor ?? '');
  const [gstin, setGstin] = useState(entry?.gstin ?? '');
  const [invoiceNo, setInvoiceNo] = useState(entry?.invoiceNo ?? '');
  const [gstRateBps, setGstRateBps] = useState<number | null>(entry?.gstRateBps ?? null);
  const [gstText, setGstText] = useState<string | null>(
    entry?.gstAmount != null ? formatMinorInput(entry.gstAmount, currency) : null,
  );
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  const defaultRate = employee?.daily_rate_minor
    ? BigInt(employee.daily_rate_minor)
    : view.group?.company_default_daily_rate_minor
      ? BigInt(view.group.company_default_daily_rate_minor)
      : 0n;
  const rate = rateText !== null ? parseMinorInput(rateText, currency) : defaultRate;
  const byDays = kind === 'allowance' || (kind === 'wages' && wagesMode === 'days_rate');
  const byKm =
    !paidByCompany &&
    kind === 'expense' &&
    mileage &&
    (category === 'fuel' || category === 'transport');
  const perKm = resolveMileageRate(
    kmRateText !== null ? parseMinorInput(kmRateText, currency) : null,
    (employee as { mileage_rate_minor?: string | null } | undefined)?.mileage_rate_minor,
    view.group?.company_default_mileage_rate_minor ?? undefined,
  );
  const computed = byDays
    ? allowanceAmount(days, rate)
    : byKm && perKm !== null
      ? mileageAmount(distance, perKm)
      : null;
  const typedAmount = parseMinorInput(amountText, currency);
  const total = byDays || byKm ? (computed ?? 0n) : typedAmount;
  const showGst = view.gstEnabled && kind === 'expense' && !byKm;
  const gstAmount =
    gstText !== null
      ? parseMinorInput(gstText, currency)
      : gstRateBps !== null && total > 0n
        ? gstFromInclusive(total, gstRateBps)
        : null;
  const gstinText = gstin.trim();
  const gstinBad = showGst && gstinText !== '' && !validateGstin(gstinText);
  const gstTooBig = showGst && gstAmount !== null && gstAmount > total;

  const flags: PolicyFlag[] =
    employee && (kind === 'expense' || kind === 'allowance') && total > 0n
      ? evaluateCompanyPolicies(
          {
            memberId: employee.id,
            kind,
            category: kind === 'expense' ? category : null,
            amount: total,
            occurredOn: date,
          },
          view.entries,
          view.policies,
          { hasReceipt: photos.length > 0 },
        )
      : [];
  const blocked = flags.find((f) => f.effect === 'block');
  const duplicate =
    employee && kind === 'expense' && total > 0n
      ? findDuplicateEntry(
          {
            id: entry?.id,
            memberId: employee.id,
            kind,
            category,
            amount: total,
            occurredOn: date,
            vendor: vendor.trim() || null,
            invoiceNo: invoiceNo.trim() || null,
          } as Parameters<typeof findDuplicateEntry>[0],
          view.entries,
        )
      : null;
  const flagText = (f: PolicyFlag): string =>
    f.code === 'RECEIPT'
      ? s.policyHintReceipt(fmt(f.limitMinor))
      : f.effect === 'block'
        ? s.policyBlocked(fmt(f.limitMinor))
        : s.policyHintLimit(
            fmt(f.actualMinor),
            f.period === 'day' ? s.perDay : s.perMonth,
            fmt(f.limitMinor),
          );

  const valid =
    (paidByCompany || !!employee) &&
    (byDays || byKm ? computed !== null : total > 0n) &&
    !gstinBad &&
    !gstTooBig &&
    !blocked;

  const addAnother = (): void => {
    setAmountText('');
    setPickedTag(null);
    setNote('');
    setPhotos([]);
    setDate(todayIso());
    setMileage(false);
    setDistance('');
    setKmRateText(null);
    setFromText('');
    setToText('');
    setVendor('');
    setGstin('');
    setInvoiceNo('');
    setGstRateBps(null);
    setGstText(null);
    setDays('1');
    setRateText(null);
    setError(null);
    setSaved(null);
    setFormKey((k) => k + 1);
  };

  const save = async (): Promise<void> => {
    if (!valid || (!paidByCompany && !employee)) {
      setError(
        !paidByCompany && !employee
          ? s.needPerson
          : byKm
            ? perKm === null
              ? s.needMileageRate
              : s.needDistance
            : gstinBad
              ? s.gstinBad
              : gstTooBig
                ? s.gstTooBig
                : blocked
                  ? flagText(blocked)
                  : byDays
                    ? s.needRate
                    : s.needAmount,
      );
      return;
    }
    setError(null);
    const data: CompanyEntryData = {
      ...(paidByCompany && !editing ? { paidByCompany: true } : {}),
      amount: total.toString(),
      occurredOn: date,
      note: note.trim().slice(0, 500) || null,
      ...(kind === 'expense' ? { category } : {}),
      ...(byDays
        ? { calcMode: 'days_rate' as const, days: days.trim(), rateMinor: rate.toString() }
        : kind === 'wages'
          ? { calcMode: wagesMode }
          : {}),
      ...(byKm && perKm !== null
        ? {
            calcMode: 'distance_rate' as const,
            distanceKm: distance.trim(),
            rateMinor: perKm.toString(),
            fromText: fromText.trim() || null,
            toText: toText.trim() || null,
          }
        : {}),
      ...(showGst
        ? {
            vendor: vendor.trim() || null,
            gstin: gstinText ? normaliseGstin(gstinText) : null,
            invoiceNo: invoiceNo.trim() || null,
            gstRateBps,
            gstAmountMinor: gstAmount !== null ? gstAmount.toString() : null,
          }
        : {}),
      ...(kind === 'reimbursement' ? { direction } : {}),
      ...(projectId ? { projectId } : {}),
      ...(!editing &&
      view.isManager &&
      (kind === 'advance' || kind === 'wages' || kind === 'reimbursement')
        ? { fundingManagerId: view.me?.id ?? null }
        : {}),
    };
    setBusy(true);
    try {
      if (entry) {
        await actions.update({ entryId: entry.id, patch: data });
        router.push(`/c/${groupId}/entry/${entry.id}`);
        return;
      }
      const entryId = crypto.randomUUID();
      await actions.add({
        entryId,
        memberId: paidByCompany ? null : employee!.id,
        entryKind: kind as SaveKind,
        data,
      });
      let photoFailed = false;
      for (const file of photos) {
        try {
          await attachEntryPhoto(groupId, entryId, file);
        } catch (e) {
          photoFailed = true;
          console.error('company entry photo failed', e);
        }
      }
      setSaved(
        `${fmt(total)} · ${kind === 'expense' ? companyTagLabel(category, []) : s.kinds[kind]}${photoFailed ? ` (${s.photoFailed})` : ''}`,
      );
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : s.couldNotSave);
    } finally {
      setBusy(false);
    }
  };

  const canPickPerson = !editing && (view.isOwner || view.isManager);
  const personName = paidByCompany
    ? s.companyPaid
    : employee
      ? memberName(employee, 'Someone')
      : s.selectPerson;

  return (
    <form
      key={formKey}
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h1>{editing ? s.editEntry : s.addEntry}</h1>
      <p className="faint">{view.name}</p>

      {canPickPerson ? (
        <label>
          {kind === 'expense' || kind === 'allowance' ? s.paidBy : s.employee}
          <select
            value={paidByCompany ? 'company' : (employee?.id ?? '')}
            onChange={(e) => {
              const v = e.target.value;
              setPayer(v === 'company' ? 'company' : 'employee');
              if (v !== 'company') setMemberId(v || null);
              if (v === 'company') setKind('expense');
              setPickedTag(null);
              setRateText(null);
            }}
          >
            {!employee && !paidByCompany ? <option value="">{s.selectPerson}</option> : null}
            {kind === 'expense' && (view.isOwner || view.isManager) ? (
              <option value="company">{s.companyPaid}</option>
            ) : null}
            {liveMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {memberName(m, 'Someone')}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p>{personName}</p>
      )}
      {paidByCompany && view.isManager ? <p className="faint">{s.companyPaidPoolHint}</p> : null}

      {!editing && !paidByCompany && kinds.length > 1 ? (
        <label>
          {s.kind}
          <select value={kind} onChange={(e) => setKind(e.target.value as CompanyEntryKind)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {s.kinds[k]}
              </option>
            ))}
          </select>
        </label>
      ) : editing ? (
        <p>{s.kinds[kind]}</p>
      ) : null}

      {kind === 'wages' ? (
        <label>
          {s.typed}
          <select
            value={wagesMode}
            onChange={(e) => setWagesMode(e.target.value as CompanyCalcMode)}
            disabled={editing}
          >
            <option value="typed">{s.typed}</option>
            <option value="fixed_weekly">{s.wagesWeekly}</option>
            <option value="days_rate">{s.wagesDaysRate}</option>
          </select>
        </label>
      ) : null}
      {kind === 'reimbursement' ? (
        <label>
          {s.direction}
          <select value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
            <option value="company_to_employee">{s.payTo}</option>
            <option value="employee_to_company">{s.returnFrom}</option>
          </select>
        </label>
      ) : null}

      {kind === 'expense' ? (
        <>
          <label>
            {s.category}
            <select value={category} onChange={(e) => setPickedTag(e.target.value)}>
              {tagKeys.map((k) => (
                <option key={k} value={k}>
                  {companyTagLabel(k, [])}
                </option>
              ))}
            </select>
          </label>
          {!paidByCompany && (category === 'fuel' || category === 'transport') ? (
            <label>
              {s.mileage}
              <select
                value={mileage ? 'km' : 'typed'}
                onChange={(e) => setMileage(e.target.value === 'km')}
              >
                <option value="typed">{s.typed}</option>
                <option value="km">{s.mileage}</option>
              </select>
            </label>
          ) : null}
        </>
      ) : null}

      {byKm ? (
        <>
          <label>
            {s.distance}
            <input
              inputMode="decimal"
              value={distance}
              onChange={(e) => setDistance(normaliseDecimalInput(e.target.value))}
            />
          </label>
          <label>
            {s.ratePerKm}
            <input
              inputMode="decimal"
              value={kmRateText ?? (perKm ? formatMinorInput(perKm, currency) : '')}
              onChange={(e) => setKmRateText(e.target.value)}
            />
          </label>
          <label>
            {s.from}
            <input value={fromText} maxLength={120} onChange={(e) => setFromText(e.target.value)} />
          </label>
          <label>
            {s.to}
            <input value={toText} maxLength={120} onChange={(e) => setToText(e.target.value)} />
          </label>
          <p>
            <strong>
              {s.total}: {fmt(total)}
            </strong>
          </p>
        </>
      ) : byDays ? (
        <>
          <label>
            {s.days}
            <input
              inputMode="decimal"
              value={days}
              onChange={(e) => setDays(normaliseDecimalInput(e.target.value))}
            />
          </label>
          <label>
            {s.rate}
            <input
              inputMode="decimal"
              value={rateText ?? formatMinorInput(defaultRate, currency)}
              onChange={(e) => setRateText(e.target.value)}
            />
          </label>
          <p>
            <strong>
              {s.total}: {fmt(total)}
            </strong>
          </p>
        </>
      ) : (
        <label>
          {s.amount} ({currency})
          <input
            inputMode="decimal"
            autoFocus
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
          />
        </label>
      )}

      {flags.map((f) => (
        <p
          key={f.ruleId}
          role={f.effect === 'block' ? 'alert' : undefined}
          className={f.effect === 'block' ? undefined : 'faint'}
        >
          ! {flagText(f)}
        </p>
      ))}
      {duplicate ? <p className="faint">! {s.dupHint}</p> : null}

      <label>
        {s.date}
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>

      <label>
        {s.note}
        <textarea value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </label>

      {projects.length > 0 ? (
        <label>
          {s.site}
          <select value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value || null)}>
            <option value="">{s.noSite}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {showGst ? (
        <fieldset>
          <legend>{s.gstSection}</legend>
          <label>
            {s.gstRate}
            <select
              value={gstRateBps === null ? '' : String(gstRateBps)}
              onChange={(e) => {
                setGstRateBps(e.target.value === '' ? null : Number(e.target.value));
                setGstText(null);
              }}
            >
              <option value=""></option>
              {GST_RATES.map((bps) => (
                <option key={bps} value={bps}>
                  {bps / 100}%
                </option>
              ))}
            </select>
          </label>
          <label>
            {s.vendor}
            <input value={vendor} maxLength={120} onChange={(e) => setVendor(e.target.value)} />
          </label>
          <label>
            {s.gstin}
            <input
              value={gstin}
              maxLength={15}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
            />
          </label>
          <label>
            {s.invoiceNo}
            <input
              value={invoiceNo}
              maxLength={80}
              onChange={(e) => setInvoiceNo(e.target.value)}
            />
          </label>
          {gstinBad ? <p role="alert">{s.gstinBad}</p> : null}
          <label>
            {s.gstAmount}
            <input
              inputMode="decimal"
              value={gstText ?? (gstAmount !== null ? formatMinorInput(gstAmount, currency) : '')}
              onChange={(e) => setGstText(e.target.value)}
            />
          </label>
          {gstAmount !== null && gstAmount <= total ? (
            <p className="faint">
              {s.gstBefore}: {fmt(total - gstAmount)} · {s.gstAmount}: {fmt(gstAmount)}
            </p>
          ) : gstTooBig ? (
            <p role="alert">{s.gstTooBig}</p>
          ) : null}
        </fieldset>
      ) : null}

      {!editing ? (
        <div>
          <label className="btn soft">
            {s.addPhotos}
            <input
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                setPhotos((cur) => [...cur, ...picked].slice(0, MAX_COMPANY_PHOTOS));
                e.target.value = '';
              }}
            />
          </label>
          {photos.map((file, i) => (
            <button
              key={`${file.name}-${i}`}
              type="button"
              className="btn soft"
              onClick={() => setPhotos((cur) => cur.filter((_, j) => j !== i))}
            >
              {file.name} ✕
            </button>
          ))}
          {photos.length > 0 ? <p className="faint">{s.photoPrivacy}</p> : null}
        </div>
      ) : null}

      {error ? <p role="alert">{error}</p> : null}
      {saved ? (
        <div>
          <p>✓ {saved}</p>
          <button type="button" className="btn brand" onClick={addAnother}>
            {s.addAnother}
          </button>{' '}
          <button type="button" className="btn soft" onClick={() => router.push(`/c/${groupId}`)}>
            {s.done}
          </button>
        </div>
      ) : (
        <button type="submit" className="btn brand" disabled={busy || !view.ready}>
          {busy ? s.saving : s.save}
        </button>
      )}
    </form>
  );
}
