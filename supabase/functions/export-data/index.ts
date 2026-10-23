/**
 * export-data — ADR-012, portability as a feature rather than a threat.
 *
 * JSON is lossless: every version of every expense, every payer and share row,
 * settlements with their allocations, and the activity trail. CSV is the
 * spreadsheet view, and unlike the export people complain about elsewhere it
 * includes per-person settlement detail.
 *
 * Free, on the free tier, forever (ADR-011).
 */

import {
  asCaller,
  asService,
  serveWithCors,
  errorResponse,
  HttpError,
  json,
  requireMembership,
} from '../_shared/auth.ts';
import { enforceRateLimit } from '../_shared/rateLimit.ts';
import {
  familyName,
  familySubtotals,
  formatMinor,
  LEDGER_TABLE_COLUMNS,
  memberAmounts,
  PdfBuilder,
  splitMethodLabel,
  wrapText,
} from '../_shared/core.js';

type GroupUnits = Parameters<typeof familyName>[0];

interface ExportRequest {
  /** Omit to export every group the caller belongs to. */
  groupId?: string;
  format?: 'json' | 'csv' | 'pdf';
  /** ';' for locales where ',' is the decimal separator (TDR §8). */
  csvSeparator?: string;
}

serveWithCors(async (request) => {
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST');

    const body = (await request.json()) as ExportRequest;
    const format = body.format ?? 'json';
    const caller = asCaller(request);
    const service = asService();

    const { data: user, error: userError } = await caller.auth.getUser();
    if (userError || !user?.user) {
      throw new HttpError(401, 'NOT_AUTHENTICATED', 'Sign in first');
    }

    // The tightest bucket in the file. Called with no `groupId` this reads
    // every group somebody belongs to and builds a file out of it — worth
    // several seconds of database time, and worth doing ten times an hour at
    // the very most. ADR-012 says export must always be available; it does not
    // say it must be available in a loop.
    await enforceRateLimit(service, request, 'export-data', user.user.id);

    let groupIds: string[];
    if (body.groupId) {
      await requireMembership(caller, body.groupId);
      groupIds = [body.groupId];
    } else {
      // RLS decides what "my groups" means; no manual filtering needed.
      const { data: groups, error } = await caller.from('groups').select('id');
      if (error) throw new HttpError(500, 'INTERNAL', error.message);
      groupIds = (groups ?? []).map((group) => group.id);
    }

    if (groupIds.length === 0) {
      throw new HttpError(404, 'NOTHING_TO_EXPORT', 'You are not in any groups yet');
    }

    // The caller's own profile row — the account data they gave us, including the
    // optional postal address (ADR-012 portability, and the privacy screen's
    // promise that everything stored is exportable). The owner-only RPC also
    // includes private columns that cannot be selected from profiles directly.
    const { data: me, error: meError } = await caller
      .rpc('waves_my_profile')
      .select(
        'id, display_name, country_code, address, default_currency, default_vpa, payment_rail, payment_handle, locale, created_at',
      )
      .eq('id', user.user.id)
      .single();
    if (meError) {
      throw new HttpError(
        500,
        'EXPORT_INCOMPLETE',
        `Could not read your profile: ${meError.message}`,
      );
    }

    const exported = [];
    for (const groupId of groupIds) {
      const [group, members, expenses, settlements, activity] = await Promise.all([
        service.from('groups').select('*').eq('id', groupId).single(),
        service
          .from('group_members')
          // Hint the FK column: ghost_merges bridges group_members and profiles,
          // so an unqualified profiles embed is ambiguous.
          .select('*, profile:profiles!profile_id ( display_name )')
          .eq('group_id', groupId),
        service
          .from('expenses')
          // The FK is named explicitly because `expenses` and `expense_versions`
          // reference each other (expense_id, current_version_id) and PostgREST
          // refuses to guess which one an embed means.
          .select(
            `*, versions:expense_versions!expense_versions_expense_id_fkey (
               *, payers:expense_payers ( member_id, amount ),
                  shares:expense_shares ( member_id, amount ))`,
          )
          .eq('group_id', groupId),
        service
          .from('settlements')
          .select('*, allocations:settlement_allocations ( expense_id, amount )')
          .eq('group_id', groupId),
        service.from('activity_log').select('*').eq('group_id', groupId),
      ]);

      // An export that quietly omits half the ledger is worse than no export at
      // all — this is the feature people leave a competitor *for* (ADR-012).
      for (const [label, result] of Object.entries({
        group,
        members,
        expenses,
        settlements,
        activity,
      })) {
        if (result.error) {
          throw new HttpError(
            500,
            'EXPORT_INCOMPLETE',
            `Could not read ${label}: ${result.error.message}`,
          );
        }
      }

      exported.push({
        group: group.data,
        members: members.data ?? [],
        expenses: expenses.data ?? [],
        settlements: settlements.data ?? [],
        activity: activity.data ?? [],
      });
    }

    if (format === 'json') {
      return json({
        filename: `waves-export-${new Date().toISOString().slice(0, 10)}.json`,
        contentType: 'application/json',
        content: JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            schemaVersion: 1,
            // Amounts stay in minor units, as strings: re-importing this file
            // must reproduce the ledger exactly (ADR-003).
            amountUnit: 'minor',
            profile: me,
            groups: exported,
          },
          null,
          2,
        ),
      });
    }

    if (format === 'pdf') {
      const pdf = new PdfBuilder();
      const today = new Date().toISOString().slice(0, 10);
      pdf.heading('Waves - ledger export', 17);
      pdf.body(`Exported ${today}`, 9);

      for (const entry of exported) {
        const group = entry.group as Record<string, unknown> | null;
        const nameOf = (memberId: string | null): string => {
          const member = entry.members.find(
            (row: Record<string, unknown>) => row.id === memberId,
          ) as Record<string, unknown> | undefined;
          const profile = member?.profile as { display_name?: string } | undefined;
          return profile?.display_name ?? (member?.ghost_name as string) ?? 'unknown';
        };

        pdf.spacer(10);
        pdf.heading((group?.name as string) ?? 'Group', 14);
        const range =
          group?.start_date && group?.end_date ? `${group.start_date} - ${group.end_date}` : null;
        const meta = [range, group?.type as string, group?.default_currency as string]
          .filter(Boolean)
          .join('  ·  ');
        if (meta) pdf.body(meta, 9);

        // Per-currency totals — active expenses only, never summed across
        // currencies (ADR-004).
        const totals = new Map<string, bigint>();
        const activeExpenses: {
          date: string;
          description: string;
          category: string;
          currency: string;
          amount: bigint;
          payers: string;
          paidDetail: string;
          splitDetail: string;
          payerRows: { member_id: string | null; amount: bigint | number | string }[];
          shareRows: { member_id: string | null; amount: bigint | number | string }[];
        }[] = [];
        const units = group?.units as GroupUnits | null | undefined;
        // A share's owner with their family beside the name; unchanged without families.
        const nameWithFamily = (memberId: string | null): string => {
          const family = familyName(units, memberId);
          return family ? `${nameOf(memberId)} (${family})` : nameOf(memberId);
        };

        for (const expense of entry.expenses) {
          if (expense.deleted_at) continue;
          const current = expense.versions?.find(
            (version: Record<string, unknown>) => version.id === expense.current_version_id,
          );
          if (!current) continue;
          const currency = String(current.currency).toUpperCase();
          const amount = BigInt(current.amount);
          totals.set(currency, (totals.get(currency) ?? 0n) + amount);
          activeExpenses.push({
            date: String(current.expense_date ?? ''),
            description: String(current.description ?? ''),
            category: String(current.category ?? ''),
            currency,
            amount,
            payers: (current.payers ?? [])
              .map((payer: Record<string, unknown>) => nameOf(payer.member_id as string))
              .join(' + '),
            paidDetail: memberAmounts(current.payers, currency, nameWithFamily),
            splitDetail: `${splitMethodLabel(current.split_type)}: ${memberAmounts(current.shares, currency, nameWithFamily)}`,
            payerRows: current.payers ?? [],
            shareRows: current.shares ?? [],
          });
        }

        pdf.subheading('Totals', 11);
        if (totals.size === 0) {
          pdf.body('No expenses yet.', 10);
        } else {
          for (const [currency, total] of [...totals].sort((a, b) => a[0].localeCompare(b[0]))) {
            pdf.body(`${formatMinor(total, currency)} ${currency}`, 11);
          }
        }

        if (activeExpenses.length > 0) {
          // Column widths come from @waves/core, where a test proves the row
          // clears the printable page width so the last column is never cut off.
          const [dateW, descW, catW, amountW, paidW] = LEDGER_TABLE_COLUMNS.map((c) => c.width);
          pdf.subheading('Expenses', 11);
          pdf.columns(
            [
              { text: 'Date', width: dateW },
              { text: 'Description', width: descW },
              { text: 'Category', width: catW },
              { text: 'Amount', width: amountW },
              { text: 'Paid by', width: paidW },
            ],
            9,
          );
          activeExpenses.sort((a, b) => a.date.localeCompare(b.date));
          for (const row of activeExpenses) {
            pdf.columns(
              [
                { text: row.date, width: dateW },
                { text: row.description, width: descW },
                { text: row.category, width: catW },
                {
                  text: `${formatMinor(row.amount, row.currency)} ${row.currency}`,
                  width: amountW,
                },
                { text: row.payers, width: paidW },
              ],
              9,
            );
            // Small lines under the row; long lists wrap instead of being clipped.
            for (const line of wrapText(`Paid by: ${row.paidDetail}`, 120)) pdf.body(line, 7);
            for (const line of wrapText(`Split - ${row.splitDetail}`, 120)) pdf.body(line, 7);
          }
        }

        // Per-family block (only when the group has families): paid, share, net.
        const subtotals = familySubtotals(
          units,
          activeExpenses.map((row) => ({
            currency: row.currency,
            payers: row.payerRows,
            shares: row.shareRows,
          })),
        );
        if (subtotals.length > 0) {
          pdf.subheading('Families', 11);
          for (const row of subtotals) {
            pdf.body(
              `${row.family}: paid ${formatMinor(row.paid, row.currency)}, share ` +
                `${formatMinor(row.share, row.currency)}, net ${formatMinor(row.net, row.currency)} ` +
                row.currency,
              9,
            );
          }
        }

        // Settlements — the per-person detail, matching the CSV's fidelity.
        if (entry.settlements.length > 0) {
          pdf.subheading('Settlements', 11);
          for (const settlement of entry.settlements) {
            pdf.body(
              `${settlement.initiated_at?.slice(0, 10) ?? ''}  ` +
                `${nameOf(settlement.from_member_id)} -> ${nameOf(settlement.to_member_id)}  ` +
                `${formatMinor(settlement.amount, settlement.currency)} ` +
                `${String(settlement.currency).toUpperCase()}  (${settlement.status})`,
              9,
            );
          }
        }
      }

      return json({
        filename: `waves-export-${today}.pdf`,
        contentType: 'application/pdf',
        encoding: 'base64',
        content: btoa(pdf.build()),
      });
    }

    const separator = body.csvSeparator ?? ',';
    const escape = (value: unknown): string => {
      let text = value === null || value === undefined ? '' : String(value);
      // Formula injection: a cell an app opens as a spreadsheet treats a leading
      // =, +, -, @ (or tab/CR) as a formula, so `=HYPERLINK(...)` in an expense
      // description would run on open. Descriptions and names are user-typed and
      // land here verbatim. Neutralise by prefixing a single quote, then quote
      // as usual.
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return /["\n]|,|;/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };

    // The Family column exists only when some exported group has families, so a
    // file without any is byte-for-byte what it was.
    const anyFamilies = exported.some(
      (entry) => Object.keys((entry.group?.units as object | null) ?? {}).length > 0,
    );
    const rows: string[][] = [
      [
        'group',
        'type',
        'date',
        'description',
        'currency',
        'amount_minor',
        'paid_by',
        'owed_by',
        'owed_amount_minor',
        'status',
        'version',
        'Paid by',
        'Split method',
        'Split between',
        ...(anyFamilies ? ['Family'] : []),
      ],
    ];

    for (const entry of exported) {
      const nameOf = (memberId: string | null): string => {
        const member = entry.members.find((row: Record<string, unknown>) => row.id === memberId);
        return (
          (member?.profile?.display_name as string) ?? (member?.ghost_name as string) ?? 'unknown'
        );
      };

      const units = entry.group?.units as GroupUnits | null | undefined;
      const family = (cells: string[], memberId: string | null): string[] =>
        anyFamilies ? [...cells, familyName(units, memberId)] : cells;
      const live: Parameters<typeof familySubtotals>[1] = [];

      for (const expense of entry.expenses) {
        const current = expense.versions?.find(
          (version: Record<string, unknown>) => version.id === expense.current_version_id,
        );
        if (!current) continue;
        if (!expense.deleted_at) {
          live.push({
            currency: String(current.currency).toUpperCase(),
            payers: current.payers,
            shares: current.shares,
          });
        }
        const payers = (current.payers ?? [])
          .map((payer: Record<string, unknown>) => nameOf(payer.member_id as string))
          .join(' + ');

        for (const share of current.shares ?? []) {
          rows.push(
            family(
              [
                entry.group?.name ?? '',
                expense.deleted_at ? 'expense (deleted)' : 'expense',
                current.expense_date,
                current.description,
                current.currency,
                current.amount,
                payers,
                nameOf(share.member_id),
                share.amount,
                expense.deleted_at ? 'deleted' : 'active',
                `v${current.version_no}`,
                memberAmounts(current.payers, current.currency, nameOf, '; '),
                splitMethodLabel(current.split_type),
                memberAmounts(current.shares, current.currency, nameOf, '; '),
              ],
              share.member_id,
            ),
          );
        }
      }

      // Per-family subtotals, one row each: description is the family, amount_minor
      // what it paid, owed_amount_minor its share, status its net (paid - share).
      // The importer reads only 'expense' and 'settlement' rows, so these are inert there.
      for (const sub of familySubtotals(units, live)) {
        rows.push([
          entry.group?.name ?? '',
          'family subtotal',
          '',
          sub.family,
          sub.currency,
          String(sub.paid),
          '',
          sub.family,
          String(sub.share),
          String(sub.net),
          '',
          '',
          '',
          '',
          sub.family,
        ]);
      }

      // Per-person settlement detail — the part competitors leave out.
      for (const settlement of entry.settlements) {
        rows.push(
          family(
            [
              entry.group?.name ?? '',
              'settlement',
              settlement.initiated_at?.slice(0, 10) ?? '',
              settlement.note ?? `${settlement.method} payment`,
              settlement.currency,
              settlement.amount,
              nameOf(settlement.from_member_id),
              nameOf(settlement.to_member_id),
              settlement.amount,
              settlement.status,
              '',
              '',
              '',
              '',
            ],
            null,
          ),
        );
      }
    }

    return json({
      filename: `waves-export-${new Date().toISOString().slice(0, 10)}.csv`,
      contentType: 'text/csv',
      content: rows.map((row) => row.map(escape).join(separator)).join('\n'),
    });
  } catch (error) {
    return errorResponse(error, { fn: 'export-data' });
  }
});
