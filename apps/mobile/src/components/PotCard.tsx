import { useRef, useState } from 'react';
import { Pressable, ScrollView, Share, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { randomUUID } from 'expo-crypto';
import {
  buildPaymentQrPayload,
  parseMinorInput,
  potBalances,
  toMajorString,
  type CurrencyCode,
} from '@waves/core';
import { Button, Row, Sheet, Text, useTheme } from '@waves/ui';
import { useGroup, toSnapshot } from '@/data/hooks';
import { displayName, payableAt } from '@/data/types';
import {
  usePots,
  usePotExpenseTags,
  useCreatePot,
  useRecordPotContribution,
  useConfirmPotContribution,
  useClosePot,
  useCarryPot,
} from '@/data/pots';
import { fill, useStrings } from '@/i18n';
import { potMoney } from '@/lib/pots';
import { optionalPotUtr, potInput, potSettlements, potVisibility } from '@/lib/potUi';
import { WEB_URL } from '@/lib/webUrl';
import { router } from '@/lib/navigation';
import { useGuestGuard } from '@/lib/guestGuard';

/** One group surface; every task opens the same shared bottom-sheet primitive. */
export function PotCard({
  groupId,
  myMemberId,
  balances = false,
}: {
  groupId: string;
  myMemberId: string | null;
  balances?: boolean;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const guard = useGuestGuard();
  const { group, members, everyone, expenses } = useGroup(groupId);
  const pots = usePots(groupId);
  const create = useCreatePot(groupId);
  const contribute = useRecordPotContribution(groupId);
  const confirm = useConfirmPotContribution(groupId);
  const close = useClosePot(groupId);
  const carry = useCarryPot(groupId);
  const [sheet, setSheet] = useState<'start' | 'paid' | 'close' | 'qr' | null>(null);
  const [potId, setPotId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [holder, setHolder] = useState(myMemberId);
  const [utr, setUtr] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  // Reuse a mutation's id on retry, including a failed confirm after recording.
  const mutationIds = useRef(new Map<string, string>());
  const mutationId = (key: string) => {
    if (!mutationIds.current.has(key)) mutationIds.current.set(key, randomUUID());
    return mutationIds.current.get(key)!;
  };
  const visibility = potVisibility(group.data, pots.data);
  const openPots = (pots.data ?? []).filter((pot) => pot.status === 'open');
  const potTags = usePotExpenseTags(groupId, openPots.length > 0);
  const pot = openPots.find((row) => row.id === potId) ?? openPots[0];
  const all = everyone.data ?? members.data ?? [];
  const active = members.data ?? [];
  const name = (id: string) => {
    const member = all.find((row) => row.id === id);
    return member ? displayName(member) : t.misc.someone;
  };
  const currency = (pot?.currency ?? group.data?.default_currency ?? 'INR') as CurrencyCode;
  const fmt = (minor: bigint) => potMoney(minor, currency, locale);
  const snapshots = expenses.rows.flatMap((row) => {
    const snapshot = toSnapshot(row);
    return snapshot ? [{ ...snapshot, potId: potTags.data?.[row.id] ?? snapshot.potId }] : [];
  });
  const position = pot
    ? potBalances(
        potInput(
          pot,
          active.map((row) => row.id),
        ),
        snapshots,
        potSettlements(pot),
      )
    : null;
  const treasurer = pot ? name(pot.treasurer_member_id) : '';
  const isTreasurer = pot?.treasurer_member_id === myMemberId;
  const canManage =
    isTreasurer || active.some((row) => row.id === myMemberId && row.role === 'admin');
  const run = async (work: () => Promise<unknown>) => {
    if (inFlight.current || guard.blockWrite()) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch {
      setError(t.couldNotSave);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const show = (next: typeof sheet, id?: string) => {
    if (next === 'start' && !visibility.canStart) return;
    setError(null);
    setPotId(id ?? null);
    setSheet(next);
  };
  const tick = (memberId: string) => {
    if (!pot) return;
    const reference = optionalPotUtr(utr[memberId] ?? '');
    if (!reference.valid) {
      setError(t.pots.invalidUtr);
      return;
    }
    void run(async () => {
      const pending = pot.contributions.find(
        (row) =>
          row.from_member_id === memberId &&
          row.to_member_id === pot.treasurer_member_id &&
          row.status === 'initiated',
      );
      const id =
        pending?.id ??
        (await contribute.mutateAsync({
          potId: pot.id,
          fromMemberId: memberId,
          toMemberId: pot.treasurer_member_id,
          amount: BigInt(pot.per_head_minor),
          reference: reference.reference,
          referenceSource: 'self',
          clientMutationId: mutationId(`${pot.id}:${memberId}:${reference.reference ?? ''}`),
        }));
      if (isTreasurer) await confirm.mutateAsync(id);
    });
  };
  const payee = pot ? all.find((row) => row.id === pot.treasurer_member_id) : null;
  const payable = payee ? payableAt(payee) : null;
  const qr =
    pot && payable?.rail === 'upi'
      ? buildPaymentQrPayload(
          {
            railId: 'upi',
            handle: payable.handle,
            payeeName: treasurer,
            amount: BigInt(pot.per_head_minor),
            currency,
            referenceCode: pot.pay_code,
          },
          (minor, code) => toMajorString({ minor, currency: code }),
        )
      : null;
  const field = {
    color: theme.color.text,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  };
  if (!myMemberId || !visibility.show) return null;
  return (
    <>
      {pots.isLoading || (openPots.length > 0 && potTags.isLoading) ? null : pots.isError ||
        (openPots.length > 0 && potTags.isError) ? (
        <Button
          label={t.retry}
          variant="secondary"
          onPress={() => {
            void pots.refetch();
            void potTags.refetch();
          }}
        />
      ) : openPots.length === 0 ? (
        visibility.canStart ? (
          <Button
            label={t.pots.start}
            variant="secondary"
            onPress={() => {
              setHolder(myMemberId);
              show('start');
            }}
          />
        ) : null
      ) : (
        openPots.map((row) => {
          const stats = potBalances(
            potInput(
              row,
              active.map((member) => member.id),
            ),
            snapshots,
            potSettlements(row),
          );
          const participants = stats.members.filter(
            (member) =>
              member.memberId !== row.treasurer_member_id &&
              active.some((activeMember) => activeMember.id === member.memberId),
          );
          return (
            <View
              key={row.id}
              style={{
                padding: theme.spacing.md,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.color.surface,
                gap: theme.spacing.sm,
              }}
            >
              <Text variant="body">
                {balances
                  ? fill(t.pots.held, { name: name(row.treasurer_member_id) })
                  : fill(t.pots.summary, {
                      amount: potMoney(stats.balance, row.currency as CurrencyCode, locale),
                      paid: participants
                        .filter((member) => member.paidIn >= BigInt(row.per_head_minor))
                        .length.toLocaleString(locale),
                      total: participants.length.toLocaleString(locale),
                      name: name(row.treasurer_member_id),
                    })}
              </Text>
              {balances ? (
                <Text variant="caption" tone="muted">
                  {potMoney(stats.balance, row.currency as CurrencyCode, locale)}
                </Text>
              ) : null}
              <Row style={{ gap: theme.spacing.sm, flexWrap: 'wrap' }}>
                <Button
                  size="sm"
                  variant="secondary"
                  label={t.pots.paidIn}
                  onPress={() => show('paid', row.id)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  label={t.pots.spend}
                  onPress={() => router.push(`/group/${groupId}/add-expense?potId=${row.id}`)}
                />
                {row.treasurer_member_id === myMemberId ||
                active.find((member) => member.id === myMemberId)?.role === 'admin' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    label={t.pots.close}
                    onPress={() => show('close', row.id)}
                  />
                ) : null}
              </Row>
            </View>
          );
        })
      )}
      <Sheet
        visible={sheet !== null}
        onClose={() => {
          if (!busy) setSheet(null);
        }}
        closeLabel={t.common.close}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
        >
          <Text variant="title">
            {sheet === 'start'
              ? t.pots.start
              : sheet === 'paid'
                ? t.pots.paidIn
                : sheet === 'qr'
                  ? t.pots.share
                  : t.pots.close}
          </Text>
          {error ? (
            <Text tone="negative" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          {sheet === 'start' && visibility.canStart ? (
            <>
              <Text>{t.pots.amount}</Text>
              <TextInput
                accessibilityLabel={t.pots.amount}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                style={field}
              />
              <Text variant="subheading">{t.pots.holder}</Text>
              {active.map((member) => (
                <Pressable
                  key={member.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: holder === member.id }}
                  onPress={() => setHolder(member.id)}
                  style={{ paddingVertical: theme.spacing.sm }}
                >
                  <Text>
                    {holder === member.id ? '● ' : '○ '}
                    {name(member.id)}
                  </Text>
                </Pressable>
              ))}
              <Button
                label={t.pots.start}
                disabled={busy || !holder || parseMinorInput(amount, currency) <= 0n}
                onPress={() =>
                  void run(async () => {
                    if (!visibility.canStart) return;
                    const key = `create:${amount}:${holder}`;
                    await create.mutateAsync({
                      name: group.data?.name ?? t.pots.start,
                      currency,
                      perHeadMinor: parseMinorInput(amount, currency),
                      treasurerMemberId: holder!,
                      clientMutationId: mutationId(key),
                    });
                    mutationIds.current.delete(key);
                    setSheet(null);
                    setAmount('');
                  })
                }
              />
            </>
          ) : null}
          {sheet === 'paid' && pot
            ? active
                .filter((member) => member.id !== pot.treasurer_member_id)
                .map((member) => {
                  const rows = pot.contributions.filter(
                    (row) =>
                      row.from_member_id === member.id &&
                      row.to_member_id === pot.treasurer_member_id,
                  );
                  const confirmed =
                    rows
                      .filter(
                        (row) => row.status === 'confirmed' || row.status === 'auto_confirmed',
                      )
                      .reduce((sum, row) => sum + BigInt(row.amount), 0n) >=
                    BigInt(pot.per_head_minor);
                  const pending = rows.some((row) => row.status === 'initiated');
                  const editable =
                    !confirmed && !busy && (isTreasurer || (member.id === myMemberId && !pending));
                  return (
                    <View
                      key={member.id}
                      style={{ gap: theme.spacing.sm, paddingVertical: theme.spacing.sm }}
                    >
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: confirmed, disabled: !editable }}
                        disabled={!editable}
                        onPress={() => tick(member.id)}
                      >
                        <Text variant="subheading">
                          {confirmed ? '☑ ' : '☐ '}
                          {name(member.id)}
                        </Text>
                        {confirmed || pending ? (
                          <Text variant="caption" tone="muted">
                            {fill(confirmed ? t.pots.confirmed : t.pots.waiting, {
                              name: treasurer,
                            })}
                          </Text>
                        ) : null}
                      </Pressable>
                      {editable && !pending ? (
                        <TextInput
                          accessibilityLabel={t.pots.utr}
                          placeholder={t.pots.utr}
                          placeholderTextColor={theme.color.textMuted}
                          value={utr[member.id] ?? ''}
                          onChangeText={(value) =>
                            setUtr((previous) => ({ ...previous, [member.id]: value }))
                          }
                          autoCapitalize="characters"
                          style={field}
                        />
                      ) : null}
                      <Button
                        size="sm"
                        variant="secondary"
                        label={t.pots.share}
                        onPress={() => show('qr', pot.id)}
                      />
                    </View>
                  );
                })
            : null}
          {sheet === 'qr' && pot ? (
            <>
              <Text>
                {treasurer} · {fmt(BigInt(pot.per_head_minor))}
              </Text>
              {qr ? (
                <View
                  style={{
                    alignSelf: 'center',
                    backgroundColor: '#fff',
                    padding: theme.spacing.md,
                  }}
                >
                  <QRCode value={qr} size={200} />
                </View>
              ) : (
                <Text tone="muted">{t.pots.noVpa}</Text>
              )}
              <Button
                label={t.pots.share}
                onPress={() =>
                  void Share.share({
                    message: `${WEB_URL}/pay/${encodeURIComponent(pot.pay_code)}`,
                  }).catch(() => setError(t.couldNotSave))
                }
              />
              <Button
                label={t.pots.paidIn}
                variant="secondary"
                onPress={() => show('paid', pot.id)}
              />
            </>
          ) : null}
          {sheet === 'close' && pot && position && canManage ? (
            <>
              <Text tone="muted">{t.pots.closeHint}</Text>
              {(['refund', 'topup'] as const).map((kind) => (
                <View key={kind} style={{ gap: theme.spacing.sm }}>
                  <Text variant="subheading">{t.pots[kind]}</Text>
                  {!position.members.some(
                    (member) =>
                      member.memberId !== pot.treasurer_member_id &&
                      (kind === 'refund' ? member.getsBack > 0n : member.owes > 0n),
                  ) ? (
                    <Text variant="caption" tone="muted">
                      {t.pots.none}
                    </Text>
                  ) : null}
                  {position.members
                    .filter(
                      (member) =>
                        member.memberId !== pot.treasurer_member_id &&
                        (kind === 'refund' ? member.getsBack > 0n : member.owes > 0n),
                    )
                    .map((member) => (
                      <View key={member.memberId}>
                        <Text>{name(member.memberId)}</Text>
                        <Text variant="caption" tone="muted">
                          {fill(member.owes > 0n ? t.pots.owes : t.pots.person, {
                            paid: fmt(member.paidIn),
                            used: fmt(member.used),
                            back: fmt(member.owes || member.getsBack),
                          })}
                        </Text>
                      </View>
                    ))}
                </View>
              ))}
              <Button
                label={t.pots.close}
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    await close.mutateAsync({
                      potId: pot.id,
                      clientMutationId: mutationId(`close:${pot.id}`),
                    });
                    setSheet(null);
                  })
                }
              />
              {visibility.canStart ? (
                <Button
                  label={t.pots.carry}
                  variant="secondary"
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      if (!visibility.canStart) return;
                      await carry.mutateAsync({
                        potId: pot.id,
                        name: pot.name,
                        clientMutationId: mutationId(`carry:${pot.id}`),
                      });
                      setSheet(null);
                    })
                  }
                />
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </Sheet>
    </>
  );
}
