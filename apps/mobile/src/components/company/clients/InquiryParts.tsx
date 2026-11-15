import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform, Pressable, TextInput, View } from 'react-native';

import type { CompanyInquiry, CurrencyCode, InquiryStatus } from '@waves/core';
import { AmountField, Button, Sheet, Text, useTheme } from '@waves/ui';

import { PersonAvatar } from '@/components/PersonAvatar';
import { useAssignClient, useSetInquiry } from '@/data/companyClients';
import { todayIso } from '@/data/personal';
import { displayName, type MemberRow } from '@/data/types';
import { useStrings } from '@/i18n';
import { dateFrom, isoDate, showDate } from '@/lib/expenseDay';

/** The pill, tile colours and glyph of one inquiry status (Quoted purple, Rejected red, Won green, Open neutral). */
export function useInquiryLook(): (status: InquiryStatus) => {
  label: string;
  fg: string;
  bg: string;
  tileFg: string;
  tileBg: string;
  icon?: keyof typeof Ionicons.glyphMap;
} {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyClients;
  const c = theme.color;
  return (status) =>
    ({
      quoted: {
        label: s.inqStQuoted,
        fg: c.brand,
        bg: c.brandSoft,
        tileFg: c.brand,
        tileBg: c.brandSoft,
      },
      rejected: {
        label: s.inqStRejected,
        fg: c.negative,
        bg: c.negativeSoft,
        tileFg: c.warning,
        tileBg: c.warningSoft,
      },
      won: {
        label: s.inqStWon,
        fg: c.positive,
        bg: c.positiveSoft,
        tileFg: c.positive,
        tileBg: c.positiveSoft,
        icon: 'trophy-outline' as const,
      },
      open: {
        label: s.inqStOpen,
        fg: c.textMuted,
        bg: c.surfaceMuted,
        tileFg: c.textMuted,
        tileBg: c.surfaceMuted,
      },
    })[status];
}

export function InquiryStatusPill({ status }: { status: InquiryStatus }) {
  const theme = useTheme();
  const look = useInquiryLook()(status);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: look.bg,
        borderRadius: theme.radius.sm,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: 4,
      }}
    >
      {look.icon ? <Ionicons name={look.icon} size={14} color={look.fg} /> : null}
      <Text variant="caption" style={{ color: look.fg, fontWeight: '700' }}>
        {look.label}
      </Text>
    </View>
  );
}

const TILE_ICONS = [
  'file-tray-stacked-outline',
  'albums-outline',
  'cube-outline',
  'layers-outline',
] as const;

/** The 44dp coloured tile that leads an inquiry row; the glyph follows the number, the colour the status. */
export function InquiryTile({
  inquiry,
  status,
}: {
  inquiry: CompanyInquiry;
  status: InquiryStatus;
}) {
  const look = useInquiryLook()(status);
  return (
    <View
      style={{
        width: 48,
        height: 48,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: look.tileBg,
      }}
    >
      <Ionicons
        name={TILE_ICONS[inquiry.number % TILE_ICONS.length]!}
        size={24}
        color={look.tileFg}
      />
    </View>
  );
}

