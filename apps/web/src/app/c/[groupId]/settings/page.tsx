'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import {
  companyTagLabel,
  formatMinorInput,
  materialiseCompanyProjects,
  materialiseWageSplits,
  MutationKind,
  packTags,
  parseCompanyPolicies,
  parseMinorInput,
  projectSpend,
  type CompanyIndustry,
  type CurrencyCode,
} from '@waves/core';

import { CompanyPage, useCompanyText } from '@/components/CompanyPage';
import { fill } from '@/i18n';
import {
  addDepartment,
  applyPack,
  calendarSettingsPayload,
  flipEffect,
  logoPath,
  mileagePayload,
  newLimitRule,
  newReceiptRule,
  parseCompanyTags,
  parseDepartments,
  policiesPayload,
  projectPayload,
  removeDepartment,
  renameDepartment,
  renameTag,
  secondApprovalPayload,
  settingsPayload,
  tagsPayload,
  toggleTagHidden,
} from '@/lib/company/settings';
import { useCompanyView } from '@/lib/company/view';
import { NO_QUEUE, useSync } from '@/lib/sync';
import { putImage } from '@/lib/upload';
import { supabase, waves } from '@/lib/waves';

const INDUSTRIES: CompanyIndustry[] = ['construction', 'transport', 'field_sales'];
const pretty = (s: string) => s.replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase());

interface GroupExtra {
  company_default_daily_rate_minor?: string | null;
  company_default_mileage_rate_minor?: string | null;
  company_approvals_enabled?: boolean;
  company_second_approval?: boolean;
  company_second_approval_threshold_minor?: string | null;
  company_policy_revision?: number;
  company_paid_holidays?: boolean;
  company_paid_leave?: boolean;
  company_departments?: unknown;
  company_tags?: unknown;
  company_industry?: CompanyIndustry | null;
  photo_path?: string | null;
}

function Toggle({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="row-field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input type="checkbox" checked={value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint ? (
          <>
            <br />
            <span className="faint">{hint}</span>
          </>
        ) : null}
      </span>
    </label>
  );
}

