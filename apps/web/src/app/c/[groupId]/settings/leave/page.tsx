'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';

import { CompanyPage } from '@/components/CompanyPage';
import { calendarStrings as s } from '@/lib/company/calendarStrings';
import {
  daysText,
  parseLimit,
  useLeaveTypeActions,
  useLeaveTypes,
  validAccrual,
  type MirrorLeaveType,
} from '@/lib/company/leave';
import { useCompanyView } from '@/lib/company/view';

function Check({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint ? <span className="faint"> · {hint}</span> : null}
      </span>
    </label>
  );
}

function Num({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span className="faint">{label}</span>
      <input
        value={value}
        inputMode="decimal"
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function TypeForm({
  groupId,
  type,
  suspended,
  onClose,
}: {
  groupId: string;
  type: MirrorLeaveType | null;
  suspended: boolean;
  onClose: () => void;
}) {
  const act = useLeaveTypeActions(groupId);
  const [name, setName] = useState(type?.name ?? '');
  const [accrual, setAccrual] = useState(type ? daysText(type.accrualPerMonth) : '1');
  const [carry, setCarry] = useState(type?.carryForward ?? true);
  const [carryCap, setCarryCap] = useState(
    type?.carryForwardCap != null ? daysText(type.carryForwardCap) : '',
  );
  const [annualCap, setAnnualCap] = useState(
    type?.annualCap != null ? daysText(type.annualCap) : '',
  );
  const [paid, setPaid] = useState(type?.paid ?? false);
  const [overdraw, setOverdraw] = useState(type?.allowOverdraw ?? false);
  const [active, setActive] = useState(type?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const a = parseLimit(accrual);
  const cc = parseLimit(carryCap);
  const ac = parseLimit(annualCap);
  const error = !name.trim()
    ? s.leaveErrName
    : !validAccrual(a)
      ? s.leaveErrAccrual
      : cc === undefined || ac === undefined
        ? s.leaveErrCap
        : null;
  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setFail(null);
    fn()
      .then(onClose)
      .catch((e: unknown) => setFail(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <form
      className="card"
      style={{ display: 'grid', gap: 8 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (error || !validAccrual(a)) return;
        run(() =>
          act.set({
            id: type?.id ?? crypto.randomUUID(),
            name: name.trim(),
            accrualPerMonth: a,
            carryForward: carry,
            carryForwardCap: carry ? (cc ?? null) : null,
            annualCap: ac ?? null,
            paid,
            allowOverdraw: overdraw,
            active,
          }),
        );
      }}
    >
      <h2>{type ? s.leaveTypeEdit : s.leaveTypeAdd}</h2>
      <label style={{ display: 'grid', gap: 4 }}>
        <span className="faint">{s.leaveTypeName}</span>
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      </label>
      <Num label={s.leaveAccrual} value={accrual} onChange={setAccrual} />
      <Check label={s.leaveCarry} hint={s.leaveCarryHint} value={carry} onChange={setCarry} />
      {carry ? (
        <Num
          label={s.leaveCarryCap}
          value={carryCap}
          onChange={setCarryCap}
          placeholder={s.leaveNoLimit}
        />
      ) : null}
      <Num
        label={s.leaveAnnualCap}
        value={annualCap}
        onChange={setAnnualCap}
        placeholder={s.leaveNoLimit}
      />
      <Check label={s.leavePaid} hint={s.leavePaidHint} value={paid} onChange={setPaid} />
      <Check
        label={s.leaveOverdraw}
        hint={s.leaveOverdrawHint}
        value={overdraw}
        onChange={setOverdraw}
      />
      <Check label={s.leaveActive} value={active} onChange={setActive} />
      {error || fail ? <p role="alert">{error ?? fail}</p> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn soft" onClick={onClose}>
          {s.cancel}
        </button>
        {type ? (
          <button
            type="button"
            className="btn soft"
            disabled={suspended || busy}
            onClick={() => run(() => act.remove({ id: type.id }))}
          >
            {s.remove}
          </button>
        ) : null}
        <button type="submit" className="btn brand" disabled={!!error || suspended || busy}>
          {s.save}
        </button>
      </div>
    </form>
  );
}

export default function LeavePolicyPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const view = useCompanyView(groupId);
  const types = useLeaveTypes(groupId);
  const [editing, setEditing] = useState<MirrorLeaveType | 'new' | null>(null);
  const summary = (x: MirrorLeaveType) =>
    [
      s.leavePerMonth.replace('{n}', daysText(x.accrualPerMonth)),
      x.carryForward ? s.leaveCarries : s.leaveResets,
      x.paid ? s.leavePaid : null,
      x.active ? null : s.leaveParked,
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <CompanyPage groupId={groupId} title={s.leavePolicy} back={`/c/${groupId}/settings`}>
      {!view.ready ? null : !view.isOwner ? (
        <p>{s.leaveOwnerOnly}</p>
      ) : (
        <>
          <p className="faint">{s.leavePolicyHint}</p>
          <section className="panel">
            {types.map((x) => (
              <div key={x.id} className="page-head">
                <span>
                  <b>{x.name}</b>
                  <br />
                  <span className="faint">{summary(x)}</span>
                </span>
                <button type="button" className="btn soft" onClick={() => setEditing(x)}>
                  {s.edit}
                </button>
              </div>
            ))}
            <button type="button" className="btn brand" onClick={() => setEditing('new')}>
              {s.leaveTypeAdd}
            </button>
          </section>
          {editing ? (
            <TypeForm
              key={editing === 'new' ? 'new' : editing.id}
              groupId={groupId}
              type={editing === 'new' ? null : editing}
              suspended={view.suspended}
              onClose={() => setEditing(null)}
            />
          ) : null}
        </>
      )}
    </CompanyPage>
  );
}
