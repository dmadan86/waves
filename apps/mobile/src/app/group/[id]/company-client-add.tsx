/**
 * New inquiry (or edit a client): name, phone, what they need, where they came from, and when to follow up.
 * One screen, one Save. The follow-up is a task for whoever follows up, linked to the client.
 */
import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useLocalSearchParams } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';

import { CLIENT_SOURCES, type ClientSource, type CurrencyCode } from '@waves/core';
import { AmountField, Screen, Text, useTheme } from '@waves/ui';

import { SaveButton } from '@/components/company/EntryForm';
import { SuspendedGate } from '@/components/company/SuspendedBanner';
import { useSourceLabel } from '@/components/company/clients/parts';
import { PersonAvatar } from '@/components/PersonAvatar';
import { PlainHeader, StandardCard } from '@/components/standard';
import { useAddFollowUp, useCompanyClients, useSetClient } from '@/data/companyClients';
import { todayIso } from '@/data/personal';
import { displayName } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { shiftDay } from '@/lib/companyClients';
import { useDialog } from '@/lib/dialog';
import { dateFrom, isoDate, showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';

type Follow = 'today' | 'tomorrow' | 'three' | 'pick' | 'none';

export default function CompanyClientAddScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  return (
    <SuspendedGate groupId={id}>
      <ClientForm groupId={id} />
    </SuspendedGate>
  );
}

