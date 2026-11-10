import { View } from 'react-native';

import type { ClientPriority, ClientSource, ClientStage } from '@waves/core';
import { Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { shiftDay } from '@/lib/companyClients';
import { showDate } from '@/lib/expenseDay';

/** The small stage pill at the end of a client row. */
export function StageChip({ stage }: { stage: ClientStage }) {
  const theme = useTheme();
  const { t } = useStrings();
  const c = theme.color;
  const look = {
    inquiry: [c.warningSoft, c.warning, t.companyClients.stInquiry],
    quoted: [c.brandSoft, c.brand, t.companyClients.stQuoted],
    client: [c.positiveSoft, c.positive, t.companyClients.stClient],
    lost: [c.surfaceMuted, c.textMuted, t.companyClients.stLost],
  }[stage];
  return (
    <View
      style={{
        backgroundColor: look[0],
        borderRadius: theme.radius.sm,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 2,
      }}
    >
      <Text variant="micro" style={{ color: look[1], fontWeight: '700' }}>
        {look[2]}
      </Text>
    </View>
  );
}

export function useSourceLabel(): (source: ClientSource) => string {
  const { t } = useStrings();
  const s = t.companyClients;
  return (source) =>
    ({
      walk_in: s.srcWalkIn,
      call: s.srcCall,
      whatsapp: s.srcWhatsapp,
      referral: s.srcReferral,
      other: s.srcOther,
    })[source];
}

/** Categories offered on the form; the column is free text, so older or other values show as stored. */
export const CLIENT_CATEGORIES = [
  'plumbing',
  'electrical',
  'civil',
  'interiors',
  'maintenance',
  'other',
] as const;

export function useCategoryLabel(): (category: string) => string {
  const { t } = useStrings();
  const s = t.companyClients;
  const known: Record<string, string> = {
    plumbing: s.catPlumbing,
    electrical: s.catElectrical,
    civil: s.catCivil,
    interiors: s.catInteriors,
    maintenance: s.catMaintenance,
    other: s.catOther,
  };
  return (category) => known[category] ?? category;
}

export function usePriorityLabel(): (priority: ClientPriority) => string {
  const { t } = useStrings();
  const s = t.companyClients;
  return (priority) => ({ normal: s.prNormal, urgent: s.prUrgent, high: s.prHigh })[priority];
}

/** "Today", "Tomorrow", "Yesterday" or the short date, with the time when there is one. */
export function useWhen(): (day: string, today: string, time?: string | null) => string {
  const { t, locale } = useStrings();
  return (day, today, time) => {
    const label =
      day === today
        ? t.companyClients.fuToday
        : day === shiftDay(today, 1)
          ? t.companyClients.fuTomorrow
          : showDate(day, locale);
    return time ? `${label} ${time}` : label;
  };
}