/** A label, the current text, and an inline editor: blank saves null where the setting allows it. */
function TextRow({ label, hint, shown, initial, onSave, disabled, saveLabel, editLabel, cancelLabel }: { label: string; hint?: string; shown: string; initial: string; onSave: (text: string) => void; disabled?: boolean; saveLabel: string; editLabel: string; cancelLabel: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initial);
  return (
    <div className="row-field" style={{ display: 'grid', gap: 4 }}>
      <span>
        <b>{label}</b>: {shown}
        {hint ? <span className="faint"> · {hint}</span> : null}
      </span>
      {editing ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" aria-label={label} />
          <button type="button" className="btn brand" disabled={disabled} onClick={() => { setEditing(false); onSave(text); }}>
            {saveLabel}
          </button>
          <button type="button" className="btn soft" onClick={() => setEditing(false)}>
            {cancelLabel}
          </button>
        </div>
      ) : (
        <span>
          <button type="button" className="btn soft" disabled={disabled} onClick={() => { setText(initial); setEditing(true); }}>
            {editLabel}
          </button>
        </span>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default function CompanySettingsPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const router = useRouter();
  const view = useCompanyView(groupId);
  const { mirror, mutate, refresh } = useSync();
  const { t, fmt, err } = useCompanyText(view.currency);
  const s = t.company.settings;
  const docs = t.company.docs;
  const currency = view.currency as CurrencyCode;
  const g = (view.group ?? {}) as GroupExtra & { name?: string | null };
  const owner = view.isOwner;
  const readOnly = view.suspended;
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // One place for a write: run it, pull the result in, say why if it failed.
  const run = useCallback(
    async (work: () => Promise<unknown>, done?: string) => {
      setBusy(true);
      setError('');
      setNote('');
      try {
        const result = await work();
        await refresh();
        if (done && result !== false) setNote(done);
      } catch (caught) {
        setError(err(caught, 'settings'));
      } finally {
        setBusy(false);
      }
    },
    [err, refresh],
  );
  const send = (kind: MutationKind, payload: Record<string, unknown>, done?: string) =>
    run(() => mutate(kind, groupId, payload), done);
  const minorOrNull = (text: string): string | null | undefined => {
    if (text.trim() === '') return null;
    try {
      return parseMinorInput(text, currency).toString();
    } catch {
      return undefined;
    }
  };
  const shownMoney = (v: string | null | undefined) => (v ? fmt(BigInt(v)) : s.rateNotSet);
  const initialMoney = (v: string | null | undefined) => (v ? formatMinorInput(BigInt(v), currency) : '');
  const rowProps = { saveLabel: s.save, editLabel: s.edit, cancelLabel: s.cancel, disabled: busy || readOnly };

  // ── name ──
  const [draftName, setName] = useState<string | null>(null);
  const name = draftName ?? g.name ?? '';

  // ── logo ──
  const saveLogo = (file: File | undefined) => {
    if (!file) return;
    void run(async () => {
      if (!file.type.startsWith('image/')) throw new Error('not an image');
      // Ask first, like the phone: a logo is a paid feature and the server would refuse the link.
      const { data: allowed } = await supabase.rpc('waves_can_upload_group_photo', { p_group_id: groupId });
      if (allowed !== true) {
        setError(s.logoLocked);
        return false;
      }
      const path = logoPath(groupId, file.type);
      await putImage({ bucket: 'group-photos', path, body: file, contentType: file.type, groupId });
      const { error: linkError } = await supabase.from('groups').update({ photo_path: path }).eq('id', groupId);
      if (linkError) throw new Error(linkError.message);
    }, s.logoSaved);
  };
  const removeLogo = () =>
    run(async () => {
      const { error: linkError } = await supabase.from('groups').update({ photo_path: null }).eq('id', groupId);
      if (linkError) throw new Error(linkError.message);
    });

  // ── rules ──
  const ownerCount = view.members.filter((m) => m.role === 'admin' && !m.left_at).length;
  const secondOn = g.company_second_approval === true;
  const threshold = g.company_second_approval_threshold_minor ?? null;
  const policies = useMemo(() => parseCompanyPolicies((view.group as { company_policies?: unknown } | null)?.company_policies), [view.group]);
  const revision = g.company_policy_revision ?? 0;
  const tags = useMemo(() => parseCompanyTags(g.company_tags), [g.company_tags]);
  const usedKeys = useMemo(() => new Set(view.entries.flatMap((x) => (x.category ? [x.category] : []))), [view.entries]);
  const tagLabel = (key: string) => (key === 'allowance' ? s.bata : companyTagLabel(key, tags));
  const [limitDraft, setLimitDraft] = useState({ target: 'allowance', period: 'day' as 'day' | 'month', amount: '' });
  const [receiptDraft, setReceiptDraft] = useState('');
  const commitRules = (rules: Parameters<typeof policiesPayload>[0]) =>
    send(MutationKind.CompanyPoliciesSet, policiesPayload(rules, revision));

  // ── departments ──
  const departments = useMemo(() => parseDepartments(g.company_departments), [g.company_departments]);
  const [deptName, setDeptName] = useState('');
  const saveDepartments = (next: ReturnType<typeof addDepartment>) => {
    if (!next) return setError(s.departmentNameError);
    void send(MutationKind.CompanyDepartmentsSet, { departments: next });
  };

  // ── sites ──
  const projects = useMemo(
    () => materialiseCompanyProjects(mirror, NO_QUEUE, { groupId }).filter((p) => !p.archived_at),
    [mirror, groupId],
  );
  const spend = useMemo(
    () => projectSpend(view.entries, materialiseWageSplits(mirror, NO_QUEUE, { groupId })),
    [view.entries, mirror, groupId],
  );
  const [siteName, setSiteName] = useState('');

  // ── tags ──
  const [tagName, setTagName] = useState('');
  const [editingTag, setEditingTag] = useState<{ key: string; text: string } | null>(null);
  const saveTags = (next: typeof tags, industry: CompanyIndustry | null) =>
    send(MutationKind.CompanyTagsSet, tagsPayload(next, industry));

  const leaveOrDelete = async (kind: 'leave' | 'delete') => {
    if (!window.confirm(kind === 'leave' ? s.leaveConfirm : s.deleteConfirm)) return;
    await run(async () => {
      if (kind === 'delete') await waves.deleteGroup(groupId);
      else if (view.me) await waves.leaveGroup(view.me.id);
      router.replace('/groups');
    });
  };

  return (
    <CompanyPage groupId={groupId} title={s.title}>
      {!view.ready ? null : (
        <>
          {readOnly ? <p className="muted">{t.company.common.suspended}</p> : null}
          {error ? <p className="error" role="alert">{error}</p> : null}
          {note ? <p role="status">{note}</p> : null}

          {view.isAdmin ? (
            <Section title={s.nameLabel}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label={s.nameLabel} />
                <button
                  type="button"
                  className="btn brand"
                  disabled={busy || readOnly || !name.trim() || name.trim() === g.name}
                  onClick={() => void run(() => waves.updateGroup(groupId, { name: name.trim() }), s.saved)}
                >
                  {s.save}
                </button>
              </div>
            </Section>
          ) : null}

          {view.isAdmin ? (
            <Section title={s.logoRow}>
              <input type="file" accept="image/*" disabled={busy || readOnly} onChange={(e) => saveLogo(e.target.files?.[0])} aria-label={s.logoUpload} />
              {g.photo_path ? (
                <button type="button" className="btn soft" disabled={busy || readOnly} onClick={() => void removeLogo()}>
                  {s.logoRemove}
                </button>
              ) : null}
            </Section>
          ) : null}

          <Section title={s.title}>
            <p>
              <Link className="btn soft" href={`/c/${groupId}/import`}>{s.import}</Link>{' '}
              <Link className="btn soft" href={`/c/${groupId}/export`}>{s.export}</Link>{' '}
              <Link className="btn soft" href={`/c/${groupId}/storage`}>{s.storage}</Link>{' '}
              <Link className="btn soft" href={`/c/${groupId}/bills`}>{docs.title}</Link>
            </p>
          </Section>

          {owner ? (
            <>
              <Section title={s.companyRulesTitle}>
                <Toggle
                  label={s.approvalsTitle}
                  hint={s.approvalsHint}
                  value={g.company_approvals_enabled === true}
                  disabled={busy || readOnly}
                  onChange={(v) => void send(MutationKind.CompanySettingsSet, settingsPayload(g, { approvalsEnabled: v }))}
                />
                <Toggle
                  label={s.paidHolidays}
                  hint={s.paidHolidaysHint}
                  value={g.company_paid_holidays !== false}
                  disabled={busy || readOnly}
                  onChange={(v) => void send(MutationKind.CompanyCalendarSettingsSet, calendarSettingsPayload(v, g.company_paid_leave === true))}
                />
                <Toggle
                  label={s.paidLeave}
                  hint={s.paidLeaveHint}
                  value={g.company_paid_leave === true}
                  disabled={busy || readOnly}
                  onChange={(v) => void send(MutationKind.CompanyCalendarSettingsSet, calendarSettingsPayload(g.company_paid_holidays !== false, v))}
                />
              </Section>

              <Section title={s.moreSettings}>
                {g.company_approvals_enabled === true && ownerCount > 1 ? (
                  <>
                    <Toggle
                      label={s.secondOwnerTitle}
                      hint={s.secondOwnerHint}
                      value={secondOn}
                      disabled={busy || readOnly}
                      onChange={(v) => void send(MutationKind.CompanySecondApprovalSet, secondApprovalPayload(v, threshold))}
                    />
                    {secondOn ? (
                      <TextRow
                        label={s.secondOwnerFrom}
                        hint={s.secondOwnerFromHint}
                        shown={shownMoney(threshold)}
                        initial={initialMoney(threshold)}
                        {...rowProps}
                        onSave={(text) => {
                          const v = minorOrNull(text);
                          if (v !== undefined) void send(MutationKind.CompanySecondApprovalSet, secondApprovalPayload(true, v));
                        }}
                      />
                    ) : null}
                  </>
                ) : null}
                <TextRow
                  label={s.dailyRate}
                  hint={s.dailyRateHint}
                  shown={shownMoney(g.company_default_daily_rate_minor)}
                  initial={initialMoney(g.company_default_daily_rate_minor)}
                  {...rowProps}
                  onSave={(text) => {
                    const v = minorOrNull(text);
                    if (v !== undefined) void send(MutationKind.CompanySettingsSet, settingsPayload(g, { defaultDailyRateMinor: v }));
                  }}
                />
                <TextRow
                  label={s.mileageRate}
                  hint={s.mileageRateHint}
                  shown={shownMoney(g.company_default_mileage_rate_minor)}
                  initial={initialMoney(g.company_default_mileage_rate_minor)}
                  {...rowProps}
                  onSave={(text) => {
                    const v = minorOrNull(text);
                    if (v !== undefined) void send(MutationKind.CompanyMileageRateSet, mileagePayload(v));
                  }}
                />
              </Section>

              <Section title={s.policiesTitle}>
                <p className="faint">{s.policiesHint}</p>
                {policies.rules.length === 0 ? <p className="muted">{s.policyNone}</p> : null}
                {policies.rules.map((rule) => (
                  <div key={rule.id} className="row">
                    <span>
                      {rule.type === 'receipt_above'
                        ? fill(s.policyReceipt, { amount: fmt(BigInt(rule.limitMinor)) })
                        : fill(s.policyLimit, {
                            what: tagLabel(rule.target),
                            amount: fmt(BigInt(rule.limitMinor)),
                            period: rule.period === 'day' ? s.perDay : s.perMonth,
                          })}
                      <br />
                      <span className="faint">{rule.effect === 'block' ? s.policyBlock : s.policyWarn}</span>
                    </span>
                    <span>
                      {rule.type === 'period_limit' ? (
                        <button type="button" className="btn soft" disabled={busy || readOnly} onClick={() => void commitRules(flipEffect(policies.rules, rule.id))}>
                          {rule.effect === 'warn' ? s.policyBlock : s.policyWarn}
                        </button>
                      ) : null}{' '}
                      <button type="button" className="btn soft" disabled={busy || readOnly} onClick={() => void commitRules(policies.rules.filter((r) => r.id !== rule.id))}>
                        {s.policyRemove}
                      </button>
                    </span>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input value={receiptDraft} onChange={(e) => setReceiptDraft(e.target.value)} placeholder={s.amountPlaceholder} inputMode="decimal" aria-label={s.policyAddReceipt} />
                  <button
                    type="button"
                    className="btn soft"
                    disabled={busy || readOnly}
                    onClick={() => {
                      const v = minorOrNull(receiptDraft);
                      if (!v || BigInt(v) <= 0n) return;
                      setReceiptDraft('');
                      void commitRules([...policies.rules, newReceiptRule(crypto.randomUUID(), BigInt(v))]);
                    }}
                  >
                    {s.policyAddReceipt}
                  </button>
                </div>
                <p className="faint">{s.policyEditorHint}</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <select value={limitDraft.target} onChange={(e) => setLimitDraft({ ...limitDraft, target: e.target.value })} aria-label={s.formCategory}>
                    <option value="allowance">{s.bata}</option>
                    {tags.filter((x) => !x.hidden).map((x) => (
                      <option key={x.key} value={x.key}>{x.label}</option>
                    ))}
                  </select>
                  <select value={limitDraft.period} onChange={(e) => setLimitDraft({ ...limitDraft, period: e.target.value as 'day' | 'month' })} aria-label={s.policyPeriod}>
                    <option value="day">{s.perDay}</option>
                    <option value="month">{s.perMonth}</option>
                  </select>
                  <input value={limitDraft.amount} onChange={(e) => setLimitDraft({ ...limitDraft, amount: e.target.value })} placeholder={s.amountPlaceholder} inputMode="decimal" aria-label={s.policyLimitLabel} />
                  <button
                    type="button"
                    className="btn soft"
                    disabled={busy || readOnly}
                    onClick={() => {
                      const v = minorOrNull(limitDraft.amount);
                      if (!v || BigInt(v) <= 0n) return;
                      setLimitDraft({ ...limitDraft, amount: '' });
                      void commitRules([...policies.rules, newLimitRule(crypto.randomUUID(), limitDraft.target, limitDraft.period, BigInt(v))]);
                    }}
                  >
                    {s.policyAddLimit}
                  </button>
                </div>
              </Section>

              <Section title={s.departments}>
                {departments.length === 0 ? <p className="muted">{s.departmentNone}</p> : null}
                {departments.map((d) => (
                  <div key={d.id} className="row">
                    <span>{d.name}</span>
                    <span>
                      <button
                        type="button"
                        className="btn soft"
                        disabled={busy || readOnly}
                        onClick={() => {
                          const next = window.prompt(s.departmentRename, d.name);
                          if (next !== null) saveDepartments(renameDepartment(departments, d.id, next));
                        }}
                      >
                        {s.departmentRename}
                      </button>{' '}
                      <button
                        type="button"
                        className="btn soft"
                        disabled={busy || readOnly}
                        onClick={() => window.confirm(`${s.departmentRemove}: ${d.name}`) && saveDepartments(removeDepartment(departments, d.id))}
                      >
                        {s.departmentRemove}
                      </button>
                    </span>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={deptName} onChange={(e) => setDeptName(e.target.value)} maxLength={40} aria-label={s.departmentAdd} />
                  <button
                    type="button"
                    className="btn soft"
                    disabled={busy || readOnly}
                    onClick={() => {
                      saveDepartments(addDepartment(departments, deptName, crypto.randomUUID()));
                      setDeptName('');
                    }}
                  >
                    {s.departmentAdd}
                  </button>
                </div>
              </Section>

              <Section title={s.sites}>
                {projects.length === 0 ? <p className="muted">{s.noSites}</p> : null}
                {projects.map((p) => {
                  const spent = spend.get(p.id) ?? 0n;
                  const budget = p.budget_minor ? BigInt(p.budget_minor) : null;
                  return (
                    <TextRow
                      key={p.id}
                      label={p.name}
                      shown={
                        budget === null
                          ? fill(s.siteSpentOnly, { spent: fmt(spent) })
                          : spent > budget
                            ? fill(s.siteOver, { amount: fmt(spent - budget) })
                            : fill(s.siteLeft, { amount: fmt(budget - spent) })
                      }
                      hint={s.siteBudget}
                      initial={budget === null ? '' : formatMinorInput(budget, currency)}
                      {...rowProps}
                      onSave={(text) => {
                        const v = minorOrNull(text);
                        if (v !== undefined)
                          void send(MutationKind.CompanyProjectSet, projectPayload({ projectId: p.id, name: p.name, budgetMinor: v, archived: false }));
                      }}
                    />
                  );
                })}
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder={s.siteName} aria-label={s.siteName} />
                  <button
                    type="button"
                    className="btn soft"
                    disabled={busy || readOnly || !siteName.trim()}
                    onClick={() => {
                      const n = siteName.trim();
                      setSiteName('');
                      void send(MutationKind.CompanyProjectSet, projectPayload({ projectId: crypto.randomUUID(), name: n, budgetMinor: null, archived: false }));
                    }}
                  >
                    {s.siteAdd}
                  </button>
                </div>
              </Section>
            </>
          ) : null}

          {view.isAdmin ? (
            <Section title={s.tagsTitle}>
              <p className="faint">{s.tagsShared}</p>
              {tags.length === 0 ? <p className="muted">{s.tagsEmpty}</p> : null}
              {tags.map((tag) => (
                <div key={tag.key} className="row">
                  {editingTag?.key === tag.key ? (
                    <span style={{ display: 'flex', gap: 8 }}>
                      <input value={editingTag.text} onChange={(e) => setEditingTag({ key: tag.key, text: e.target.value })} maxLength={40} aria-label={s.tagRename} />
                      <button type="button" className="btn brand" disabled={busy || !editingTag.text.trim()} onClick={() => { void saveTags(renameTag(tags, tag.key, editingTag.text), g.company_industry ?? null); setEditingTag(null); }}>
                        {s.tagSave}
                      </button>
                    </span>
                  ) : (
                    <>
                      <span className={tag.hidden ? 'faint' : undefined}>{tag.unit ? `${tag.label} · ${tag.unit}` : tag.label}</span>
                      {owner ? (
                        <span>
                          <button type="button" className="btn soft" disabled={busy || readOnly} onClick={() => setEditingTag({ key: tag.key, text: tag.label })}>
                            {s.tagRename}
                          </button>{' '}
                          <button type="button" className="btn soft" disabled={busy || readOnly} onClick={() => void saveTags(toggleTagHidden(tags, tag.key), g.company_industry ?? null)}>
                            {tag.hidden ? s.tagShow : s.tagHide}
                          </button>
                        </span>
                      ) : null}
                    </>
                  )}
                </div>
              ))}
              {owner ? (
                <>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={tagName} onChange={(e) => setTagName(e.target.value)} placeholder={s.tagNamePh} maxLength={40} aria-label={s.tagNew} />
                    <button
                      type="button"
                      className="btn soft"
                      disabled={busy || readOnly || !tagName.trim()}
                      onClick={() => {
                        const label = tagName.trim().slice(0, 40);
                        if (tags.some((x) => x.label.toLowerCase() === label.toLowerCase())) return setTagName('');
                        // The server owns key validity; this slug stays inside the key pattern.
                        let key = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'tag';
                        for (let n = 2; tags.some((x) => x.key === key); n += 1) key = `${key.slice(0, 33)}-${n}`;
                        setTagName('');
                        void send(MutationKind.CompanyTagAdd, { key, label });
                      }}
                    >
                      {s.tagAdd}
                    </button>
                  </div>
                  <p className="field-label">{s.industryTitle}</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {INDUSTRIES.map((id) => {
                      const have = new Set(tags.map((x) => x.key));
                      const missing = packTags(id).filter((p) => !have.has(p.key)).length;
                      return (
                        <button
                          key={id}
                          type="button"
                          className="btn soft"
                          disabled={busy || readOnly || missing === 0}
                          onClick={() => {
                            const next = applyPack(tags, g.company_industry ?? null, id, usedKeys);
                            void saveTags(next.tags, next.industry);
                          }}
                        >
                          {missing > 0 ? `${pretty(id)} · ${fill(s.packAdd, { n: missing })}` : pretty(id)}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </Section>
          ) : null}

          {owner ? <AgentAccess groupId={groupId} /> : null}

          <Section title={s.leaveCompany}>
            {!owner ? (
              <button type="button" className="btn soft" disabled={busy} onClick={() => void leaveOrDelete('leave')}>
                {s.leaveCompany}
              </button>
            ) : (
              <button type="button" className="btn soft" disabled={busy || readOnly} onClick={() => void leaveOrDelete('delete')}>
                {s.deleteCompany}
              </button>
            )}
          </Section>
        </>
      )}
    </CompanyPage>
  );
}

interface AgentState {
  enabled: boolean;
  approval: boolean;
  links: { id: string; name: string; clientId: string; lastUsedAt: string | null }[];
}
interface AgentWrite {
  id: string;
  person: string;
  action: string;
  created_at: string;
}

function AgentAccess({ groupId }: { groupId: string }) {
  const { t } = useCompanyText('INR');
  const s = t.company.settings;
  const [state, setState] = useState<AgentState | null>(null);
  const [writes, setWrites] = useState<AgentWrite[] | null>(null);
  const [showActivity, setShowActivity] = useState(false);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);

  const load = () => setVersion((v) => v + 1);
  useEffect(() => {
    let live = true;
    void supabase.rpc('waves_company_agent_links_list', { p_group_id: groupId }).then(({ data, error }) => {
      if (!live) return;
      if (error) setFailed(true);
      else setState(data as AgentState);
    });
    return () => {
      live = false;
    };
  }, [groupId, version]);
  useEffect(() => {
    if (!showActivity) return;
    void supabase.rpc('waves_company_agent_writes', { p_group_id: groupId, p_limit: 30 }).then(({ data }) => setWrites((data ?? []) as AgentWrite[]));
  }, [showActivity, groupId]);

  if (failed || !state) return null;
  const save = async (next: { enabled: boolean; approval: boolean }) => {
    await supabase.rpc('waves_company_agent_settings_set', { p_group_id: groupId, p_enabled: next.enabled, p_approval: next.approval });
    load();
  };
  const revoke = async (id: string) => {
    if (!window.confirm(s.agentsRevokeConfirm)) return;
    await supabase.rpc('waves_company_agent_link_revoke', { p_link_id: id });
    load();
  };
  return (
    <Section title={s.agentsTitle}>
      <Toggle label={s.agentsAllow} hint={s.agentsAllowHint} value={state.enabled} onChange={(v) => void save({ enabled: v, approval: state.approval })} />
      {state.enabled ? (
        <>
          <Toggle label={s.agentsApproval} hint={s.agentsApprovalHint} value={state.approval} onChange={(v) => void save({ enabled: state.enabled, approval: v })} />
          <p className="field-label">{s.agentsConnected}</p>
          {state.links.length === 0 ? <p className="muted">{s.agentsEmpty}</p> : null}
          {state.links.map((l) => (
            <div key={l.id} className="row">
              <span>
                {l.name} · {l.clientId}
                <br />
                <span className="faint">
                  {l.lastUsedAt ? fill(s.agentsLastUsed, { when: new Date(l.lastUsedAt).toLocaleDateString() }) : s.agentsNeverUsed}
                </span>
              </span>
              <button type="button" className="btn soft" onClick={() => void revoke(l.id)}>
                {s.agentsRevoke}
              </button>
            </div>
          ))}
          <button type="button" className="btn soft" onClick={() => setShowActivity(!showActivity)}>
            {s.agentsActivity}
          </button>
          {showActivity ? (
            writes && writes.length === 0 ? (
              <p className="muted">{s.agentsActivityEmpty}</p>
            ) : (
              (writes ?? []).map((w) => (
                <p key={w.id} className="faint">
                  {new Date(w.created_at).toLocaleString()} · {w.person} · {w.action}
                </p>
              ))
            )
          ) : null}
        </>
      ) : null}
    </Section>
  );
}
