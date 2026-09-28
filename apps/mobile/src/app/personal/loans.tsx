/**
 * Loans (A48): money you owe or are owed, tracked with a running balance. A loan
 * carries its principal; each repayment is a normal ledger entry linked to it
 * ("Record payment" opens the entry form pre-linked), and what is left is the
 * principal less those payments. The editor is an inline sheet.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  encodeLoan,
  format,
  loanOutstanding,
  currencySymbol,
  money,
  type LoanDirection,
  type PersonalLoan,
} from '@waves/core';
import {
  AmountField,
  Button,
  Card,
  directionalIcon,
  Divider,
  IconButton,
  iconSize,
  Row,
  Screen,
  Sheet,
  Text,
  useTheme,
} from '@waves/ui';

import { DetailRow } from '@/components/DetailRows';
import { PersonalNoteField } from '@/components/PersonalNoteField';
import {
  localIsoDate,
  todayIso,
  usePersonalLedger,
  useDeletePersonalRecord,
  useUpsertPersonalRecord,
} from '@/data/personal';
import { useDefaultCurrency } from '@/lib/currency';
import { useStrings } from '@/i18n';
import { PersonalGuard } from '@/components/PersonalGuard';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';
import { useDialog } from '@/lib/dialog';
import { dateTimeFormat } from '@/lib/dateTimeFormat';
import { SPEC_ACCENT, SPEC_INK, SPEC_MUTED } from '@/lib/specPalette';

function LoansScreenBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const dc = useDefaultCurrency();
  const { loans, txns } = usePersonalLedger();
  const { ink, muted } = useLoanInks();
  // Everyone a loan has been with before, for the sheet's "With" suggestions.
  const names = [...new Set(loans.map((loan) => loan.counterpart.trim()).filter(Boolean))];

  const [today] = useState(() => todayIso());
  const [editing, setEditing] = useState<PersonalLoan | null>(null);
  const [creating, setCreating] = useState(false);

  const sorted = [...loans].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return a.startDate < b.startDate ? 1 : -1;
  });

  return (
    <Screen>
      <Row
        style={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.md,
          alignItems: 'center',
        }}
      >
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading">{t.personal.loans}</Text>
        </View>
        <IconButton label={t.personal.addLoan} onPress={() => setCreating(true)}>
          <Ionicons name="add" size={iconSize.xxl} color={theme.color.brand} />
        </IconButton>
      </Row>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          variant="caption"
          tone="muted"
          align="center"
          style={{ marginBottom: theme.spacing.sm }}
        >
          {t.personal.loansSub}
        </Text>

        {sorted.length === 0 ? (
          <View style={{ paddingTop: theme.spacing.lg, alignItems: 'center', gap: 8 }}>
            <WalletArt />
            <Text style={{ fontSize: 20, fontWeight: '800', color: ink, textAlign: 'center' }}>
              {t.personal.noLoans}
            </Text>
            <Text
              style={{
                fontSize: 14,
                lineHeight: 20,
                color: muted,
                textAlign: 'center',
                paddingHorizontal: theme.spacing.lg,
              }}
            >
              {t.personal.noLoansBody}
            </Text>
          </View>
        ) : (
          sorted.map((loan) => {
            const left = loanOutstanding(loan, txns);
            const borrowed = loan.direction === 'borrowed';
            const settled = loan.status === 'closed' || left === 0n;
            return (
              <Card key={loan.id} style={{ gap: theme.spacing.sm }}>
                <Pressable accessibilityRole="button" onPress={() => setEditing(loan)}>
                  <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: theme.radius.md,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: theme.color.brandSoft,
                      }}
                    >
                      <Ionicons
                        name={borrowed ? 'arrow-down' : 'arrow-up'}
                        size={iconSize.md}
                        color={theme.color.brand}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
                        {loan.counterpart || (borrowed ? t.personal.borrowed : t.personal.lent)}
                      </Text>
                      <Text variant="micro" tone="muted">
                        {borrowed ? t.personal.borrowed : t.personal.lent} ·{' '}
                        {format(money(loan.principal, loan.currency), {
                          locale,
                        })}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text variant="micro" tone="faint">
                        {settled ? t.personal.paidOff : t.personal.outstanding}
                      </Text>
                      <Text variant="body" style={{ fontWeight: '700' }}>
                        {format(money(left, loan.currency), { locale })}
                      </Text>
                    </View>
                  </Row>
                </Pressable>
                {!settled ? (
                  <>
                    <Divider />
                    <Button
                      label={t.personal.recordPayment}
                      size="sm"
                      variant="secondary"
                      onPress={() =>
                        router.push({
                          pathname: '/personal/entry',
                          params: { loanId: loan.id, kind: borrowed ? 'expense' : 'income' },
                        })
                      }
                    />
                  </>
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>

      {creating ? (
        <LoanEditor currency={dc} today={today} names={names} onClose={() => setCreating(false)} />
      ) : null}
      {editing ? (
        <LoanEditor
          loan={editing}
          currency={dc}
          today={today}
          names={names}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Screen>
  );
}

function LoanEditor({
  loan,
  currency,
  today,
  names,
  onClose,
}: {
  loan?: PersonalLoan;
  currency: string;
  today: string;
  /** People earlier loans were with, offered under the "With" field. */
  names: readonly string[];
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { dark, ink, muted, accent, lavender } = useLoanInks();
  const [namesOpen, setNamesOpen] = useState(false);
  const { confirm } = useDialog();
  const upsert = useUpsertPersonalRecord();
  const remove = useDeletePersonalRecord();

  const [direction, setDirection] = useState<LoanDirection>(loan?.direction ?? 'borrowed');
  const [counterpart, setCounterpart] = useState(loan?.counterpart ?? '');
  const [principal, setPrincipal] = useState<bigint>(loan?.principal ?? 0n);
  const [note, setNote] = useState(loan?.note ?? '');
  const [startDate, setStartDate] = useState(loan?.startDate ?? today);
  const [showDate, setShowDate] = useState(false);
  const [closed, setClosed] = useState(loan?.status === 'closed');

  const canSave = principal > 0n && counterpart.trim().length > 0 && !upsert.isPending;

  const onSave = (): void => {
    if (!canSave) return;
    upsert.mutate(
      {
        recordId: loan?.id,
        recordKind: 'loan',
        data: encodeLoan({
          carried: loan?.carried,
          direction,
          counterpart: counterpart.trim(),
          principal,
          currency: loan?.currency ?? currency,
          note: note.trim() || null,
          startDate,
          status: closed ? 'closed' : 'active',
        }),
      },
      { onSuccess: onClose },
    );
  };

  const loanCurrency = loan?.currency ?? currency;
  const others = names.filter((name) => name !== counterpart.trim());
  const fieldBox = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: lavender,
  };

  return (
    <Sheet visible onClose={onClose} padded={false} style={{ maxHeight: '92%' }}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.spacing.xl,
          gap: 12,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Row style={{ alignItems: 'flex-start', gap: theme.spacing.md }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={{ fontSize: 24, fontWeight: '800', color: ink }} numberOfLines={1}>
              {loan ? t.personal.editLoan : t.personal.addLoan}
            </Text>
            <Text style={{ fontSize: 14, color: muted }}>{t.personal.addLoanSub}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.common.close}
            onPress={onClose}
            hitSlop={6}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: lavender,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="close" size={20} color={ink} />
          </Pressable>
        </Row>

        <Row
          accessibilityRole="tablist"
          style={{ padding: 4, borderRadius: 26, backgroundColor: lavender, gap: 4 }}
        >
          {(
            [
              { value: 'borrowed', label: t.personal.borrowed, icon: 'arrow-down-circle-outline' },
              { value: 'lent', label: t.personal.lent, icon: 'arrow-up-circle-outline' },
            ] as const
          ).map((tab) => {
            const on = tab.value === direction;
            return (
              <Pressable
                key={tab.value}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => setDirection(tab.value)}
                style={{
                  flex: 1,
                  height: 42,
                  borderRadius: 21,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  backgroundColor: on ? accent : 'transparent',
                }}
              >
                <Ionicons name={tab.icon} size={20} color={on ? '#FFFFFF' : ink} />
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: on ? '700' : '500',
                    color: on ? '#FFFFFF' : ink,
                  }}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </Row>

        <FieldLabel>{t.personal.loanAmount}</FieldLabel>
        <View style={fieldBox}>
          <Text style={{ fontSize: 22, fontWeight: '600', color: ink }}>
            {currencySymbol(loanCurrency, locale)}
          </Text>
          <View
            style={{ width: 1, height: 26, backgroundColor: dark ? theme.color.border : '#E0DCF3' }}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <AmountField
              currency={loanCurrency}
              value={principal}
              onChange={setPrincipal}
              size="compact"
              showSymbol={false}
              align="start"
            />
          </View>
        </View>

        <FieldLabel>{t.personal.counterpart}</FieldLabel>
        <View style={{ gap: 6 }}>
          <View style={fieldBox}>
            <Ionicons name="person-outline" size={20} color={muted} />
            <TextInput
              value={counterpart}
              onChangeText={setCounterpart}
              placeholder={t.personal.counterpartPlaceholder}
              placeholderTextColor={theme.color.textFaint}
              accessibilityLabel={t.personal.counterpart}
              style={{ flex: 1, fontSize: 16, color: ink, paddingVertical: 12 }}
            />
            {/* Only a dropdown when there is somebody to offer: a chevron over
                an empty list would be a control that does nothing. */}
            {others.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.personal.pickName}
                accessibilityState={{ expanded: namesOpen }}
                onPress={() => setNamesOpen((open) => !open)}
                hitSlop={10}
              >
                <Ionicons name={namesOpen ? 'chevron-up' : 'chevron-down'} size={20} color={ink} />
              </Pressable>
            ) : null}
          </View>
          {namesOpen && others.length > 0 ? (
            <View
              style={{
                borderRadius: 14,
                backgroundColor: theme.color.surface,
                borderWidth: 1,
                borderColor: dark ? theme.color.border : '#E7E3F7',
              }}
            >
              {others.map((name, index) => (
                <Pressable
                  key={name}
                  accessibilityRole="button"
                  onPress={() => {
                    setCounterpart(name);
                    setNamesOpen(false);
                  }}
                  style={({ pressed }) => ({
                    paddingVertical: 12,
                    paddingHorizontal: 16,
                    borderTopWidth: index > 0 ? 1 : 0,
                    borderTopColor: dark ? theme.color.border : '#F0EEF7',
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text style={{ fontSize: 15, color: ink }}>{name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <FieldLabel>{t.personal.notePlaceholder}</FieldLabel>
        {/* The shared note field, so the mic comes with it. The person the
            loan is with is handed to the recogniser: "lent to Ravi for the
            deposit" is exactly the sentence a general model turns into a name
            that was never said. */}
        <PersonalNoteField
          value={note}
          onChange={setNote}
          placeholder={t.personal.loanForPlaceholder}
          accessibilityLabel={t.personal.note}
          hints={counterpart.trim() ? [counterpart.trim()] : undefined}
        />

        {/* The same `DetailRow` the expense and personal-entry forms state
            their date in, so a screen reader hears what the date is for. */}
        <View style={{ borderRadius: 16, backgroundColor: lavender, paddingHorizontal: 16 }}>
          <DetailRow
            icon="calendar-outline"
            label={t.personal.startsOn}
            value={dateLabel(startDate, locale)}
            onPress={() => setShowDate(true)}
          />
        </View>
        {showDate ? (
          <DateTimePicker
            value={new Date(`${startDate}T00:00:00`)}
            mode="date"
            onChange={(event, picked) => {
              if (Platform.OS !== 'ios') setShowDate(false);
              if (event.type === 'set' && picked) setStartDate(localIsoDate(picked));
            }}
          />
        ) : null}

        {loan ? (
          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="body">{t.personal.closeLoan}</Text>
            <Button
              label={closed ? t.personal.reopenLoan : t.personal.closeLoan}
              size="sm"
              variant="secondary"
              onPress={() => setClosed((prev) => !prev)}
              // A toggle wearing a button's clothes: the label flips between
              // close and reopen, so the second tap is a different action and
              // has to land.
              repeatable
            />
          </Row>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.personal.save}
          accessibilityState={{ disabled: !canSave }}
          disabled={!canSave}
          onPress={onSave}
          style={({ pressed }) => ({
            marginTop: 6,
            height: 54,
            borderRadius: 27,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: canSave ? accent : theme.color.surfaceMuted,
            opacity: pressed ? 0.88 : 1,
          })}
        >
          <Text
            style={{
              fontSize: 17,
              fontWeight: '700',
              color: canSave ? '#FFFFFF' : theme.color.textFaint,
            }}
          >
            {t.personal.save}
          </Text>
        </Pressable>

        {loan ? (
          <Button
            label={t.common.delete}
            variant="danger"
            fullWidth
            onPress={() =>
              void confirm({
                title: t.common.delete,
                body: t.personal.deleteConfirm,
                confirmLabel: t.common.delete,
                tone: 'danger',
              }).then((ok) => {
                if (ok) remove.mutate(loan.id, { onSuccess: onClose });
              })
            }
          />
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

/** The mockup's inks in the light theme; the theme's own in the dark. */
function useLoanInks() {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  return {
    dark,
    ink: dark ? theme.color.text : SPEC_INK,
    muted: dark ? theme.color.textMuted : SPEC_MUTED,
    accent: dark ? theme.color.brand : SPEC_ACCENT,
    lavender: dark ? theme.color.surfaceMuted : '#F3F0FE',
  };
}

function FieldLabel({ children }: { children: string }) {
  const { ink } = useLoanInks();
  return (
    <Text style={{ fontSize: 15, fontWeight: '600', color: ink, marginTop: 4 }}>{children}</Text>
  );
}

/** "28 Sep 2026", from the ledger's calendar-day string. */
function dateLabel(day: string, locale: string): string {
  try {
    return dateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${day}T00:00:00Z`));
  } catch {
    return day;
  }
}

/** The empty list's picture: a wallet with a note tucked in and a rupee coin.
 *  Drawn from views and glyphs, so it themes and costs no asset. */
function WalletArt() {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const accent = dark ? theme.color.brand : SPEC_ACCENT;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 150, height: 120 }}
    >
      <View
        style={{
          position: 'absolute',
          left: 42,
          top: 6,
          width: 56,
          height: 60,
          borderRadius: 6,
          padding: 8,
          gap: 6,
          backgroundColor: dark ? theme.color.surface : '#FFFFFF',
          borderWidth: 2,
          borderColor: dark ? '#5A52A8' : '#C9C2FA',
          transform: [{ rotate: '-6deg' }],
        }}
      >
        <View style={{ height: 3, borderRadius: 2, backgroundColor: '#C9C2FA' }} />
        <View style={{ height: 3, width: 26, borderRadius: 2, backgroundColor: '#C9C2FA' }} />
      </View>
      <View
        style={{
          position: 'absolute',
          left: 28,
          top: 40,
          width: 84,
          height: 68,
          borderRadius: 12,
          backgroundColor: accent,
        }}
      >
        <View
          style={{
            position: 'absolute',
            right: -6,
            top: 22,
            width: 28,
            height: 22,
            borderRadius: 8,
            backgroundColor: dark ? '#4A4290' : '#4D33C9',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#C9C2FA' }} />
        </View>
      </View>
      <View
        style={{
          position: 'absolute',
          right: 18,
          top: 26,
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#F2B233',
          borderWidth: 3,
          borderColor: '#E39C18',
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '800', color: '#FFF6DC' }}>₹</Text>
      </View>
    </View>
  );
}

/**
 * Behind the section shield: one unlock covers the Me tab and every room
 * under `personal/`, so arriving here from the ledger never asks again.
 */
export default function LoansScreen() {
  return (
    <PersonalGuard>
      <LoansScreenBody />
    </PersonalGuard>
  );
}
