/**
 * Sites (projects): where the money went. Owner only. The list appears once the
 * first site exists; "Add a site" lives in the owner's settings card until then.
 * Spent is approved expenses, bata and wages tagged to the site; advances are cash,
 * not spend. A budget is optional and draws a bar.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { randomUUID } from 'expo-crypto';

import {
  format,
  money,
  parseMinorInput,
  formatMinorInput,
  projectSpend,
  type CurrencyCode,
} from '@waves/core';
import { useTheme } from '@waves/ui';

import { EditTextSheet } from '@/components/EditTextSheet';
import { ListRow, SectionHeader, StandardCard } from '@/components/standard';
import {
  useCompanyProjects,
  useSetCompanyProject,
  useWageSplits,
  type CompanyView,
} from '@/data/companyEntries';
import { fill, useStrings } from '@/i18n';

export function useAddSiteSheet(groupId: string) {
  const [open, setOpen] = useState(false);
  const set = useSetCompanyProject(groupId);
  const { t } = useStrings();
  const sheet = (
    <EditTextSheet
      visible={open}
      title={t.company.siteName}
      value=""
      saving={set.isPending}
      onClose={() => setOpen(false)}
      onSave={(name) => {
        setOpen(false);
        set.mutate({ projectId: randomUUID(), name, budgetMinor: null, archived: false });
      }}
    />
  );
  return { open: () => setOpen(true), sheet };
}

export function CompanySites({ groupId, view }: { groupId: string; view: CompanyView }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const projects = useCompanyProjects(groupId).filter((p) => !p.archived_at);
  const set = useSetCompanyProject(groupId);
  const splits = useWageSplits(groupId);
  const [budgetFor, setBudgetFor] = useState<string | null>(null);
  if (!view.isOwner || projects.length === 0) return null;
  const currency = view.currency as CurrencyCode;
  const fmt = (minor: bigint): string => format(money(minor, currency), { locale });
  const spend = projectSpend(view.entries, splits);
  const editing = projects.find((p) => p.id === budgetFor) ?? null;

  return (
    <>
      <SectionHeader title={t.company.sites} />
      <StandardCard>
        {projects.map((project, index) => {
          const spent = spend.get(project.id) ?? 0n;
          const budget = project.budget_minor ? BigInt(project.budget_minor) : null;
          const ratio = budget && budget > 0n ? Number((spent * 1000n) / budget) / 1000 : 0;
          const over = budget !== null && spent > budget;
          return (
            <ListRow
              key={project.id}
              title={project.name}
              subtitle={
                budget === null
                  ? fill(t.company.siteSpentOnly, { spent: fmt(spent) })
                  : over
                    ? fill(t.company.siteOver, { amount: fmt(spent - budget) })
                    : fill(t.company.siteLeft, { amount: fmt(budget - spent) })
              }
              amount={
                budget === null
                  ? fmt(spent)
                  : fill(t.company.siteSpent, { spent: fmt(spent), budget: fmt(budget) })
              }
              onPress={() => setBudgetFor(project.id)}
              divider={index < projects.length - 1}
              footer={
                budget === null ? undefined : (
                  <View
                    accessibilityLabel={`${Math.round(ratio * 100)}%`}
                    style={{
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: theme.color.surfaceMuted,
                      overflow: 'hidden',
                    }}
                  >
                    <View
                      style={{
                        height: 6,
                        width: `${Math.min(100, Math.round(ratio * 100))}%`,
                        backgroundColor: over ? theme.color.negative : theme.color.brand,
                      }}
                    />
                  </View>
                )
              }
            />
          );
        })}
      </StandardCard>
      <EditTextSheet
        visible={editing !== null}
        title={editing ? `${editing.name} · ${t.company.siteBudget}` : ''}
        value={
          editing?.budget_minor ? formatMinorInput(BigInt(editing.budget_minor), currency) : ''
        }
        autoCapitalize="none"
        saving={set.isPending}
        onClose={() => setBudgetFor(null)}
        onSave={(text) => {
          if (!editing) return;
          setBudgetFor(null);
          set.mutate({
            projectId: editing.id,
            name: editing.name,
            budgetMinor: text.trim() === '' ? null : parseMinorInput(text, currency).toString(),
            archived: false,
          });
        }}
      />
    </>
  );
}