/** New inquiry (no `inquiry`) or edit one: title, details, expected value, date. */
export function InquirySheet({
  visible,
  onClose,
  groupId,
  clientId,
  inquiry,
  currency,
}: {
  visible: boolean;
  onClose: () => void;
  groupId: string;
  clientId: string;
  inquiry?: CompanyInquiry;
  currency: string;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const s = t.companyClients;
  const save = useSetInquiry(groupId);
  const [title, setTitle] = useState(inquiry?.title ?? '');
  const [details, setDetails] = useState(inquiry?.details ?? '');
  const [value, setValue] = useState(inquiry?.expectedValueMinor ?? 0n);
  const [date, setDate] = useState(inquiry?.inquiryDate ?? todayIso());
  const [picking, setPicking] = useState(false);
  const [failed, setFailed] = useState(false);
  const field = {
    color: theme.color.text,
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.surfaceMuted,
  };
  const openDate = () => {
    if (Platform.OS === 'android')
      DateTimePickerAndroid.open({
        value: dateFrom(date),
        mode: 'date',
        onChange: (event, picked) => {
          if (event.type === 'set' && picked) setDate(isoDate(picked));
        },
      });
    else setPicking(!picking);
  };
  const submit = async () => {
    if (!title.trim() || save.isPending) return;
    setFailed(false);
    try {
      await save.mutateAsync({
        inquiryId: inquiry?.id,
        clientId,
        title,
        details,
        expectedValueMinor: value > 0n ? value.toString() : null,
        inquiryDate: date,
      });
      onClose();
    } catch {
      setFailed(true);
    }
  };
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t.common.close}
      title={inquiry ? s.inqFormEdit : s.inqFormNew}
    >
      <View style={{ gap: theme.spacing.md }}>
        <TextInput
          accessibilityLabel={s.inqFieldTitle}
          value={title}
          onChangeText={setTitle}
          placeholder={s.inqFieldTitle}
          placeholderTextColor={theme.color.textMuted}
          maxLength={120}
          style={field}
        />
        <TextInput
          accessibilityLabel={s.inqFieldDetails}
          value={details}
          onChangeText={setDetails}
          placeholder={s.inqFieldDetails}
          placeholderTextColor={theme.color.textMuted}
          maxLength={1000}
          multiline
          style={[field, { minHeight: 72, paddingTop: theme.spacing.sm, textAlignVertical: 'top' }]}
        />
        <Text variant="caption" tone="muted">
          {s.inqFieldValue}
        </Text>
        <AmountField
          currency={currency as CurrencyCode}
          value={value}
          onChange={setValue}
          size="compact"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={s.inqFieldDate}
          onPress={openDate}
          style={[field, { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }]}
        >
          <Ionicons name="calendar-outline" size={18} color={theme.color.textMuted} />
          <Text>{showDate(date, locale)}</Text>
        </Pressable>
        {picking && Platform.OS !== 'android' ? (
          <DateTimePicker
            value={dateFrom(date)}
            mode="date"
            onChange={(_, picked) => picked && setDate(isoDate(picked))}
          />
        ) : null}
        {failed ? (
          <Text variant="caption" tone="negative">
            {s.saveFailed}
          </Text>
        ) : null}
        <Button
          label={s.inqSave}
          variant="brand"
          disabled={!title.trim() || save.isPending}
          onPress={() => void submit()}
        />
      </View>
    </Sheet>
  );
}

/** Pick everyone who handles a client; the first stays the main follow-up. Owner and manager only. */
export function AssigneeSheet({
  visible,
  onClose,
  groupId,
  clientId,
  members,
  current,
}: {
  visible: boolean;
  onClose: () => void;
  groupId: string;
  clientId: string;
  members: readonly MemberRow[];
  /** Today's assignees, the primary owner first. */
  current: readonly string[];
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyClients;
  const assign = useAssignClient(groupId);
  const [picked, setPicked] = useState<string[]>([...current]);
  const [failed, setFailed] = useState(false);
  const toggle = (id: string) =>
    setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const submit = async () => {
    if (assign.isPending) return;
    setFailed(false);
    try {
      await assign.mutateAsync({ clientId, memberIds: picked });
      onClose();
    } catch {
      setFailed(true);
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t.common.close} title={s.assignTitle}>
      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="caption" tone="muted">
          {s.assignHint}
        </Text>
        {members.map((m) => {
          const on = picked.includes(m.id);
          return (
            <Pressable
              key={m.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => toggle(m.id)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                minHeight: 48,
              }}
            >
              <PersonAvatar name={displayName(m)} member={m} size={36} />
              <Text style={{ flex: 1, fontWeight: '600' }}>{displayName(m)}</Text>
              <Ionicons
                name={on ? 'checkbox' : 'square-outline'}
                size={24}
                color={on ? theme.color.brand : theme.color.textMuted}
              />
            </Pressable>
          );
        })}
        {failed ? (
          <Text variant="caption" tone="negative">
            {s.saveFailed}
          </Text>
        ) : null}
        <Button
          label={s.assignSave}
          variant="brand"
          disabled={assign.isPending}
          onPress={() => void submit()}
        />
      </View>
    </Sheet>
  );
}
