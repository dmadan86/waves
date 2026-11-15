/**
 * Company import for the browser: a CSV file or a public Google Sheet becomes the
 * shared table the @waves/core parsers work on, and an import's `new` rows are
 * written with the same mutations the add screens use.
 *
 * shortcut: .xlsx files are refused (xlsx is not a web dependency yet), save as CSV; add
 * xlsx and a tableFromWorkbook like the phone's lib/groupImport/file.ts to lift it.
 */

import {
  decodeBytes,
  deterministicId,
  isGoogleHost,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  MutationKind,
  readTable,
  sheetCsvUrl,
  type ImportEntity,
  type ImportRow,
  type TableRead,
} from '@waves/core';

export type FileFailure = 'too_large' | 'too_many_rows' | 'empty' | 'encoding' | 'unreadable';

export class ImportFileError extends Error {
  constructor(readonly failure: FileFailure | 'bad_link' | 'private' | 'network') {
    super(`import: ${failure}`);
    this.name = 'ImportFileError';
  }
}

export function tableFromBytes(bytes: Uint8Array, name: string): TableRead {
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new ImportFileError('too_large');
  if (bytes.byteLength === 0) throw new ImportFileError('empty');
  if (/\.xlsx?$/i.test(name)) throw new ImportFileError('unreadable');
  const decoded = decodeBytes(bytes);
  // A guessed character in a name becomes a person who does not exist: send the file back.
  if (decoded.lossy) throw new ImportFileError('encoding');
  const table = readTable(decoded.text);
  if (table.rows.length === 0) throw new ImportFileError('empty');
  if (table.rows.length - 1 > MAX_IMPORT_ROWS) throw new ImportFileError('too_many_rows');
  return table;
}

const TIMEOUT_MS = 20_000;

/** A public Google Sheet's own CSV export, no sign-in. Only an address rebuilt by `sheetCsvUrl` is fetched. */
export async function fetchSheetTable(pasted: string): Promise<TableRead> {
  const url = sheetCsvUrl(pasted);
  if (!url) throw new ImportFileError('bad_link');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let bytes: Uint8Array;
  try {
    const response = await fetch(url, { signal: abort.signal, redirect: 'follow' });
    let finalHost = '';
    try {
      finalHost = new URL(response.url || url).hostname;
    } catch {
      // empty host is refused below
    }
    if (!isGoogleHost(finalHost)) throw new ImportFileError('private');
    if ([401, 403, 404].includes(response.status)) throw new ImportFileError('private');
    if (!response.ok) throw new ImportFileError('network');
    if (/text\/html/i.test(response.headers.get('content-type') ?? ''))
      throw new ImportFileError('private');
    bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMPORT_BYTES) throw new ImportFileError('too_large');
  } catch (caught) {
    if (caught instanceof ImportFileError) throw caught;
    throw new ImportFileError('network');
  } finally {
    clearTimeout(timer);
  }
  return tableFromBytes(bytes, 'sheet.csv');
}

export type Mutate = (
  kind: MutationKind,
  groupId: string,
  payload: Record<string, unknown>,
) => Promise<void>;

/** Writes one `new` row; the same payloads as the phone's useCompanyImportWriter. */
export async function writeImportRow(
  mutate: Mutate,
  groupId: string,
  entity: ImportEntity,
  row: ImportRow,
  opts: { owner: boolean; myMemberId: string | null; today: string },
): Promise<void> {
  const v = row.values;
  const id = row.id;
  if (!v || !id) return;
  if (entity === 'employee') {
    await mutate(MutationKind.MemberAddGhost, groupId, {
      memberId: id,
      name: v.name,
      email: null,
      phone: v.phone,
    });
    if (v.employeeId)
      await mutate(MutationKind.CompanyMemberEmployeeIdSet, groupId, {
        memberId: id,
        employeeId: v.employeeId,
      });
    // Assigning and rates are owner actions; a manager's import leaves them blank.
    if (v.managerId && opts.owner)
      await mutate(MutationKind.CompanyMemberAssign, groupId, {
        memberId: id,
        managerId: v.managerId,
        reason: '',
      });
    if (v.departmentId)
      await mutate(MutationKind.CompanyMemberDepartmentSet, groupId, {
        memberId: id,
        departmentId: v.departmentId,
      });
    if (v.joinedOn)
      await mutate(MutationKind.CompanyDatesSet, groupId, {
        memberId: id,
        birthDay: null,
        birthMonth: null,
        joinedOn: v.joinedOn,
        showBirthday: false,
      });
    if (v.dailyRateMinor && opts.owner)
      await mutate(MutationKind.CompanyMemberRateSet, groupId, {
        memberId: id,
        dailyRateMinor: v.dailyRateMinor.toString(),
      });
  } else if (entity === 'client') {
    await mutate(MutationKind.CompanyClientSet, groupId, {
      clientId: id,
      name: v.name.trim(),
      phone: v.phone?.trim() || null,
      need: v.need?.trim() || null,
      source: v.source,
      address: v.address?.trim() || null,
      expectedValueMinor: v.expectedValueMinor?.toString() ?? null,
      ownerMemberId: opts.myMemberId,
      stage: v.stage,
      lostReason: null,
    });
  } else {
    await mutate(MutationKind.CompanyVendorSet, groupId, {
      vendorId: id,
      name: v.name.trim(),
      phone: v.phone?.trim() || null,
      category: v.category?.trim() || null,
    });
    if (v.openingBalanceMinor)
      await mutate(MutationKind.CompanyVendorEntryCreate, groupId, {
        entryId: deterministicId(`companyimport:opening:${id}`),
        vendorId: id,
        kind: 'bill',
        amountMinor: v.openingBalanceMinor.toString(),
        occurredOn: opts.today,
        note: 'Opening balance',
        dueOn: null,
        method: null,
        reference: null,
      });
  }
}
