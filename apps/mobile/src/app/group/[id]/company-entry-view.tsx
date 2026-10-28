/**
 * One company entry: what it is, where it stands (waiting, approved, rejected and
 * the admin's note), its photos, and the actions the viewer may take. An admin
 * approves or rejects (a rejection needs a note); the employee or an admin
 * withdraws. The entry list the viewer can open is already what the server let
 * them read, so a guessed id finds nothing.
 */

import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import {
  flagsForEntry,
  format,
  money,
  reimbursedOn,
  type CompanyEntry,
  type CurrencyCode,
} from '@waves/core';
import { Button, Text, useTheme } from '@waves/ui';

import { CompanyEntryPhotos } from '@/components/company/CompanyEntryPhotos';
import { kindLabel } from '@/components/company/CompanyStatementView';
import { EditTextSheet } from '@/components/EditTextSheet';
import { ListRow, ScenicBody, ScenicHeader, StandardCard } from '@/components/standard';
import {
  useCompanyEntries,
  useReviewCompanyEntry,
  useVoidCompanyEntry,
} from '@/data/companyEntries';
import { displayName } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import { showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';

export default function CompanyEntryViewScreen() {
  const { id, entry: entryParam } = useLocalSearchParams<{ id: string; entry?: string }>();
  const groupId = id ?? '';
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { confirm } = useDialog();
  const view = useCompanyEntries(groupId);
  const review = useReviewCompanyEntry(groupId);
  const voidEntry = useVoidCompanyEntry(groupId);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entry: CompanyEntry | null =
    view.entries.find((row) => row.id === entryParam && !row.deleted) ?? null;
  const owner = entry ? view.members.find((m) => m.id === entry.memberId) : null;
  const currency = view.currency as CurrencyCode;
  const fmt = (minor: bigint): string => format(money(minor, currency), { locale });
  const mine = !!entry && entry.memberId === view.me?.id;
  const ownKind = entry?.kind === 'expense' || entry?.kind === 'allowance';
  // A paid claim (or the payment itself, or the credits it netted in) is frozen.
  const frozen =
    !!entry &&
    (entry.status === 'reimbursed' || entry.reimbursementId !== null || entry.coversClaims);
  const canWithdraw =
    !!entry && !frozen && (view.isAdmin || (mine && ownKind && entry.createdBy === view.me?.id));
  const paidOn = entry ? reimbursedOn(entry, view.entries) : null;
  const flags = entry
    ? flagsForEntry(entry, view.entries, view.policies, view.receiptEntryIds)
    : [];
  const status =
    entry?.status === 'submitted'
      ? t.company.awaiting
      : entry?.status === 'rejected'
        ? t.company.rejected
        : t.company.statusApproved;

  const run = async (work: () => Promise<unknown>, scope: string): Promise<void> => {
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(friendlyError(caught, t.company.couldNotSave, scope));
    }
  };

  const withdraw = async (): Promise<void> => {
    if (!entry) return;
    const ok = await confirm({
      title: t.company.removeTitle,
      body: t.company.removeBody,
      confirmLabel: t.company.removeEntry,
      tone: 'danger',
    });
    if (!ok) return;
    await run(async () => {
      await voidEntry.mutateAsync({ entryId: entry.id });
      router.back();
    }, 'company.void');
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader title={t.company.editEntry} />
        <ScenicBody>
          {entry ? (
            <>
              <StandardCard>
                <ListRow
                  title={kindLabel(t, entry)}
                  subtitle={[
                    view.isAdmin && owner ? displayName(owner, null, null, t.misc.someone) : null,
                    showDate(entry.occurredOn, locale),
                    entry.calcMode === 'days_rate' && entry.days && entry.rateMinor !== null
                      ? fill(t.company.daysAt, { days: entry.days, rate: fmt(entry.rateMinor) })
                      : null,
                    entry.calcMode === 'distance_rate' &&
                    entry.distanceKm &&
                    entry.rateMinor !== null
                      ? fill(t.company.mileageAt, {
                          km: entry.distanceKm,
                          rate: fmt(entry.rateMinor),
                        })
                      : null,
                    entry.fromText || entry.toText
                      ? `${entry.fromText ?? ''} - ${entry.toText ?? ''}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  subtitleLines={2}
                  amount={fmt(entry.amount)}
                  divider
                />
                <ListRow
                  title={status}
                  subtitle={entry.status === 'submitted' ? t.company.notCounted : undefined}
                  divider={!!entry.note || !!entry.reviewNote}
                />
                {paidOn ? (
                  <ListRow
                    title={fill(t.company.reimbursedOn, { date: showDate(paidOn, locale) })}
                    divider
                  />
                ) : null}
                {view.isAdmin && flags.length > 0 ? (
                  <ListRow
                    title={`! ${t.company.policyFlagged}`}
                    subtitle={flags
                      .map((f) =>
                        f.code === 'RECEIPT'
                          ? fill(t.company.policyHintReceipt, { limit: fmt(f.limitMinor) })
                          : fill(t.company.policyHintLimit, {
                              actual: fmt(f.actualMinor),
                              period: f.period === 'day' ? t.company.perDay : t.company.perMonth,
                              limit: fmt(f.limitMinor),
                            }),
                      )
                      .join('\n')}
                    subtitleLines={4}
                    divider
                  />
                ) : null}
                {entry.vendor || entry.gstin || entry.invoiceNo || entry.gstAmount !== null ? (
                  <ListRow
                    title={entry.vendor ?? t.company.gstSection}
                    subtitle={[
                      entry.gstin,
                      entry.invoiceNo,
                      entry.gstAmount !== null
                        ? `${t.company.gstBefore} ${fmt(entry.amount - entry.gstAmount)} · ${t.company.gstAmount} ${fmt(entry.gstAmount)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    subtitleLines={3}
                    divider={!!entry.note || !!entry.reviewNote}
                  />
                ) : null}
                {entry.note ? (
                  <ListRow
                    title={t.company.formNote}
                    subtitle={entry.note}
                    subtitleLines={4}
                    divider={!!entry.reviewNote}
                  />
                ) : null}
                {entry.reviewNote ? (
                  <ListRow
                    title={t.company.reviewNote}
                    subtitle={entry.reviewNote}
                    subtitleLines={4}
                  />
                ) : null}
              </StandardCard>

              {entry.pending ? null : (
                <StandardCard style={{ gap: theme.spacing.sm }}>
                  <Text variant="caption" tone="muted">
                    {t.company.photos}
                  </Text>
                  <CompanyEntryPhotos
                    groupId={groupId}
                    entryId={entry.id}
                    canAdd={!frozen && (view.isAdmin || mine)}
                    canRemove={(uploader) => !frozen && (view.isAdmin || uploader === view.me?.id)}
                  />
                </StandardCard>
              )}

              {view.isAdmin && entry.status === 'submitted' ? (
                <View style={{ gap: theme.spacing.sm }}>
                  <Button
                    label={t.company.approve}
                    fullWidth
                    disabled={
                      review.isPending || !!entry.pending || flags.some((f) => f.effect === 'block')
                    }
                    onPress={() =>
                      void run(
                        () =>
                          review.mutateAsync({
                            entryId: entry.id,
                            to: 'approved',
                            expectedVersion: entry.version,
                          }),
                        'company.approve',
                      )
                    }
                  />
                  <Button
                    label={t.company.reject}
                    variant="secondary"
                    fullWidth
                    disabled={review.isPending || !!entry.pending}
                    onPress={() => setRejecting(true)}
                  />
                </View>
              ) : null}
              {canWithdraw ? (
                <Button
                  label={t.company.removeEntry}
                  variant="ghost"
                  fullWidth
                  onPress={() => void withdraw()}
                />
              ) : null}
              {view.isAdmin && flags.some((f) => f.effect === 'block') ? (
                <Text variant="caption" tone="negative">
                  {fill(t.company.policyBlocked, {
                    limit: fmt(flags.find((f) => f.effect === 'block')?.limitMinor ?? 0n),
                  })}
                </Text>
              ) : null}
              {error ? (
                <Text variant="caption" tone="negative">
                  {error}
                </Text>
              ) : null}
              <Text variant="micro" tone="muted" align="center">
                {view.isAdmin ? t.company.privacyAdmin : t.company.privacyEmployee}
              </Text>
            </>
          ) : view.ready ? (
            <Text variant="caption" tone="muted">
              {t.company.none}
            </Text>
          ) : null}
        </ScenicBody>
      </ScrollView>
      <EditTextSheet
        visible={rejecting}
        title={t.company.rejectTitle}
        hint={fill(t.company.rejectHint, {
          name: owner ? displayName(owner, null, null, t.misc.someone) : t.misc.someone,
        })}
        value=""
        multiline
        saving={review.isPending}
        onClose={() => setRejecting(false)}
        onSave={(text) => {
          const note = text.trim();
          if (!entry || !note) return;
          setRejecting(false);
          void run(
            () =>
              review.mutateAsync({
                entryId: entry.id,
                to: 'rejected',
                note,
                expectedVersion: entry.version,
              }),
            'company.reject',
          );
        }}
      />
    </View>
  );
}
