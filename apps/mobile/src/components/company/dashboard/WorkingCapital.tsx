/**
 * Owner Home: working capital ("₹12,400 left of ₹50,000" with a bar and an edit action) and each
 * company-wide cap's usage. Caps only warn; nothing here blocks anything.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { Pressable, TextInput, View } from 'react-native';

import {
  capUsages,
  format,
  money,
  parseMinorInput,
  workingCapital,
  type CompanyPolicyRule,
  type CurrencyCode,
} from '@waves/core';
import { Button, Chip, ProgressBar, Row, Sheet, Text, iconSize, useTheme } from '@waves/ui';

import { capPeriodWord } from '@/components/company/capLabels';
import { TintCard } from '@/components/company/dashboard/overviewKit';
import { useCompanyEntries, useSetCompanyPolicies } from '@/data/companyEntries';
import { useCompanySpend } from '@/data/companyCapital';
import { todayIso } from '@/data/personal';
import { fill, useStrings } from '@/i18n';
import { friendlyError } from '@/lib/errors';

export function WorkingCapitalCard({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const view = useCompanyEntries(groupId);
  const spend = useCompanySpend(groupId);
  const [open, setOpen] = useState(false);
  if (!view.isOwner || !view.ready) return null;
  const fmt = (minor: bigint): string =>
    format(money(minor, view.currency as CurrencyCode), { locale });
  const cap = workingCapital(view.policies, spend);
  const usages = capUsages(view.policies, spend, todayIso());
  const low = cap.left < 0n;
  const fraction = cap.capital > 0n ? Number((cap.left * 1000n) / cap.capital) / 1000 : 0;
  return (
    <>
      <TintCard style={{ gap: 10 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={cap.set ? t.company.capitalAdd : t.company.capitalSet}
          onPress={() => setOpen(true)}
          style={{ gap: 6 }}
        >
          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="body">{t.company.capitalTitle}</Text>
            <Ionicons
              name={cap.set ? 'create-outline' : 'add-circle-outline'}
              size={iconSize.md}
              color={theme.color.brand}
            />
          </Row>
          {cap.set ? (
            <>
              <Text
                variant="title"
                style={{
                  fontSize: 17,
                  fontWeight: '700',
                  color: low ? theme.color.warning : undefined,
                }}
              >
                {fill(t.company.capitalLeft, { left: fmt(cap.left), total: fmt(cap.capital) })}
              </Text>
              <ProgressBar progress={Math.max(0, Math.min(1, fraction))} height={6} />
            </>
          ) : (
            <Text variant="caption" tone="muted">
              {t.company.capitalHint}
            </Text>
          )}
        </Pressable>
        {usages.map((u) => (
          <View key={u.ruleId} style={{ gap: 4 }}>
            <Text
              variant="caption"
              style={{ color: u.over ? theme.color.warning : theme.color.textMuted }}
            >
              {u.over ? `! ${t.company.capOver} · ` : ''}
              {fill(t.company.capUsage, {
                used: fmt(u.used),
                limit: fmt(u.limit),
                period: capPeriodWord(t, u.period, u.days, 'usage'),
              })}
            </Text>
            <ProgressBar
              progress={u.limit > 0n ? Math.min(1, Number((u.used * 1000n) / u.limit) / 1000) : 1}
              height={4}
            />
          </View>
        ))}
      </TintCard>
      <CapitalSheet
        groupId={groupId}
        visible={open}
        onClose={() => setOpen(false)}
        currency={view.currency as CurrencyCode}
        rules={view.policies.rules}
        revision={view.policyRevision}
        memberId={view.me?.id ?? null}
      />
    </>
  );
}

/** Add money to, or take money out of, the working capital: one more auditable record. */
function CapitalSheet({
  groupId,
  visible,
  onClose,
  currency,
  rules,
  revision,
  memberId,
}: {
  groupId: string;
  visible: boolean;
  onClose: () => void;
  currency: CurrencyCode;
  rules: readonly CompanyPolicyRule[];
  revision: number;
  memberId: string | null;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const save = useSetCompanyPolicies(groupId);
  const [text, setText] = useState('');
  const [out, setOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = parseMinorInput(text, currency);
  const first = !rules.some((r) => r.type === 'capital');
  const done = (): void => {
    setText('');
    setOut(false);
    setError(null);
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={done} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.lg }}>
        <Text variant="title">{first ? t.company.capitalSet : t.company.capitalTitle}</Text>
        {first ? null : (
          <Row style={{ gap: theme.spacing.sm }}>
            <Chip
              label={t.company.capitalAdd}
              selected={!out}
              repeatable
              onPress={() => setOut(false)}
            />
            <Chip
              label={t.company.capitalTakeOut}
              selected={out}
              repeatable
              onPress={() => setOut(true)}
            />
          </Row>
        )}
        <TextInput
          value={text}
          onChangeText={setText}
          keyboardType="decimal-pad"
          autoFocus
          accessibilityLabel={t.company.capitalTitle}
          placeholderTextColor={theme.color.textFaint}
          placeholder="0"
          style={{
            borderWidth: 1,
            borderColor: theme.color.border,
            borderRadius: theme.radius.lg,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            fontSize: 16,
            color: theme.color.text,
            backgroundColor: theme.color.surface,
          }}
        />
        {error ? (
          <Text variant="caption" tone="negative">
            {error}
          </Text>
        ) : null}
        <Row style={{ gap: theme.spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button label={t.common.cancel} variant="secondary" fullWidth onPress={done} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={save.isPending ? t.common.loading : t.common.save}
              fullWidth
              disabled={amount <= 0n || save.isPending}
              onPress={() => {
                const rule: CompanyPolicyRule = {
                  id: randomUUID(),
                  type: 'capital',
                  limitMinor: amount.toString(),
                  direction: out ? 'out' : 'in',
                  effect: 'warn',
                  by: memberId,
                  at: new Date().toISOString(),
                };
                save
                  .mutateAsync({
                    policies: { version: 1, rules: [...rules, rule] },
                    expectedRevision: revision,
                  })
                  .then(done)
                  .catch((caught) =>
                    setError(friendlyError(caught, t.company.couldNotSave, 'company.policy')),
                  );
              }}
            />
          </View>
        </Row>
      </View>
    </Sheet>
  );
}

/** Add a company-wide cap: an amount and a period (a preset or every N days). */
export function CapSheet({
  visible,
  onClose,
  currency,
  onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  currency: CurrencyCode;
  onAdd: (rule: CompanyPolicyRule) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [text, setText] = useState('');
  const [preset, setPreset] = useState<'1' | '3' | 'week' | 'month' | 'year' | 'n'>('week');
  const [n, setN] = useState('');
  const amount = parseMinorInput(text, currency);
  const everyN = Math.floor(Number(n));
  const valid =
    amount > 0n && (preset !== 'n' || (Number.isFinite(everyN) && everyN >= 1 && everyN <= 9999));
  const chips: readonly [typeof preset, string][] = [
    ['1', t.company.capDay],
    ['3', t.company.cap3Days],
    ['week', t.company.capWeek],
    ['month', t.company.capMonth],
    ['year', t.company.capYear],
    ['n', t.company.capEveryN],
  ];
  const field = {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontSize: 16,
    color: theme.color.text,
    backgroundColor: theme.color.surface,
  } as const;
  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.lg }}>
        <Text variant="title">{t.company.capAdd}</Text>
        <TextInput
          value={text}
          onChangeText={setText}
          keyboardType="decimal-pad"
          autoFocus
          accessibilityLabel={t.company.capAdd}
          placeholder="0"
          placeholderTextColor={theme.color.textFaint}
          style={field}
        />
        <Row style={{ gap: theme.spacing.sm, flexWrap: 'wrap' }}>
          {chips.map(([key, label]) => (
            <Chip
              key={key}
              label={label}
              selected={preset === key}
              repeatable
              onPress={() => setPreset(key)}
            />
          ))}
        </Row>
        {preset === 'n' ? (
          <TextInput
            value={n}
            onChangeText={(v) => setN(v.replace(/\D/g, '').slice(0, 4))}
            keyboardType="number-pad"
            accessibilityLabel={t.company.capDaysLabel}
            placeholder={t.company.capDaysLabel}
            placeholderTextColor={theme.color.textFaint}
            style={field}
          />
        ) : null}
        <Row style={{ gap: theme.spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button label={t.common.cancel} variant="secondary" fullWidth onPress={onClose} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={t.common.save}
              fullWidth
              disabled={!valid}
              onPress={() => {
                const days =
                  preset === '1' ? 1 : preset === '3' ? 3 : preset === 'n' ? everyN : null;
                onAdd({
                  id: randomUUID(),
                  type: 'company_cap',
                  limitMinor: amount.toString(),
                  period: days === null ? (preset as 'week' | 'month' | 'year') : 'days',
                  ...(days === null ? {} : { days }),
                  effect: 'warn',
                });
                setText('');
                setN('');
              }}
            />
          </View>
        </Row>
      </View>
    </Sheet>
  );
}
