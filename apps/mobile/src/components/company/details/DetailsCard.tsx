import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { Pressable, Share, View } from 'react-native';

import {
  maskValue,
  detailsToShareText,
  hasAnyDetail,
  type DetailKey,
  type DetailsCard as Card,
} from '../../../../../../packages/core/src/company/details';
import { Button, Text, useTheme, iconSize } from '@waves/ui';

import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { ListRow, StandardCard } from '@/components/standard';
import { relativeTime } from '@/data/activity';
import { useToast } from '@/lib/toast';
import { fill, useStrings } from '@/i18n';

const rows: readonly [
  DetailKey,
  (
    | 'accountName'
    | 'accountNumber'
    | 'ifsc'
    | 'upi'
    | 'address'
    | 'phone'
    | 'email'
    | 'gstin'
    | 'pan'
    | 'note'
  ),
][] = [
  ['bankName', 'accountName'],
  ['bankAccount', 'accountNumber'],
  ['ifsc', 'ifsc'],
  ['upi', 'upi'],
  ['address', 'address'],
  ['phone', 'phone'],
  ['email', 'email'],
  ['gstin', 'gstin'],
  ['pan', 'pan'],
  ['note', 'note'],
];
function labelsFor(
  s: ReturnType<typeof useStrings>['t']['companyDetails'],
): Record<DetailKey, string> {
  return {
    bankName: s.accountName,
    bankAccount: s.accountNumber,
    ifsc: s.ifsc,
    upi: s.upi,
    address: s.address,
    phone: s.phone,
    email: s.email,
    gstin: s.gstin,
    pan: s.pan,
    note: s.note,
  };
}

export function BankChangedNotice({
  view,
  onNoted,
}: {
  view: { show: boolean; at?: string | null };
  onNoted: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  if (!view.show || !view.at) return null;
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
    new Date(view.at),
  );
  return (
    <View
      style={{
        padding: theme.spacing.md,
        borderRadius: theme.radius.md,
        backgroundColor: theme.color.warningSoft,
        gap: theme.spacing.sm,
      }}
    >
      <Text>{fill(t.companyDetails.bankChanged, { date })}</Text>
      <Pressable accessibilityRole="button" onPress={onNoted}>
        <Text style={{ color: theme.color.brand }}>{t.companyDetails.noted}</Text>
      </Pressable>
    </View>
  );
}

export function DetailsCard({
  title,
  card,
  canEdit,
  onEdit,
  notice,
  shareTitle,
}: {
  title: string;
  card: Card | null;
  canEdit: boolean;
  onEdit: () => void;
  notice?: { show: boolean; onNoted: () => void };
  shareTitle: string;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const s = t.companyDetails;
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const [revealed, setRevealed] = useState<Partial<Record<DetailKey, boolean>>>({});
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer) clearTimeout(timer);
    },
    [timer],
  );
  const values = card?.values;
  const filled = values ? hasAnyDetail(values) : false;
  const items: OverflowMenuItem[] = [
    {
      icon: 'share-outline',
      label: s.shareAsText,
      onPress: () => {
        if (values)
          void Share.share({ message: detailsToShareText(shareTitle, values, labelsFor(s)) });
      },
    },
    ...(canEdit ? [{ icon: 'pencil-outline' as const, label: s.edit, onPress: onEdit }] : []),
  ];
  return (
    <StandardCard style={{ gap: theme.spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text variant="subheading" style={{ flex: 1 }}>
          {title}
        </Text>
        {filled || canEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.edit}
            onPress={() => setMenu(true)}
          >
            <Ionicons name="ellipsis-vertical" size={iconSize.md} color={theme.color.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {notice ? (
        <BankChangedNotice
          view={{ show: notice.show, at: card?.bankChangedAt }}
          onNoted={notice.onNoted}
        />
      ) : null}
      {filled && values ? (
        rows.map(([key, label]) => {
          const value = values[key];
          if (!value) return null;
          const masked = ['bankAccount', 'upi', 'pan'].includes(key) && !revealed[key];
          return (
            <ListRow
              key={key}
              title={s[label]}
              subtitle={masked ? maskValue(value) : value}
              subtitleLines={3}
              onPress={() => {
                void Clipboard.setStringAsync(value).then(() => toast.show(s.copied));
              }}
              trailing={
                ['bankAccount', 'upi', 'pan'].includes(key) ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={revealed[key] ? s.hide : s.reveal}
                    hitSlop={8}
                    onPress={() => {
                      if (revealed[key]) {
                        setRevealed((v) => ({ ...v, [key]: false }));
                        return;
                      }
                      setRevealed((v) => ({ ...v, [key]: true }));
                      if (timer) clearTimeout(timer);
                      setTimer(
                        setTimeout(() => setRevealed((v) => ({ ...v, [key]: false })), 10000),
                      );
                    }}
                  >
                    <Ionicons
                      name={revealed[key] ? 'eye-off-outline' : 'eye-outline'}
                      size={iconSize.md}
                      color={theme.color.textMuted}
                    />
                  </Pressable>
                ) : undefined
              }
            />
          );
        })
      ) : canEdit ? (
        <View style={{ alignItems: 'flex-start' }}>
          <Button label={s.addDetails} size="sm" onPress={onEdit} />
        </View>
      ) : (
        <Text variant="caption" tone="muted">
          {s.empty}
        </Text>
      )}
      {card?.updatedAt && filled ? (
        <Text variant="caption" tone="muted">
          {fill(s.updatedAgo, {
            when: relativeTime(locale, card.updatedAt),
            name: card.updatedByName
              ? locale.startsWith('en')
                ? ` by ${card.updatedByName}`
                : card.updatedByName
              : '',
          })}
        </Text>
      ) : null}
      <OverflowMenu visible={menu} onClose={() => setMenu(false)} items={items} />
    </StandardCard>
  );
}