function ClientForm({ groupId }: { groupId: string }) {
  const { clientId } = useLocalSearchParams<{ clientId?: string }>();
  const theme = useTheme();
  const { t, locale } = useStrings();
  const s = t.companyClients;
  const clearance = useBottomClearance();
  const { notify, choose } = useDialog();
  const view = useCompanyClients(groupId);
  const existing = view.clients.find((c) => c.id === clientId);
  const save = useSetClient(groupId);
  const addFollowUp = useAddFollowUp(groupId);
  const sourceLabel = useSourceLabel();
  const [name, setName] = useState(existing?.name ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [need, setNeed] = useState(existing?.need ?? '');
  const [source, setSource] = useState<ClientSource>(existing?.source ?? 'walk_in');
  const [owner, setOwner] = useState<string | null>(
    existing ? existing.ownerMemberId : view.myMemberId,
  );
  const [follow, setFollow] = useState<Follow>(existing ? 'none' : 'today');
  const [pickedDay, setPickedDay] = useState(todayIso());
  const [inlinePick, setInlinePick] = useState(false);
  const [more, setMore] = useState(!!(existing?.expectedValueMinor || existing?.address));
  const [value, setValue] = useState(existing?.expectedValueMinor ?? 0n);
  const [address, setAddress] = useState(existing?.address ?? '');
  const today = todayIso();
  const day = {
    today,
    tomorrow: shiftDay(today, 1),
    three: shiftDay(today, 3),
    pick: pickedDay,
    none: null,
  }[follow];
  const ownerRow = view.owners.find((m) => m.id === owner);
  const canPickOwner = view.canManage && view.owners.length > 1;
  const busy = save.isPending || addFollowUp.isPending;

  const openPick = () => {
    setFollow('pick');
    if (Platform.OS === 'android')
      DateTimePickerAndroid.open({
        value: dateFrom(pickedDay),
        mode: 'date',
        minimumDate: new Date(`${today}T00:00:00`),
        onChange: (event, picked) => {
          if (event.type === 'set' && picked) setPickedDay(isoDate(picked));
        },
      });
    else setInlinePick(!inlinePick);
  };
  const pickOwner = async () => {
    const id = await choose({
      title: s.whoFollows,
      options: view.owners.map((m) => ({ id: m.id, label: displayName(m) })),
    });
    if (id) setOwner(id);
  };
  const submit = async () => {
    if (busy || !name.trim()) return;
    try {
      const savedId = await save.mutateAsync({
        clientId: existing?.id ?? randomUUID(),
        name,
        phone,
        need,
        source,
        address,
        expectedValueMinor: value > 0n ? value.toString() : null,
        ownerMemberId: owner,
        stage: existing?.stage ?? 'inquiry',
        lostReason: existing?.lostReason ?? null,
      });
      if (day && owner && !existing)
        await addFollowUp.mutateAsync({
          clientId: savedId,
          clientName: name.trim(),
          memberId: owner,
          day,
        });
      if (existing) router.back();
      else router.replace(`/group/${groupId}/company-client?clientId=${savedId}`);
    } catch {
      await notify({ title: s.saveFailed, tone: 'danger' });
    }
  };
  const chip = (on: boolean) => ({
    height: 36,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.pill,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: on ? 2 : 1,
    borderColor: on ? theme.color.brand : theme.color.border,
    backgroundColor: on ? theme.color.brandSoft : theme.color.surface,
  });
  const field = {
    flex: 1,
    color: theme.color.text,
    fontSize: 15,
    paddingVertical: 0,
    textAlign: locale.startsWith('ar') ? ('right' as const) : ('left' as const),
  };
  const followOptions: { key: Follow; label: string }[] = [
    { key: 'today', label: s.fuToday },
    { key: 'tomorrow', label: s.fuTomorrow },
    { key: 'three', label: s.fuThreeDays },
    { key: 'pick', label: follow === 'pick' ? showDate(pickedDay, locale) : s.fuPick },
    { key: 'none', label: s.fuNone },
  ];
  return (
    <Screen edges={[]}>
      <PlainHeader title={existing ? s.editClient : s.newInquiry} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.lg,
          paddingBottom: clearance + 84,
        }}
      >
        <StandardCard style={{ paddingVertical: 0, gap: 0 }}>
          {(
            [
              ['person-outline', s.namePh, name, setName, 120, undefined],
              ['call-outline', s.phonePh, phone, setPhone, 32, 'phone-pad'],
              ['chatbubble-outline', s.needPh, need, setNeed, 500, undefined],
            ] as const
          ).map(([icon, ph, val, set, max, kb], i) => (
            <View
              key={ph}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                minHeight: 52,
                borderTopWidth: i ? 1 : 0,
                borderTopColor: theme.color.border,
              }}
            >
              <Ionicons name={icon} size={18} color={theme.color.textMuted} />
              <TextInput
                accessibilityLabel={ph}
                value={val}
                onChangeText={set}
                placeholder={ph}
                placeholderTextColor={theme.color.textMuted}
                maxLength={max}
                keyboardType={kb}
                style={field}
              />
            </View>
          ))}
        </StandardCard>
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="caption" style={{ fontWeight: '700' }}>
            {s.cameFrom}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {CLIENT_SOURCES.map((src) => (
              <Pressable
                key={src}
                accessibilityRole="button"
                accessibilityState={{ selected: src === source }}
                onPress={() => setSource(src)}
                style={chip(src === source)}
              >
                <Text variant="caption" style={{ fontWeight: '700' }}>
                  {sourceLabel(src)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        {!existing ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="caption" style={{ fontWeight: '700' }}>
              {s.followUp}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {followOptions.map((o) => (
                <Pressable
                  key={o.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: o.key === follow }}
                  onPress={() => (o.key === 'pick' ? openPick() : setFollow(o.key))}
                  style={chip(o.key === follow)}
                >
                  <Text variant="caption" style={{ fontWeight: '700' }}>
                    {o.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {inlinePick && follow === 'pick' && Platform.OS !== 'android' ? (
              <DateTimePicker
                value={dateFrom(pickedDay)}
                mode="date"
                minimumDate={new Date(`${today}T00:00:00`)}
                onChange={(_, picked) => picked && setPickedDay(isoDate(picked))}
              />
            ) : null}
            {ownerRow ? (
              <Pressable
                accessibilityRole="button"
                disabled={!canPickOwner}
                onPress={() => void pickOwner()}
                style={[chip(false), { height: 44, flexDirection: 'row', gap: theme.spacing.sm }]}
              >
                <PersonAvatar name={displayName(ownerRow)} size={26} />
                <Text variant="caption" style={{ flex: 1, fontWeight: '600' }}>
                  {`${s.whoFollows} · ${displayName(ownerRow)}`}
                </Text>
                {canPickOwner ? (
                  <Ionicons name="chevron-down" size={16} color={theme.color.textMuted} />
                ) : null}
              </Pressable>
            ) : null}
          </View>
        ) : canPickOwner ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void pickOwner()}
            style={[chip(false), { height: 44, flexDirection: 'row', gap: theme.spacing.sm }]}
          >
            <Text variant="caption" style={{ flex: 1, fontWeight: '600' }}>
              {fill(s.follows, { name: ownerRow ? displayName(ownerRow) : '-' })}
            </Text>
            <Ionicons name="chevron-down" size={16} color={theme.color.textMuted} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => setMore(!more)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}
        >
          <Ionicons name={more ? 'remove' : 'add'} size={18} color={theme.color.brand} />
          <Text style={{ color: theme.color.brand, fontWeight: '700' }}>{s.extra}</Text>
        </Pressable>
        {more ? (
          <StandardCard style={{ gap: theme.spacing.sm }}>
            <Text variant="caption">{s.expectedValue}</Text>
            <AmountField
              currency={view.currency as CurrencyCode}
              value={value}
              onChange={setValue}
              size="compact"
            />
            <TextInput
              accessibilityLabel={s.addressPh}
              value={address}
              onChangeText={setAddress}
              placeholder={s.addressPh}
              placeholderTextColor={theme.color.textMuted}
              maxLength={300}
              style={[field, { minHeight: 44 }]}
            />
          </StandardCard>
        ) : null}
      </ScrollView>
      <View style={{ position: 'absolute', left: 16, right: 16, bottom: clearance }}>
        <SaveButton
          label={existing ? s.save : s.saveInquiry}
          disabled={!name.trim() || busy}
          onPress={() => void submit()}
        />
      </View>
    </Screen>
  );
}
