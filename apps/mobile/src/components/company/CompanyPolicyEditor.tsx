/**
 * Admin: the company's policy hints, edited inline on the company home. A rule is
 * a receipt threshold or a per-category / bata limit per day or month. Warn is the
 * default; Block (limits only) stops an entry that goes over. One Save per change,
 * naming the revision edited so two admins cannot overwrite each other blindly.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { Pressable } from 'react-native';

import {
  COMPANY_EXPENSE_CATEGORIES,
  format,
  formatMinorInput,
  money,
  parseMinorInput,
  type CompanyPolicyRule,
  type CurrencyCode,
} from '@waves/core';
import { Text, iconSize, useTheme } from '@waves/ui';

import { EditTextSheet } from '@/components/EditTextSheet';
import { ListRow } from '@/components/standard';
import { useSetCompanyPolicies, type CompanyView } from '@/data/companyEntries';
import { fill, useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';

type Draft = { kind: 'receipt' } | { kind: 'limit'; target: string; period: 'day' | 'month' };

export function CompanyPolicyEditor({ groupId, view }: { groupId: string; view: CompanyView }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { choose } = useDialog();
  const save = useSetCompanyPolicies(groupId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currency = view.currency as CurrencyCode;
  const fmt = (minor: bigint): string => format(money(minor, currency), { locale });
  const targetLabel = (target: string): string =>
    target === 'allowance'
      ? t.company.bata
      : (t.company[
          (
            {
              fuel: 'catFuel',
              transport: 'catTransport',
              travel: 'catTravel',
              food: 'catFood',
              office: 'catOffice',
            } as const
          )[target as 'fuel'] ?? 'catOther'
        ] as string);

  const commit = (rules: readonly CompanyPolicyRule[]): void => {
    setError(null);
    save
      .mutateAsync({
        policies: { version: 1, rules },
        expectedRevision: view.policyRevision,
      })
      .catch((caught) => setError(friendlyError(caught, t.company.couldNotSave, 'company.policy')));
  };

  const addLimit = async (): Promise<void> => {
    const target = await choose({
      title: t.company.formCategory,
      options: [
        { id: 'allowance', label: t.company.bata },
        ...COMPANY_EXPENSE_CATEGORIES.map((c) => ({ id: c as string, label: targetLabel(c) })),
      ],
    });
    if (!target) return;
    const period = await choose({
      title: t.company.policyLimitLabel,
      options: [
        { id: 'day', label: t.company.perDay },
        { id: 'month', label: t.company.perMonth },
      ],
    });
    if (period === 'day' || period === 'month') setDraft({ kind: 'limit', target, period });
  };

  return (
    <>
      {view.policies.rules.length === 0 ? (
        <ListRow title={t.company.policiesTitle} subtitle={t.company.policyNone} divider />
      ) : (
        view.policies.rules.map((rule) => (
          <ListRow
            key={rule.id}
            title={
              rule.type === 'receipt_above'
                ? fill(t.company.policyReceipt, { amount: fmt(BigInt(rule.limitMinor)) })
                : fill(t.company.policyLimit, {
                    what: targetLabel(rule.target),
                    amount: fmt(BigInt(rule.limitMinor)),
                    period: rule.period === 'day' ? t.company.perDay : t.company.perMonth,
                  })
            }
            subtitle={rule.effect === 'block' ? t.company.policyBlock : t.company.policyWarn}
            onPress={
              rule.type === 'period_limit'
                ? () =>
                    commit(
                      view.policies.rules.map((r) =>
                        r.id === rule.id && r.type === 'period_limit'
                          ? { ...r, effect: r.effect === 'warn' ? 'block' : 'warn' }
                          : r,
                      ),
                    )
                : undefined
            }
            trailing={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.company.policyRemove}
                hitSlop={10}
                onPress={() => commit(view.policies.rules.filter((r) => r.id !== rule.id))}
              >
                <Ionicons
                  name="close-circle-outline"
                  size={iconSize.md}
                  color={theme.color.textMuted}
                />
              </Pressable>
            }
            divider
          />
        ))
      )}
      <ListRow
        title={t.company.policyAddReceipt}
        leading={
          <Ionicons name="add-circle-outline" size={iconSize.md} color={theme.color.brand} />
        }
        onPress={() => setDraft({ kind: 'receipt' })}
        divider
      />
      <ListRow
        title={t.company.policyAddLimit}
        subtitle={t.company.policyEditorHint}
        leading={
          <Ionicons name="add-circle-outline" size={iconSize.md} color={theme.color.brand} />
        }
        onPress={() => void addLimit()}
        divider
      />
      {error ? (
        <Text variant="caption" tone="negative">
          {error}
        </Text>
      ) : null}
      <EditTextSheet
        visible={draft !== null}
        title={t.company.policyLimitLabel}
        value={formatMinorInput(0n, currency)}
        autoCapitalize="none"
        saving={save.isPending}
        onClose={() => setDraft(null)}
        onSave={(text) => {
          const limit = parseMinorInput(text, currency);
          const current = draft;
          setDraft(null);
          if (!current || limit <= 0n) return;
          const rule: CompanyPolicyRule =
            current.kind === 'receipt'
              ? {
                  id: randomUUID(),
                  type: 'receipt_above',
                  limitMinor: limit.toString(),
                  effect: 'warn',
                }
              : {
                  id: randomUUID(),
                  type: 'period_limit',
                  target: current.target,
                  period: current.period,
                  limitMinor: limit.toString(),
                  effect: 'warn',
                };
          commit([...view.policies.rules, rule]);
        }}
      />
    </>
  );
}
