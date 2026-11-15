import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { receiptLabel, sortVendorLines, type VendorLine } from '@waves/core';
import { Text, useTheme } from '@waves/ui';

import { Pill, TONES, useMethodLabels } from '@/components/company/vendors/parts';
import { StandardCard } from '@/components/standard';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

/** The vendor's lines, newest first. Every row opens its detail: a payment its receipt, the rest the line. */
export function VendorActivity({
  groupId,
  lines,
  money,
  date,
  billsOnly = false,
}: {
  groupId: string;
  lines: readonly VendorLine[];
  money: (amount: bigint) => string;
  date: (iso: string) => string;
  billsOnly?: boolean;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyVendors;
  const methods = useMethodLabels();
  const rows = sortVendorLines(billsOnly ? lines.filter((l) => l.kind === 'bill') : lines);
  return (
    <StandardCard>
      {rows.length === 0 ? <Text tone="muted">{s.historyEmpty}</Text> : null}
      {rows.map((line, index) => {
        const [ink, tint] =
          line.kind === 'payment'
            ? TONES.good
            : line.kind === 'advance'
              ? TONES.warn
              : ([theme.color.brand, theme.color.brandSoft] as const);
        const status =
          line.pending || line.status === 'pending'
            ? s.pending
            : line.status === 'rejected'
              ? s.rejected
              : billsOnly
                ? s.confirmed
                : null;
        return (
          <Pressable
            key={line.id}
            accessibilityRole="button"
            onPress={() =>
              router.push(
                line.kind === 'payment'
                  ? `/group/${groupId}/company-vendor-receipt?entryId=${line.id}`
                  : `/group/${groupId}/company-vendor-line?entryId=${line.id}`,
              )
            }
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
              borderBottomWidth: index < rows.length - 1 ? 1 : 0,
              borderBottomColor: theme.color.border,
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: tint,
              }}
            >
              <Ionicons
                name={
                  line.kind === 'payment'
                    ? 'checkmark-circle-outline'
                    : line.kind === 'advance'
                      ? 'arrow-up-circle-outline'
                      : 'document-text-outline'
                }
                size={22}
                color={ink}
              />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={{ fontWeight: '600' }}>
                {line.kind === 'payment' && line.receiptNo
                  ? `${s.payment} ${receiptLabel(line.receiptNo)}`
                  : s[line.kind]}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={2}>
                {[date(line.occurredOn), line.method ? methods[line.method] : line.note]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {status ? (
                <Pill label={status} tone={line.status === 'rejected' ? 'bad' : undefined} />
              ) : null}
            </View>
            <Text
              tabular
              style={{
                fontWeight: '700',
                color: line.kind === 'bill' ? theme.color.text : TONES.good[0],
              }}
            >
              {`${line.kind === 'bill' ? '+' : '−'}${money(line.amount)}`}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={theme.color.textMuted} />
          </Pressable>
        );
      })}
    </StandardCard>
  );
}
