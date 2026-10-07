/**
 * The advanced voice flow's confirmation for one proposed expense: what was
 * heard, what the agent understood as four fields a person can fix in place
 * (amount, who it was for, which group, a note and category), and Add.
 *
 * Nothing is written until Add. The proposal stays the source of truth — see
 * `voiceConfirmPure` for how an edit turns back into one — and "Edit all" hands
 * the current state to the full form, payer and split included.
 *
 * The recording is not kept (the sentence streams to the recogniser and is
 * discarded), so there is no play button: showing one would be a fake.
 */

import { useEffect, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { currencySymbol, resolveCategory, sanitiseMinorInput } from '@waves/core';
import { Button, Card, directionalIcon, iconSize, Row, Sheet, Text, useTheme } from '@waves/ui';

import { CategoryChoices, useLabelledCategoryCatalog } from '@/components/Category';
import { DestinationPicker } from '@/components/DestinationPicker';
import { GroupPhoto } from '@/components/GroupPhoto';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { VoiceEngineBadge } from '@/components/VoiceEngineBadge';
import { useGroups, useHomeSummary } from '@/data/hooks';
import { fill, plural, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { router } from '@/lib/navigation';
import { encodeAgentSplitParams } from '@/lib/voiceAgentHandoff';
import type { AgentLocalData, AgentLocalGroup } from '@/lib/voiceAgentPlan';
import {
  initialFields,
  orderGroupTiles,
  resolveConfirm,
  type AddExpenseAction,
  type ConfirmFields,
} from '@/lib/voiceConfirmPure';
import type { VoiceEngineInfo } from '@/lib/voiceEnginePure';

/** Categories given their own chip before "More". */
const CHIPS = 4;
const AVATARS = 4;

export interface VoiceConfirmCardProps {
  action: AddExpenseAction;
  transcript: string;
  local: AgentLocalData;
  quota: { left: number; limit: number };
  engine: VoiceEngineInfo | null;
  busy: boolean;
  failed: boolean;
  /** The group the fields name now (null until one is picked). */
  onGroupChange: (groupId: string | null) => void;
  /** Add pressed with a fully resolved proposal. */
  onAdd: (action: AddExpenseAction) => void;
  /** Edit all pressed: the full form has been opened with the current state. */
  onEdited: () => void;
  onRetry: () => void;
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
  onRetry,
}: VoiceConfirmCardProps) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const viewerId = useViewerId();
  const groupRows = useGroups();
  const summary = useHomeSummary(viewerId);
  const youLabel = t.voice.agentYou;

  const initial = useMemo(() => initialFields(action, local, youLabel), [action, local, youLabel]);
  const [fields, setFields] = useState<ConfirmFields>(initial);
  const patch = (next: Partial<ConfirmFields>): void =>
    setFields((current) => ({ ...current, ...next }));
  useEffect(() => {
    onGroupChange(fields.groupId);
  }, [fields.groupId, onGroupChange]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const resolution = useMemo(
    () => resolveConfirm(action, initial, fields, local, youLabel, t.voice.anExpense),
    [action, initial, fields, local, youLabel, t.voice.anExpense],
  );

  const tiles = useMemo(
    () =>
      orderGroupTiles(local.groups, initial.groupId, fields.groupId, (id) =>
        summary.lastActivityFor(id),
      ),
    [local.groups, initial.groupId, fields.groupId, summary],
  );

  const brandSoft = theme.color.brandSoft;
  const brand = theme.color.brand;
  const line = theme.color.border;
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

  const editAll = (): void => {
    const edited: AddExpenseAction = resolution.ok
      ? resolution.action
      : { ...action, groupId: fields.groupId ?? action.groupId };
    onEdited();
    router.push({
      pathname: '/group/[id]/add-expense',
      params: {
        id: edited.groupId,
        amount: edited.amountMinor,
        currency: edited.currency,
        description: edited.description,
        ...(edited.category ? { category: edited.category } : {}),
        ...(edited.date ? { expenseDate: edited.date } : {}),
        // Who paid and how it was split, so editing never quietly resets the
        // proposal to "I paid, split with everyone".
        ...encodeAgentSplitParams({
          paidByMemberId: edited.paidByMemberId,
          split: edited.split,
        }),
        quick: '1',
      },
    });
  };

  const symbol = currencySymbol(action.currency);

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {/* What was heard. */}
      <Card
        padded={false}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          borderRadius: theme.radius.lg,
        }}
      >
        <Ionicons name="pulse" size={iconSize.xl} color={brand} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="micro" tone="muted">
            {t.voice.agentHeard}:
          </Text>
          <Text variant="caption" style={{ fontWeight: '600' }} numberOfLines={2}>
            “{transcript}”
          </Text>
        </View>
      </Card>

      <Card
        padded={false}
        style={{
          padding: theme.spacing.md,
          gap: theme.spacing.sm,
          borderRadius: theme.radius.xl,
        }}
      >
        <Row gap={theme.spacing.md}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: brandSoft,
            }}
          >
            <Ionicons name="sparkles" size={iconSize.md} color={brand} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="subheading" numberOfLines={1}>
              {t.voice.confirmUnderstood}
            </Text>
            <Text variant="micro" tone="muted" numberOfLines={1}>
              {t.voice.confirmEditHint}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.voice.confirmEditAll}
            onPress={editAll}
            disabled={busy}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.xs,
              paddingHorizontal: theme.spacing.md,
              height: 32,
              borderRadius: theme.radius.pill,
              backgroundColor: brandSoft,
              opacity: pressed || busy ? 0.6 : 1,
            })}
          >
            <Ionicons name="create-outline" size={iconSize.base} color={brand} />
            <Text variant="caption" style={{ color: brand, fontWeight: '700' }}>
              {t.voice.confirmEditAll}
            </Text>
          </Pressable>
        </Row>

        {/* Amount and who it was for — editable in place. */}
        <Row gap={theme.spacing.sm} style={{ alignItems: 'stretch' }}>
          <FieldTile
            label={t.voice.confirmAmount}
            clearLabel={t.voice.confirmClear}
            invalid={reason === 'amount'}
            icon={<Text style={{ color: brand, fontSize: 18, fontWeight: '700' }}>{symbol}</Text>}
            iconBackground={brandSoft}
            value={fields.amountText}
            keyboardType="decimal-pad"
            onChange={(text) => patch({ amountText: sanitiseMinorInput(text, action.currency) })}
          />
          <FieldTile
            label={t.voice.confirmPaidFor}
            clearLabel={t.voice.confirmClear}
            invalid={reason === 'person'}
            icon={
              <Ionicons name="person-outline" size={iconSize.lg} color={theme.color.negative} />
            }
            iconBackground={theme.color.negativeSoft}
            value={fields.personText}
            placeholder={t.voice.confirmJustMe}
            onChange={(text) => patch({ personText: text })}
          />
        </Row>

        <Row style={{ justifyContent: 'space-between', gap: theme.spacing.sm }}>
          <Text variant="subheading" style={{ flexShrink: 1 }} numberOfLines={1}>
            {t.voice.confirmWhichGroup}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.voice.confirmNewGroup}
            onPress={() => router.push('/new-group')}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 2,
              paddingHorizontal: theme.spacing.sm,
              height: 30,
              borderRadius: theme.radius.pill,
              backgroundColor: brandSoft,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons name="add" size={iconSize.md} color={brand} />
            <Text variant="micro" style={{ color: brand, fontWeight: '700' }} numberOfLines={1}>
              {t.voice.confirmNewGroup}
            </Text>
          </Pressable>
        </Row>

        <View
          accessibilityRole="radiogroup"
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}
        >
          {tiles.map((group) => (
            <GroupTile
              key={group.id}
              group={group}
              selected={group.id === fields.groupId}
              membersLabel={plural(locale, group.members.length, t.memberCount)}
              onPress={() => patch({ groupId: group.id })}
            />
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t.voice.confirmOtherGroup}, ${t.voice.confirmChooseAll}`}
            onPress={() => setPickerOpen(true)}
            style={({ pressed }) => ({
              width: '48.5%',
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
              padding: theme.spacing.sm,
              minHeight: 58,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: line,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: brandSoft,
              }}
            >
              <Ionicons name="people" size={iconSize.lg} color={brand} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="caption" style={{ fontWeight: '700' }} numberOfLines={1}>
                {t.voice.confirmOtherGroup}
              </Text>
              <Text variant="micro" tone="muted" numberOfLines={2}>
                {t.voice.confirmChooseAll}
              </Text>
            </View>
            <Ionicons
              name={directionalIcon('chevron-forward')}
              size={iconSize.md}
              color={theme.color.textMuted}
            />
          </Pressable>
        </View>

        <NoteField
          value={fields.note}
          label={t.voice.confirmNote}
          placeholder={t.voice.confirmNotePlaceholder}
          clearLabel={t.voice.confirmClear}
          onChange={(note) => patch({ note })}
        />
        <CategoryChips value={fields.category} onChange={(category) => patch({ category })} />
      </Card>

      {problemText ? (
        <Text variant="caption" tone="negative" accessibilityLiveRegion="polite">
          {problemText}
        </Text>
      ) : null}

      <Row gap={theme.spacing.sm}>
        <View style={{ flex: 1 }}>
          <Button
            label={t.voice.agentTryAgain}
            variant="secondary"
            fullWidth
            disabled={busy}
            onPress={onRetry}
            icon={<Ionicons name="mic-outline" size={iconSize.lg} color={theme.color.text} />}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label={t.voice.confirmAdd}
            variant="brand"
            fullWidth
            disabled={!resolution.ok || busy}
            onPress={() => {
              if (resolution.ok) onAdd(resolution.action);
            }}
            icon={<Ionicons name="checkmark" size={iconSize.lg} color={theme.color.onBrand} />}
          />
        </View>
      </Row>

      {/* The allowance, with the engine's own pill behind the (i). */}
      <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
        <Row gap={theme.spacing.xs}>
          <MaterialCommunityIcons name="crown" size={iconSize.md} color={brand} />
          <Text variant="micro" tone="muted">
            {fill(t.voice.agentQuotaLeft, { left: String(quota.left), limit: String(quota.limit) })}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.voice.confirmQuotaInfo}
            hitSlop={10}
            onPress={() => setInfoOpen((open) => !open)}
          >
            <Ionicons
              name="information-circle-outline"
              size={iconSize.base}
              color={theme.color.textMuted}
            />
          </Pressable>
        </Row>
        {infoOpen ? <VoiceEngineBadge info={engine} /> : null}
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
              fields.groupId ? { kind: 'existing', groupId: fields.groupId } : { kind: 'none' }
            }
            eyebrow={t.voice.confirmWhichGroup}
            pinned={[]}
            people={[]}
            groups={(groupRows.data ?? []).filter((group) =>
              local.groups.some((candidate) => candidate.id === group.id),
            )}
            t={t}
            onChoose={(choice) => {
              if (choice.kind === 'existing') patch({ groupId: choice.groupId });
              setPickerOpen(false);
            }}
            onResolvePeople={() => setPickerOpen(false)}
          />
        </ScrollView>
      </Sheet>
    </View>
  );
}

/** A labelled input tile with a round icon and a clear button. */
function FieldTile({
  label,
  icon,
  iconBackground,
  value,
  placeholder,
  keyboardType,
  invalid,
  clearLabel,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  iconBackground: string;
  value: string;
  placeholder?: string;
  keyboardType?: 'decimal-pad';
  invalid: boolean;
  clearLabel: string;
  onChange: (text: string) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        padding: theme.spacing.sm,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: invalid ? theme.color.negative : theme.color.border,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: iconBackground,
        }}
      >
        {icon}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="micro" tone="muted">
          {label}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
          <TextInput
            accessibilityLabel={label}
            value={value}
            onChangeText={onChange}
            placeholder={placeholder}
            placeholderTextColor={theme.color.textFaint}
            keyboardType={keyboardType}
            style={{
              flex: 1,
              minWidth: 0,
              padding: 0,
              fontSize: 16,
              fontWeight: '700',
              color: theme.color.text,
            }}
          />
          {value ? <ClearButton label={clearLabel} onPress={() => onChange('')} /> : null}
        </View>
      </View>
    </View>
  );
}

function ClearButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={10} onPress={onPress}>
      <Ionicons name="close-circle" size={iconSize.lg} color={theme.color.textMuted} />
    </Pressable>
  );
}

function GroupTile({
  group,
  selected,
  membersLabel,
  onPress,
}: {
  group: AgentLocalGroup;
  selected: boolean;
  membersLabel: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const shown = group.members.slice(0, AVATARS);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${group.name}, ${membersLabel}`}
      onPress={onPress}
      style={({ pressed }) => ({
        width: '48.5%',
        flexDirection: 'row',
        gap: theme.spacing.sm,
        padding: theme.spacing.sm,
        minHeight: 58,
        borderRadius: theme.radius.md,
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? theme.color.brand : theme.color.border,
        backgroundColor: selected ? theme.color.brandSoft : theme.color.surface,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <GroupPhoto photoPath={group.photoPath} emoji={group.coverEmoji} size={36} />
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text variant="caption" style={{ fontWeight: '700' }} numberOfLines={1}>
          {group.name}
        </Text>
        <Text variant="micro" tone="muted" numberOfLines={1}>
          {membersLabel}
        </Text>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ flexDirection: 'row', marginTop: 2 }}
        >
          {shown.map((member, index) => (
            <View
              key={member.id}
              style={{
                marginStart: index === 0 ? 0 : -6,
                borderRadius: 10,
                borderWidth: 1.5,
                borderColor: selected ? theme.color.brandSoft : theme.color.surface,
              }}
            >
              <ProfileAvatar name={member.name} avatarUrl={member.avatarUrl} size={17} />
            </View>
          ))}
        </View>
      </View>
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={iconSize.lg}
        color={selected ? theme.color.brand : theme.color.textFaint}
      />
    </Pressable>
  );
}

