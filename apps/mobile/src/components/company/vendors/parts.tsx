/** Small pieces the vendor screens share: status chip, money/date formatting, PDF labels. */
import { View } from 'react-native';

import type { VendorStatus } from '@waves/core';
import { Text, useTheme } from '@waves/ui';

import { useMoney } from '@/components/company/dashboard/parts';
import { useStrings } from '@/i18n';
import { showDate } from '@/lib/expenseDay';

/** Chip colours: [text, fill]. Tweak here when the reference design arrives. */
const TONES = {
  good: ['#17703C', '#EAF7EF'],
  bad: ['#C0262D', '#FDECEC'],
  warn: ['#A85F00', '#FFF3E3'],
} as const;

export function Pill({ label, tone }: { label: string; tone?: keyof typeof TONES }) {
  const theme = useTheme();
  const [ink, fill] = tone ? TONES[tone] : [theme.color.textMuted, theme.color.surfaceMuted];
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        borderRadius: theme.radius.pill,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 2,
        backgroundColor: fill,
      }}
    >
      <Text variant="micro" style={{ color: ink, fontWeight: '600' }}>
        {label}
      </Text>
    </View>
  );
}

export function StatusChip({ status }: { status: VendorStatus }) {
  const { t } = useStrings();
  const s = t.companyVendors;
  return status === 'settled' ? (
    <Pill label={s.settled} tone="good" />
  ) : status === 'overdue' ? (
    <Pill label={s.statusOverdue} tone="bad" />
  ) : status === 'toReview' ? (
    <Pill label={s.statusToReview} tone="warn" />
  ) : (
    <Pill label={s.statusToPay} />
  );
}

export function useVendorFormat(currency: string) {
  const { locale } = useStrings();
  const money = useMoney(currency);
  return { money, date: (iso: string) => showDate(iso, locale) };
}

export function useMethodLabels(): Record<string, string> {
  const { t } = useStrings();
  const s = t.companyVendors;
  return { upi: s.mUpi, bank: s.mBank, cash: s.mCash, other: s.mOther };
}
