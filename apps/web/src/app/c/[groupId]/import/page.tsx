'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

import {
  buildImportRows,
  countRows,
  ENTITY_FIELDS,
  materialiseClients,
  materialiseVendors,
  dialingCodeForCountry,
  matchColumns,
  templateCsv,
  toCsv,
  type ColumnMapping,
  type ImportEntity,
  type ImportFieldKey,
  type ImportRow,
  type TableRead,
} from '@waves/core';

import { CompanyPage, useCompanyText } from '@/components/CompanyPage';
import { fill } from '@/i18n';
import { fetchSheetTable, ImportFileError, tableFromBytes, writeImportRow } from '@/lib/company/import';
import { downloadText } from '@/lib/company/print';
import { parseDepartments } from '@/lib/company/settings';
import { todayIso, useCompanyView } from '@/lib/company/view';
import { NO_QUEUE, useSync } from '@/lib/sync';

type Step = 'what' | 'source' | 'columns' | 'preview' | 'done';

export default function CompanyImportPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const view = useCompanyView(groupId);
  const { mirror, mutate } = useSync();
  const { t } = useCompanyText(view.currency);
  const g = t.company.docs.import;
  const [step, setStep] = useState<Step>('what');
  const [entity, setEntity] = useState<ImportEntity>('employee');
  const [table, setTable] = useState<TableRead | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [sheetLink, setSheetLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState<ReadonlySet<number>>(new Set());
  // The error file of the last run, kept until the next run so "start over" cannot lose it.
  const [lastErrors, setLastErrors] = useState<string | null>(null);

  const allowed = view.isAdmin && !view.suspended;
  const fields = ENTITY_FIELDS[entity].filter((f) => view.isOwner || (f !== 'manager' && f !== 'dailyRate'));
  const label: Record<ImportFieldKey, string> = {
    name: g.fName,
    phone: g.fPhone,
    employeeId: g.fEmployeeId,
    department: g.fDepartment,
    manager: g.fManager,
    joinedOn: g.fJoinedOn,
    dailyRate: g.fDailyRate,
    need: g.fNeed,
    source: g.fSource,
    address: g.fAddress,
    expectedValue: g.fExpectedValue,
    stage: g.fStage,
    category: g.fCategory,
    openingBalance: g.fOpeningBalance,
  };
  const departments = useMemo(
    () => parseDepartments((view.group as { company_departments?: unknown } | null)?.company_departments),
    [view.group],
  );

  const rows = useMemo<ImportRow[]>(() => {
    if (!table || mapping.name === undefined) return [];
    const live = view.members.filter((m) => !m.left_at);
    const nameOf = (m: (typeof live)[number]): string => m.profile?.display_name ?? m.ghost_name ?? '';
    const existing =
      entity === 'employee'
        ? live.map((m) => ({ name: nameOf(m), phone: (m as { invite_phone?: string | null }).invite_phone ?? null }))
        : entity === 'client'
          ? materialiseClients(mirror, NO_QUEUE, { groupId }).clients.map((c) => ({ name: c.name, phone: c.phone }))
          : materialiseVendors(mirror, NO_QUEUE, {
            groupId,
            myMemberId: view.me?.id ?? null,
            isVendor: view.isVendor,
            isManager: view.isManager,
          }).vendors.map((v) => ({ name: v.name, phone: v.phone ?? null }));
    return buildImportRows(table.rows.slice(1), table.lines.slice(1), mapping, {
      entity,
      groupId,
      currency: view.currency as 'INR',
      dialCode: dialingCodeForCountry(view.group?.country_code) ?? '+91',
      existing: existing.filter((e) => e.name),
      existingEmployeeIds: live.flatMap((m) => ((m as { employee_id?: string | null }).employee_id ? [(m as { employee_id: string }).employee_id] : [])),
      departments,
      people: live.map((m) => ({ id: m.id, name: nameOf(m) })).filter((p) => p.name),
    });
  }, [table, mapping, entity, groupId, view.members, view.currency, view.group, view.me?.id, view.isVendor, view.isManager, mirror, departments]);
  const counts = countRows(rows);
  const warned = rows.filter((r) => r.status === 'new' && r.warnings.length > 0).length;

  const problemText = (r: ImportRow): string => {
    if (failed.has(r.line)) return g.pFailed;
    switch (r.problem) {
      case 'name_missing':
        return g.pName;
      case 'phone_invalid':
        return g.pPhone;
      case 'date_invalid':
        return g.pDate;
      case 'amount_invalid':
        return g.pAmount;
      case 'amount_negative':
        return g.pNegative;
      case 'duplicate_in_file':
        return g.pDupFile;
      default:
        return g.pDupExisting;
    }
  };

  const loaded = (next: TableRead): void => {
    if (next.rows.length < 2) return setMessage(g.noRows);
    setTable(next);
    setMapping(matchColumns(next.rows[0] ?? [], entity));
    setMessage(null);
    setStep('columns');
  };
  const failure = (caught: unknown): string => {
    const f = caught instanceof ImportFileError ? caught.failure : 'unreadable';
    return (
      {
        too_large: g.fileTooLarge,
        too_many_rows: g.fileTooMany,
        empty: g.fileEmpty,
        encoding: g.fileEncoding,
        bad_link: g.sheetBad,
        private: g.sheetPrivate,
        network: g.sheetNetwork,
      } as Record<string, string>
    )[f] ?? g.fileUnreadable;
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      loaded(tableFromBytes(new Uint8Array(await file.arrayBuffer()), file.name));
    } catch (caught) {
      setMessage(failure(caught));
    } finally {
      setBusy(false);
    }
  };
  const readSheet = async () => {
    setBusy(true);
    setMessage(null);
    try {
      loaded(await fetchSheetTable(sheetLink));
    } catch (caught) {
      setMessage(failure(caught));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setProgress(0);
    setLastErrors(null);
    const todo = rows.filter((r) => r.status === 'new');
    const bad = new Set<number>();
    for (let i = 0; i < todo.length; i += 1) {
      try {
        await writeImportRow(mutate, groupId, entity, todo[i]!, {
          owner: view.isOwner,
          myMemberId: view.me?.id ?? null,
          today: todayIso(),
        });
      } catch {
        bad.add(todo[i]!.line);
      }
      setProgress(i + 1);
    }
    setFailed(bad);
    const bounced = rows.filter((r) => r.status === 'error' || bad.has(r.line));
    setLastErrors(
      bounced.length === 0
        ? null
        : `\uFEFF${toCsv([[g.errCsvRow, g.errCsvProblem, ...(table?.rows[0] ?? [])], ...bounced.map((r) => [String(r.line), bad.has(r.line) ? g.pFailed : problemText(r), ...r.cells])])}`,
    );
    setBusy(false);
    setStep('done');
  };

  const errorRows = rows.filter((r) => r.status === 'error' || failed.has(r.line));
  const downloadErrors = () =>
    downloadText(
      'waves-import-errors.csv',
      `﻿${toCsv([[g.errCsvRow, g.errCsvProblem, ...(table?.rows[0] ?? [])], ...errorRows.map((r) => [String(r.line), problemText(r), ...r.cells])])}`,
      'text/csv',
    );

  const entityName = { employee: g.employees, client: g.clients, vendor: g.vendors }[entity];

  return (
    <CompanyPage groupId={groupId} title={g.title}>
      {!view.ready ? null : !allowed ? (
        <p className="muted">{g.noAccess}</p>
      ) : (
        <section className="panel">
          {step === 'what' ? (
            <>
              <h2>{g.whatTitle}</h2>
              {lastErrors ? (
                <button type="button" className="btn soft" onClick={downloadErrors}>
                  {g.downloadErrors}
                </button>
              ) : null}
              {(
                [
                  ['employee', g.employees, g.employeesSub],
                  ['client', g.clients, g.clientsSub],
                  ['vendor', g.vendors, g.vendorsSub],
                ] as const
              ).map(([key, title, sub]) => (
                <button
                  key={key}
                  type="button"
                  className="row"
                  onClick={() => {
                    setEntity(key);
                    setStep('source');
                  }}
                >
                  <span>
                    <b>{title}</b>
                    <br />
                    <span className="faint">{sub}</span>
                  </span>
                </button>
              ))}
            </>
          ) : null}

          {step === 'source' ? (
            <>
              <h2>
                {entityName} · {g.sourceTitle}
              </h2>
              <label className="field">
                <span className="field-label">
                  {g.srcFile} - {g.srcFileSub}
                </span>
                <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={(e) => void pickFile(e.target.files?.[0])} />
              </label>
              <label className="field">
                <span className="field-label">
                  {g.srcSheet} - {g.srcSheetSub}
                </span>
                <input value={sheetLink} onChange={(e) => setSheetLink(e.target.value)} placeholder={g.sheetPlaceholder} />
              </label>
              <button type="button" className="btn brand" disabled={busy || !sheetLink.trim()} onClick={() => void readSheet()}>
                {g.sheetGo}
              </button>{' '}
              <button
                type="button"
                className="btn soft"
                onClick={() => downloadText(`waves-${entity}-template.csv`, `﻿${templateCsv(entity)}`, 'text/csv')}
              >
                {g.template}
              </button>
              <p>
                <button type="button" className="btn soft" onClick={() => setStep('what')}>
                  {g.back}
                </button>
              </p>
            </>
          ) : null}

          {step === 'columns' && table ? (
            <>
              <h2>{g.columnsTitle}</h2>
              <p className="muted">{g.columnsHint}</p>
              {fields.map((field) => (
                <label key={field} className="field">
                  <span className="field-label">{label[field]}</span>
                  <select
                    value={mapping[field] ?? ''}
                    onChange={(e) => {
                      const next = { ...mapping };
                      if (e.target.value === '') delete next[field];
                      else next[field] = Number(e.target.value);
                      setMapping(next);
                    }}
                  >
                    <option value="">{g.none}</option>
                    {(table.rows[0] ?? []).map((h, i) => (
                      <option key={i} value={i}>
                        {h || `#${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <button type="button" className="btn soft" onClick={() => setStep('source')}>
                {g.back}
              </button>{' '}
              <button type="button" className="btn brand" disabled={mapping.name === undefined} onClick={() => setStep('preview')}>
                {g.next}
              </button>
            </>
          ) : null}

          {step === 'preview' ? (
            <>
              <h2>{g.previewTitle}</h2>
              <p>{fill(g.cNew, { n: String(counts.added) })}</p>
              <p>{fill(g.cDup, { n: String(counts.duplicates) })}</p>
              <p>{fill(g.cErr, { n: String(counts.errors) })}</p>
              {warned > 0 ? <p className="faint">{fill(g.warnLine, { n: String(warned) })}</p> : null}
              {errorRows.slice(0, 20).map((r) => (
                <p key={r.line} className="error">
                  {r.line}: {r.cells[mapping.name ?? 0] || '-'} - {problemText(r)}
                </p>
              ))}
              {busy ? <p>{fill(g.progress, { done: String(progress), total: String(counts.added) })}</p> : null}
              <button type="button" className="btn soft" disabled={busy} onClick={() => setStep('columns')}>
                {g.back}
              </button>{' '}
              <button type="button" className="btn brand" disabled={busy || counts.added === 0} onClick={() => void run()}>
                {fill(g.importN, { n: String(counts.added) })}
              </button>
            </>
          ) : null}

          {step === 'done' ? (
            <>
              <h2>{g.resultTitle}</h2>
              <p>
                {fill(g.resultLine, {
                  added: String(counts.added - failed.size),
                  dups: String(counts.duplicates),
                  errors: String(counts.errors + failed.size),
                })}
              </p>
              {lastErrors ? (
                <button type="button" className="btn soft" onClick={downloadErrors}>
                  {g.downloadErrors}
                </button>
              ) : null}{' '}
              <button type="button" className="btn brand" onClick={() => { setStep('what'); setTable(null); setFailed(new Set()); }}>
                {g.done}
              </button>
            </>
          ) : null}
          {message ? (
            <p className="error" role="alert">
              {message}
            </p>
          ) : null}
        </section>
      )}
    </CompanyPage>
  );
}