function NoteField({
  value,
  label,
  placeholder,
  clearLabel,
  onChange,
}: {
  value: string;
  label: string;
  placeholder: string;
  clearLabel: string;
  onChange: (text: string) => void;
}) {
  const theme = useTheme();
  return (
    <Row gap={theme.spacing.sm}>
      <Ionicons name="document-text-outline" size={iconSize.xl} color={theme.color.brand} />
      <Text variant="micro" tone="muted" style={{ width: 62 }} numberOfLines={2}>
        {label}
      </Text>
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.xs,
          paddingHorizontal: theme.spacing.md,
          height: 38,
          borderRadius: theme.radius.pill,
          borderWidth: 1,
          borderColor: theme.color.border,
        }}
      >
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={theme.color.textFaint}
          returnKeyType="done"
          style={{
            flex: 1,
            minWidth: 0,
            padding: 0,
            fontSize: 14,
            color: theme.color.text,
          }}
        />
        {value ? <ClearButton label={clearLabel} onPress={() => onChange('')} /> : null}
      </View>
    </Row>
  );
}

/** The catalog's first few categories as chips, "More" for the rest. */
function CategoryChips({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (key: string | null) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const { visible } = useLabelledCategoryCatalog();
  const [sheetOpen, setSheetOpen] = useState(false);

  const chosen = value
    ? (visible.find((entry) => entry.key === value) ?? resolveCategory(value, null))
    : null;
  const shown: { key: string; label: string; icon: string }[] = visible.slice(0, CHIPS);
  if (chosen && !shown.some((entry) => entry.key === chosen.key)) {
    shown[shown.length - 1] = chosen;
  }

  const chip = (selected: boolean) => ({
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 4,
    height: 34,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.pill,
    borderWidth: selected ? 1.5 : 1,
    borderColor: selected ? theme.color.brand : theme.color.border,
    backgroundColor: selected ? theme.color.brandSoft : theme.color.surface,
  });

  return (
    <Row gap={theme.spacing.xs} accessibilityRole="radiogroup">
      {shown.map((entry) => {
        const selected = entry.key === value;
        return (
          <Pressable
            key={entry.key}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={entry.label}
            onPress={() => onChange(selected ? null : entry.key)}
            style={[chip(selected), { flexShrink: 1, minWidth: 0 }]}
          >
            <Ionicons
              name={entry.icon as keyof typeof Ionicons.glyphMap}
              size={iconSize.base}
              color={selected ? theme.color.brand : theme.color.textMuted}
            />
            <Text
              variant="micro"
              numberOfLines={1}
              style={{
                flexShrink: 1,
                color: selected ? theme.color.brand : theme.color.text,
                fontWeight: selected ? '700' : '600',
              }}
            >
              {entry.label}
            </Text>
          </Pressable>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.quickExpense.moreCategories}
        onPress={() => setSheetOpen(true)}
        style={[chip(false), { width: 38, paddingHorizontal: 0 }]}
      >
        <Ionicons name="ellipsis-horizontal" size={iconSize.base} color={theme.color.textMuted} />
      </Pressable>
      {sheetOpen ? (
        <Sheet visible onClose={() => setSheetOpen(false)} title={t.whatFor}>
          <CategoryChoices
            value={value}
            onChange={(key) => {
              onChange(key === value ? null : key);
              setSheetOpen(false);
            }}
          />
        </Sheet>
      ) : null}
    </Row>
  );
}
