/**
 * Manager cash (the "float"): what an owner gave a manager to hand out, less what
 * the manager has paid out. A manager sees one card with their own cash; an owner
 * sees a list of managers (shown only once somebody is a manager) and can give cash,
 * take it back or correct it. A take-back or correction needs a written reason.
 */

import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { AmountField, Button, ChipRow, Row, Sheet, Text, useTheme } from '@waves/ui';
import { format, formatParts, money, validPoolReason, type CurrencyCode } from '@waves/core';

import { PersonAvatar } from '@/components/PersonAvatar';
import { ListRow, SectionHeader, StandardCard, StatCard } from '@/components/standard';
import { usePoolBalance, usePostPool, type CompanyView } from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { displayName, isGhost, type MemberRow } from '@/data/types';
import { useStrings } from '@/i18n';

type Action = 'allocation' | 'pool_return' | 'pool_adjustment';

export function ManagerCashCard({ groupId, view }: { groupId: string; view: CompanyView }) {
  const { t, locale } = useStrings();
  const balance = usePoolBalance(groupId, view.me?.id ?? null);
  if (balance === null) return null;
  const currency = view.currency as CurrencyCode;
  const parts = formatParts({ minor: balance, currency }, { locale });
  return (
    <StatCard
      label={t.company.cashLeft}
      lead={parts.lead}
      fraction={`${parts.fraction}${parts.trail}`}
      accessibilityLabel={`${t.company.cashLeft}: ${format(money(balance, currency), { locale })}`}
    />
  );
}

function ManagerRow({
  groupId,
  view,
  manager,
  onPress,
}: {
  groupId: string;
  view: CompanyView;
  manager: MemberRow;
  onPress: () => void;
}) {
  const { t, locale } = useStrings();
  const balance = usePoolBalance(groupId, manager.id);
  return (
    <ListRow
      leading={
        <PersonAvatar
          member={manager}
          name={displayName(manager)}
          ghost={isGhost(manager)}
          size={36}
        />
      }
      title={displayName(manager, null, null, t.misc.someone)}
      subtitle={t.company.cashLeft}
      amount={
        balance === null ? '' : format(money(balance, view.currency as CurrencyCode), { locale })
      }
      onPress={onPress}
      divider
    />
  );
}

/** Owner: cash with each manager. Nothing shows until a manager exists. */
export function OwnerCashList({ groupId, view }: { groupId: string; view: CompanyView }) {
  const { t } = useStrings();
  const [picked, setPicked] = useState<MemberRow | null>(null);
  const managers = view.members.filter((m) => m.role === 'manager' && !m.left_at);
  if (!view.isOwner || managers.length === 0) return null;
  return (
    <>
      <SectionHeader title={t.company.cashWithManagers} />
      <StandardCard>
        {managers.map((manager) => (
          <ManagerRow
            key={manager.id}
            groupId={groupId}
            view={view}
            manager={manager}
            onPress={() => setPicked(manager)}
          />
        ))}
      </StandardCard>
      <CashSheet groupId={groupId} view={view} manager={picked} onClose={() => setPicked(null)} />
    </>
  );
}

function CashSheet({
  groupId,
  view,
  manager,
  onClose,
}: {
  groupId: string;
  view: CompanyView;
  manager: MemberRow | null;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const post = usePostPool(groupId);
  const [action, setAction] = useState<Action>('allocation');
  const [amount, setAmount] = useState(0n);
  const [minus, setMinus] = useState(false);
  const [reason, setReason] = useState('');
  const needsReason = action !== 'allocation';
  const ok = amount > 0n && (!needsReason || validPoolReason(reason));

  const close = (): void => {
    setAmount(0n);
    setReason('');
    setMinus(false);
    setAction('allocation');
    onClose();
  };
  const save = (): void => {
    if (!manager || !ok) return;
    post.mutate(
      {
        managerId: manager.id,
        kind: action,
        amountMinor: ((action === 'pool_adjustment' && minus ? -amount : amount) as bigint).toString(),
        projectId: null,
        occurredOn: todayIso(),
        reason: needsReason ? reason.trim() : null,
      },
      { onSuccess: close },
    );
  };

  return (
    <Sheet visible={manager !== null} onClose={close} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.lg }}>
        <Text variant="title">
          {manager ? displayName(manager, null, null, t.misc.someone) : ''}
        </Text>
        <ChipRow
          wrap
          options={[
            { value: 'allocation' as Action, label: t.company.giveCash },
            { value: 'pool_return' as Action, label: t.company.takeBack },
            { value: 'pool_adjustment' as Action, label: t.company.correctCash },
          ]}
          value={action}
          onChange={setAction}
        />
        {action === 'pool_adjustment' ? (
          <ChipRow
            options={[
              { value: '+', label: '+' },
              { value: '-', label: '-' },
            ]}
            value={minus ? '-' : '+'}
            onChange={(next) => setMinus(next === '-')}
          />
        ) : null}
        <AmountField
          currency={view.currency as CurrencyCode}
          value={amount}
          onChange={setAmount}
          size="compact"
        />
        {needsReason ? (
          <View style={{ gap: theme.spacing.xs }}>
            <TextInput
              value={reason}
              onChangeText={setReason}
              maxLength={500}
              placeholder={t.company.reasonRequired}
              placeholderTextColor={theme.color.textFaint}
              accessibilityLabel={t.company.reasonRequired}
              style={{
                borderWidth: 1,
                borderColor: theme.color.border,
                borderRadius: theme.radius.lg,
                padding: theme.spacing.md,
                fontSize: 16,
                color: theme.color.text,
                backgroundColor: theme.color.surface,
              }}
            />
            <Text variant="caption" tone="muted">
              {t.company.poolReasonHint}
            </Text>
          </View>
        ) : null}
        <Row style={{ gap: theme.spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button label={t.common.cancel} variant="secondary" fullWidth onPress={close} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={t.common.save}
              fullWidth
              disabled={!ok || post.isPending}
              onPress={save}
            />
          </View>
        </Row>
      </View>
    </Sheet>
  );
}
