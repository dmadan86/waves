/**
 * The advanced voice flow's confirmation for one proposed expense — a group
 * expense or one just for you. What was heard, then one card: the category's
 * badge, the amount, where it goes (the "Just for you" pill opens the picker),
 * and four rows a person can fix in place (description, category, date, note).
 * Confirm writes it; Edit hands the current state to the full form; Discard
 * drops it.
 *
 * Nothing is written until Confirm. The proposal stays the source of truth — see
 * `voiceConfirmPure` for how an edit turns back into one.
 *
 * The recording is not kept (the sentence streams to the recogniser and is
 * discarded), so there is no play button: showing one would be a fake.
 */

import { useEffect, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';

import { currencySymbol, resolveCategory, sanitiseMinorInput } from '@waves/core';
import { iconSize, Row, Sheet, Text, useTheme } from '@waves/ui';

import { CategoryBadge, CategorySheet, useLabelledCategoryCatalog } from '@/components/Category';
import { DestinationPicker } from '@/components/DestinationPicker';
import { VoiceEngineBadge } from '@/components/VoiceEngineBadge';
import { useGroups } from '@/data/hooks';
import { fill, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { encodeAgentSplitParams } from '@/lib/voiceAgentHandoff';
import type { AgentLocalData, AgentLocalGroup } from '@/lib/voiceAgentPlan';
import {
  initialFields,
  resolveConfirm,
  type ConfirmableAction,
  type ConfirmFields,
} from '@/lib/voiceConfirmPure';
import type { VoiceEngineInfo } from '@/lib/voiceEnginePure';

export interface VoiceConfirmCardProps {
  action: ConfirmableAction;
  transcript: string;
  local: AgentLocalData;
  quota: { left: number; limit: number };
  engine: VoiceEngineInfo | null;
  busy: boolean;
  failed: boolean;
  /** The group the fields name now (null while it is just for you). */
  onGroupChange: (groupId: string | null) => void;
  /** Confirm pressed with a fully resolved proposal. */
  onAdd: (action: ConfirmableAction) => void;
  /** Edit pressed: the full form has been opened with the current state. */
  onEdited: () => void;
  onDiscard: () => void;
}

/** YYYY-MM-DD for a local calendar day. */
function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayFromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** A group with no name is named by its people, as `groupLabel` does elsewhere. */
function groupTitle(group: AgentLocalGroup, youLabel: string): string {
  const named = group.name.trim();
  if (named) return named;
  const others = group.members.filter((member) => !member.isViewer).map((member) => member.name);
  if (others.length === 0) return youLabel;
  if (others.length <= 2) return others.join(', ');
  return `${others[0]}, ${others[1]} +${others.length - 2}`;
}

export function VoiceConfirmCard({
  action,
  transcript,
  local,
  quota,
  engine,
  busy,
  failed,
  onGroupChange,
  onAdd,
  onEdited,
  onDiscard,
}: VoiceConfirmCardProps) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const groupRows = useGroups();
  const { visible: catalog } = useLabelledCategoryCatalog();
  const youLabel = t.voice.agentYou;

  const initial = useMemo(() => initialFields(action, local, youLabel), [action, local, youLabel]);
  const [fields, setFields] = useState<ConfirmFields>(initial);
  const patch = (next: Partial<ConfirmFields>): void =>
    setFields((current) => ({ ...current, ...next }));
  useEffect(() => {
    onGroupChange(fields.personal ? null : fields.groupId);
  }, [fields.personal, fields.groupId, onGroupChange]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [iosDateOpen, setIosDateOpen] = useState(false);

  const resolution = useMemo(
    () => resolveConfirm(action, initial, fields, local, youLabel, t.voice.anExpense),
    [action, initial, fields, local, youLabel, t.voice.anExpense],
  );

  const brand = theme.color.brand;
  const brandSoft = theme.color.brandSoft;
  const reason = resolution.ok ? null : resolution.reason;
  const problemText =
    reason === 'person'
      ? fill(t.voice.confirmPersonMissing, {
          name: resolution.ok ? '' : (resolution.name ?? ''),
        })
      : reason === 'group'
        ? t.voice.confirmPickGroup
        : reason === 'amount'
          ? t.voice.confirmNeedAmount
          : reason === 'payer'
            ? t.voice.agentProblem
            : failed
              ? t.voice.agentCouldNotRun
              : null;

  const group = fields.personal
    ? undefined
    : local.groups.find((candidate) => candidate.id === fields.groupId);
  const destinationLabel = fields.personal
    ? t.voice.agentJustYou
    : group
      ? groupTitle(group, youLabel)
      : t.voice.confirmWhichGroup;

  // The date row: today unless the proposal or the person said otherwise.
  // Read once: the screen lives for a minute, not across midnight.
  const [{ todayIso, yesterdayIso }] = useState(() => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return { todayIso: isoDay(now), yesterdayIso: isoDay(yesterday) };
  });
  const dateIso = fields.date ?? todayIso;
  const dayWord =
    dateIso === todayIso
      ? t.voice.confirmToday
      : dateIso === yesterdayIso
        ? t.voice.confirmYesterday
        : null;
  const dateText = dayFromIso(dateIso).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const dateLabel = dayWord ? `${dayWord}, ${dateText}` : dateText;
  const applyDate = (event: DateTimePickerEvent, picked?: Date): void => {
    if (Platform.OS === 'ios') setIosDateOpen(false);
    if (event.type === 'dismissed' || !picked) return;
    patch({ date: isoDay(picked) });
  };
  const openDate = (): void => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: dayFromIso(dateIso),
        mode: 'date',
        maximumDate: new Date(),
        onChange: applyDate,
      });
    } else {
      setIosDateOpen(true);
    }
  };

  const categoryEntry = fields.category
    ? (catalog.find((entry) => entry.key === fields.category) ??
      resolveCategory(fields.category, null))
    : null;

  const edit = (): void => {
    onEdited();
    if (resolution.ok && resolution.action.type === 'add_personal') {
      router.push({
        pathname: '/personal/entry',
        params: {
          kind: 'expense',
          amount: resolution.action.amountMinor,
          currency: resolution.action.currency,
          note: resolution.action.description,
        },
      });
      return;
    }
    const proposal =
      resolution.ok && resolution.action.type === 'add_expense'
        ? resolution.action
        : action.type === 'add_expense'
          ? { ...action, groupId: fields.groupId ?? action.groupId }
          : null;
    if (!proposal) {
      router.push({ pathname: '/personal/entry', params: { kind: 'expense' } });
      return;
    }
    router.push({
      pathname: '/group/[id]/add-expense',
      params: {
        id: proposal.groupId,
        amount: proposal.amountMinor,
        currency: proposal.currency,
        description: proposal.description,
        ...(proposal.category ? { category: proposal.category } : {}),
        ...(proposal.date ? { expenseDate: proposal.date } : {}),
        // Who paid and how it was split, so editing never quietly resets the
        // proposal to "I paid, split with everyone".
        ...encodeAgentSplitParams({
          paidByMemberId: proposal.paidByMemberId,
          split: proposal.split,
        }),
        quick: '1',
      },
    });
  };

  return (
    <View style={{ gap: theme.spacing.md }}>
      {/* What was heard. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
          borderRadius: theme.radius.xl,
          backgroundColor: brandSoft,
        }}
      >
        <MaterialCommunityIcons name="waveform" size={iconSize.xl} color={brand} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="body" style={{ fontWeight: '600' }} numberOfLines={2}>
            “{transcript}”
          </Text>
          <Text variant="caption" tone="muted">
            {t.voice.confirmHeardNow}
          </Text>
        </View>
      </View>

      <View
        style={{
          padding: theme.spacing.lg,
          gap: theme.spacing.md,
          borderRadius: theme.radius.xl,
          backgroundColor: theme.color.surface,
        }}
      >
        {/* The amount, under the category's badge, and where it goes. */}
        <Row gap={theme.spacing.md}>
          <CategoryBadge category={fields.category} description={fields.description} size={52} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="caption" tone="muted">
              {t.voice.confirmAdd}
            </Text>
            <Row gap={2}>
              <Text style={{ fontSize: 26, fontWeight: '800', color: theme.color.text }}>
                {currencySymbol(action.currency)}
              </Text>
              <TextInput
                accessibilityLabel={t.voice.confirmAmount}
                value={fields.amountText}
                onChangeText={(text) =>
                  patch({ amountText: sanitiseMinorInput(text, action.currency) })
                }
                keyboardType="decimal-pad"
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: 0,
                  fontSize: 26,
                  fontWeight: '800',
                  color: reason === 'amount' ? theme.color.negative : theme.color.text,
                }}
              />
            </Row>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t.voice.confirmWhichGroup} ${destinationLabel}`}
            onPress={() => setPickerOpen(true)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.xs,
              maxWidth: '46%',
              paddingHorizontal: theme.spacing.md,
              height: 38,
              borderRadius: theme.radius.pill,
              backgroundColor: brandSoft,
              borderWidth: reason === 'group' ? 1.5 : 0,
              borderColor: theme.color.negative,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons
              name={fields.personal ? 'person-add-outline' : 'people-outline'}
              size={iconSize.base}
              color={brand}
            />
            <Text
              variant="caption"
              numberOfLines={1}
              style={{ flexShrink: 1, color: brand, fontWeight: '600' }}
            >
              {destinationLabel}
            </Text>
            <Ionicons name="chevron-down" size={iconSize.sm} color={brand} />
          </Pressable>
        </Row>

        <FieldRow icon="pricetag-outline" label={t.voice.confirmDescription}>
          <InputBox
            value={fields.description}
            placeholder={t.voice.confirmNotePlaceholder}
            label={t.voice.confirmDescription}
            trailing="create-outline"
            onChange={(description) => patch({ description })}
          />
        </FieldRow>

        {fields.personal ? null : (
          <FieldRow icon="person-outline" label={t.voice.confirmWith}>
            <InputBox
              value={fields.personText}
              placeholder={t.voice.confirmJustMe}
              label={t.voice.confirmWith}
              invalid={reason === 'person'}
              onChange={(personText) => patch({ personText })}
            />
          </FieldRow>
        )}

        <FieldRow icon="grid-outline" label={t.voice.confirmCategory}>
          <ChoiceBox
            label={t.voice.confirmCategory}
            leading={
              categoryEntry ? (
                <Ionicons
                  name={categoryEntry.icon as keyof typeof Ionicons.glyphMap}
                  size={iconSize.lg}
                  color={theme.color.text}
                />
              ) : null
            }
            text={categoryEntry?.label ?? t.whatFor}
            onPress={() => setCategoryOpen(true)}
          />
        </FieldRow>

        <FieldRow icon="calendar-outline" label={t.voice.confirmDate}>
          <ChoiceBox label={t.voice.confirmDate} text={dateLabel} onPress={openDate} />
        </FieldRow>

        <FieldRow icon="reader-outline" label={t.voice.confirmNoteLabel}>
          <InputBox
            value={fields.note}
            placeholder={t.voice.confirmNoteHint}
            label={t.voice.confirmNoteLabel}
            onChange={(note) => patch({ note })}
          />
        </FieldRow>

        {problemText ? (
          <Text variant="caption" tone="negative" accessibilityLiveRegion="polite">
            {problemText}
          </Text>
        ) : null}

        <Row gap={theme.spacing.sm} style={{ marginTop: theme.spacing.xs }}>
          <PillButton
            label={t.voice.agentConfirm}
            icon="checkmark"
            primary
            grow={1.4}
            disabled={!resolution.ok || busy}
            onPress={() => {
              if (resolution.ok) onAdd(resolution.action);
            }}
          />
          <PillButton
            label={t.voice.agentEdit}
            icon="pencil-outline"
            disabled={busy}
            onPress={edit}
          />
          <PillButton
            label={t.voice.agentDiscard}
            icon="trash-outline"
            disabled={busy}
            onPress={onDiscard}
          />
        </Row>
      </View>

      {/* The allowance, then the engine that heard it. */}
      <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        <Row gap={theme.spacing.xs}>
          <Text variant="caption" tone="muted">
            {fill(t.voice.agentQuotaLeft, { left: String(quota.left), limit: String(quota.limit) })}
          </Text>
          <Ionicons
            name="information-circle-outline"
            size={iconSize.base}
            color={theme.color.textMuted}
            accessibilityLabel={t.voice.confirmQuotaInfo}
          />
        </Row>
        <VoiceEngineBadge info={engine} />
      </View>

      <Sheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        closeLabel={t.common.close}
        style={{
          backgroundColor: theme.color.bg,
          paddingHorizontal: theme.spacing.xl,
          maxHeight: '80%',
        }}
      >
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <DestinationPicker
            key={pickerOpen ? 'open' : 'closed'}
            selection={
              fields.personal
                ? { kind: 'me' }
                : fields.groupId
                  ? { kind: 'existing', groupId: fields.groupId }
                  : { kind: 'none' }
            }
            eyebrow={t.voice.confirmWhichGroup}
            pinned={['me']}
            people={[]}
            groups={(groupRows.data ?? []).filter((row) =>
              local.groups.some((candidate) => candidate.id === row.id),
            )}
            t={t}
            onChoose={(choice) => {
              if (choice.kind === 'me') patch({ personal: true });
              if (choice.kind === 'existing') patch({ personal: false, groupId: choice.groupId });
              setPickerOpen(false);
            }}
            onResolvePeople={() => setPickerOpen(false)}
          />
        </ScrollView>
      </Sheet>

      {categoryOpen ? (
        <CategorySheet
          value={fields.category}
          onChange={(key) => {
            patch({ category: key });
            setCategoryOpen(false);
          }}
          onClose={() => setCategoryOpen(false)}
        />
      ) : null}

      {Platform.OS === 'ios' && iosDateOpen ? (
        <Sheet
          visible
          onClose={() => setIosDateOpen(false)}
          closeLabel={t.common.close}
          title={t.voice.confirmDate}
        >
          <DateTimePicker
            value={dayFromIso(dateIso)}
            mode="date"
            display="inline"
            maximumDate={new Date()}
            onChange={applyDate}
          />
        </Sheet>
      ) : null}
    </View>
  );
}

/** One labelled row: an outline icon, the label, then its control. */
function FieldRow({
  icon,
  label,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Row gap={theme.spacing.sm}>
      <Ionicons name={icon} size={iconSize.lg} color={theme.color.textMuted} />
      <Text variant="caption" tone="muted" numberOfLines={1} style={{ width: 92 }}>
        {label}
      </Text>
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </Row>
  );
}

function boxStyle(theme: ReturnType<typeof useTheme>, invalid = false) {
  return {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.spacing.sm,
    height: 46,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.surfaceMuted,
    borderWidth: invalid ? 1.5 : 0,
    borderColor: theme.color.negative,
  };
}

function InputBox({
  value,
  placeholder,
  label,
  trailing,
  invalid = false,
  onChange,
}: {
  value: string;
  placeholder: string;
  label: string;
  trailing?: keyof typeof Ionicons.glyphMap;
  invalid?: boolean;
  onChange: (text: string) => void;
}) {
  const theme = useTheme();
  // Android leaves a single-line input scrolled to its cursor, the end, so a
  // long value read from its last letters. Away from the keyboard, show the start.
  const [focused, setFocused] = useState(false);
  return (
    <View style={boxStyle(theme, invalid)}>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.color.textFaint}
        returnKeyType="done"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        selection={focused ? undefined : { start: 0, end: 0 }}
        style={{ flex: 1, minWidth: 0, padding: 0, fontSize: 15, color: theme.color.text }}
      />
      {trailing ? <Ionicons name={trailing} size={iconSize.lg} color={theme.color.brand} /> : null}
    </View>
  );
}

function ChoiceBox({
  label,
  text,
  leading,
  onPress,
}: {
  label: string;
  text: string;
  leading?: React.ReactNode;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${text}`}
      onPress={onPress}
      style={({ pressed }) => [boxStyle(theme), { opacity: pressed ? 0.7 : 1 }]}
    >
      {leading}
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, color: theme.color.text }}>
        {text}
      </Text>
      <Ionicons name="chevron-down" size={iconSize.base} color={theme.color.textMuted} />
    </Pressable>
  );
}

function PillButton({
  label,
  icon,
  primary = false,
  grow = 1,
  disabled = false,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  primary?: boolean;
  grow?: number;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const ink = primary ? theme.color.onButtonPrimary : theme.color.brand;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: grow,
        flexBasis: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.xs,
        height: 50,
        paddingHorizontal: theme.spacing.sm,
        borderRadius: theme.radius.pill,
        backgroundColor: primary
          ? pressed
            ? theme.color.buttonPrimaryPressed
            : theme.color.buttonPrimary
          : theme.color.brandSoft,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.lg} color={ink} />
      <Text
        numberOfLines={1}
        style={{ color: ink, fontWeight: '700', fontSize: 15, flexShrink: 1 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
