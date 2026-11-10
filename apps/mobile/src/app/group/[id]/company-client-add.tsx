/**
 * New inquiry (or edit a client): name, phone, what they need, where they came from, and when to follow up.
 * One screen, one Save. The follow-up is a task for whoever follows up, linked to the client.
 * Typing a name or phone looks the customer up among existing clients so the same one is not added twice.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useLocalSearchParams } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  CLIENT_SOURCES,
  type ClientPriority,
  type ClientSource,
  type CompanyClient,
  type CurrencyCode,
} from '@waves/core';
import { AmountField, Screen, Text, useTheme } from '@waves/ui';

import { SaveButton, SelectField } from '@/components/company/EntryForm';
import { useMoney } from '@/components/company/dashboard/parts';
import { SuspendedGate } from '@/components/company/SuspendedBanner';
import {
  CLIENT_CATEGORIES,
  StageChip,
  useCategoryLabel,
  usePriorityLabel,
  useSourceLabel,
} from '@/components/company/clients/parts';
import { PersonAvatar } from '@/components/PersonAvatar';
import { PlainHeader, StandardCard } from '@/components/standard';
import {
  useAddClientNote,
  useAddFollowUp,
  useClientMoney,
  useCompanyClients,
  useSetClient,
  useSetInquiry,
} from '@/data/companyClients';
import { useCompanyEntries } from '@/data/companyEntries';
import { useCompanyTickets } from '@/data/companyTickets';
import { todayIso } from '@/data/personal';
import { displayName } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { clientHistory, matchClients } from '@/lib/clientMatch';
import { shiftDay } from '@/lib/companyClients';
import { useDialog } from '@/lib/dialog';
import { dateFrom, isoDate, showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';

const PRIORITIES: readonly ClientPriority[] = ['normal', 'urgent', 'high'];

type Follow = 'today' | 'tomorrow' | 'three' | 'pick' | 'none';
type Icon = keyof typeof Ionicons.glyphMap;

const SOURCE_ICON: Record<ClientSource, Icon> = {
  walk_in: 'walk-outline',
  call: 'call-outline',
  whatsapp: 'logo-whatsapp',
  referral: 'people-outline',
  other: 'ellipsis-horizontal',
};

export default function CompanyClientAddScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  return (
    <SuspendedGate groupId={id}>
      <ClientForm groupId={id} />
    </SuspendedGate>
  );
}

/** A titled card with a brand glyph, as in the design. */
function Section({ icon, title, children }: { icon: Icon; title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <StandardCard style={{ gap: theme.spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Ionicons name={icon} size={20} color={theme.color.brand} />
        <Text style={{ fontWeight: '700' }} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {children}
    </StandardCard>
  );
}

function Required({ label }: { label: string }) {
  return (
    <Text variant="caption" style={{ fontWeight: '600' }}>
      {label}
      <Text variant="caption" tone="negative">
        {' *'}
      </Text>
    </Text>
  );
}

/** Existing customers that look like the one being typed: their history, and a way to reuse them. */
function ExistingCustomers({
  groupId,
  matches,
  currency,
  attachedId,
  onUse,
  onClear,
}: {
  groupId: string;
  matches: readonly CompanyClient[];
  currency: string;
  attachedId: string | null;
  onUse: (c: CompanyClient) => void;
  onClear: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const s = t.companyClients;
  const view = useCompanyClients(groupId);
  const money = useClientMoney(groupId);
  const tickets = useCompanyTickets(groupId).tickets;
  const fmt = useMoney(currency);
  const shown = attachedId ? matches.filter((m) => m.id === attachedId) : matches;
  const kind = { inquiry: s.docInquiry, estimate: s.docQuote, bill: s.docInvoice };
  return (
    <>
      {shown.map((c) => {
        const h = clientHistory(
          view.inquiries.filter((i) => i.clientId === c.id),
          money.docs.filter((d) => d.clientId === c.id),
          tickets.filter((x) => x.clientId === c.id).length,
        );
        const last = h.last
          ? [
              kind[h.last.kind],
              showDate(h.last.day, locale),
              h.last.amountMinor ? fmt(h.last.amountMinor) : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : null;
        return (
          <StandardCard key={c.id} style={{ gap: theme.spacing.sm }}>
            <Text variant="caption" tone="muted" style={{ fontWeight: '700' }}>
              {s.existingCustomer}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              <PersonAvatar name={c.name} size={32} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700' }} numberOfLines={1}>
                  {c.name}
                </Text>
                {c.phone ? (
                  <Text variant="caption" tone="muted">
                    {c.phone}
                  </Text>
                ) : null}
              </View>
              <StageChip stage={c.stage} />
            </View>
            {last ? <Text variant="caption">{fill(s.lastActivity, { item: last })}</Text> : null}
            <Text variant="caption" tone="muted">
              {fill(s.historyCounts, {
                inq: h.inquiries,
                est: h.estimates,
                bill: h.bills,
                comp: h.complaints,
              })}
            </Text>
            <View style={{ flexDirection: 'row', gap: theme.spacing.lg }}>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`${s.viewHistory}: ${c.name}`}
                onPress={() => router.push(`/group/${groupId}/company-client?clientId=${c.id}`)}
                hitSlop={8}
              >
                <Text style={{ color: theme.color.brand, fontWeight: '700' }}>{s.viewHistory}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${attachedId ? s.notThisCustomer : s.useCustomer}: ${c.name}`}
                onPress={() => (attachedId ? onClear() : onUse(c))}
                hitSlop={8}
              >
                <Text style={{ color: theme.color.brand, fontWeight: '700' }}>
                  {attachedId ? s.notThisCustomer : s.useCustomer}
                </Text>
              </Pressable>
            </View>
          </StandardCard>
        );
      })}
    </>
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
  const entries = useCompanyEntries(groupId);
  const existing = view.clients.find((c) => c.id === clientId);
  const save = useSetClient(groupId);
  const addFollowUp = useAddFollowUp(groupId);
  const addInquiry = useSetInquiry(groupId);
  const addNote = useAddClientNote(groupId);
  const sourceLabel = useSourceLabel();
  const categoryLabel = useCategoryLabel();
  const priorityLabel = usePriorityLabel();
  const scroller = useRef<ScrollView>(null);
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
  const [value, setValue] = useState(existing?.expectedValueMinor ?? 0n);
  const [address, setAddress] = useState(existing?.address ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [company, setCompany] = useState(existing?.companyName ?? '');
  const [category, setCategory] = useState<string | null>(existing?.category ?? null);
  const [priority, setPriority] = useState<ClientPriority>(existing?.priority ?? 'normal');
  const [notes, setNotes] = useState('');
  // An existing customer picked from the matches: the new inquiry is added to them instead of a new client.
  const [attached, setAttached] = useState<CompanyClient | null>(null);
  const today = todayIso();
  const day = {
    today,
    tomorrow: shiftDay(today, 1),
    three: shiftDay(today, 3),
    pick: pickedDay,
    none: null,
  }[follow];
  // A manager can hand work only to their own team or themself; the server refuses the rest.
  const assignable = view.owners.filter(
    (m) => entries.isOwner || m.id === view.myMemberId || entries.manageableIds.has(m.id),
  );
  const ownerRow = view.owners.find((m) => m.id === owner);
  const canPickOwner = view.canManage && assignable.length > 1;
  const busy = save.isPending || addFollowUp.isPending || addInquiry.isPending || addNote.isPending;
  const matches = useMemo(
    () => (existing ? [] : matchClients(view.clients, { name, phone })),
    [existing, view.clients, name, phone],
  );

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
      options: assignable.map((m) => ({ id: m.id, label: displayName(m) })),
    });
    if (id) setOwner(id);
  };
  const pickCategory = async () => {
    const id = await choose({
      title: s.category,
      options: CLIENT_CATEGORIES.map((k) => ({ id: k, label: categoryLabel(k) })),
    });
    if (id) setCategory(id);
  };
  const useCustomer = (c: CompanyClient) => {
    setAttached(c);
    setName(c.name);
    setPhone(c.phone ?? '');
  };
  const reset = () => {
    setName('');
    setPhone('');
    setNeed('');
    setSource('walk_in');
    setFollow('today');
    setPickedDay(todayIso());
    setInlinePick(false);
    setValue(0n);
    setAddress('');
    setEmail('');
    setCompany('');
    setCategory(null);
    setPriority('normal');
    setNotes('');
    setAttached(null);
    scroller.current?.scrollTo({ y: 0, animated: true });
  };
  const submit = async (another: boolean) => {
    if (busy || !name.trim()) return;
    try {
      const savedId = attached
        ? attached.id
        : await save.mutateAsync({
            clientId: existing?.id ?? randomUUID(),
            name,
            phone,
            need,
            source,
            address,
            email,
            company,
            category,
            priority,
            expectedValueMinor: value > 0n ? value.toString() : null,
            ownerMemberId: owner,
            stage: existing?.stage ?? 'inquiry',
            lostReason: existing?.lostReason ?? null,
          });
      // A new client starts with its first inquiry (INQ-nnn), carrying what they need and the expected value.
      if (!existing)
        await addInquiry.mutateAsync({
          clientId: savedId,
          title: need.trim() || name.trim(),
          details: need.trim().length > 120 ? need.trim() : null,
          expectedValueMinor: value > 0n ? value.toString() : null,
          inquiryDate: today,
        });
      if (notes.trim() && !existing) await addNote.mutateAsync({ clientId: savedId, body: notes });
      if (day && owner && !existing)
        await addFollowUp.mutateAsync({
          clientId: savedId,
          clientName: (attached?.name ?? name).trim(),
          memberId: owner,
          day,
        });
      if (existing) router.back();
      else if (another) reset();
      else router.replace(`/group/${groupId}/company-client?clientId=${savedId}`);
    } catch {
      await notify({ title: s.saveFailed, tone: 'danger' });
    }
  };
  const pill = (on: boolean) => ({
    minHeight: 40,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.pill,
    flexDirection: 'row' as const,
    gap: theme.spacing.xs,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: on ? theme.color.brand : theme.color.border,
    backgroundColor: on ? theme.color.brand : theme.color.surface,
  });
  const pillColor = (on: boolean) => (on ? theme.color.onBrand : theme.color.text);
  const field = {
    flex: 1,
    color: theme.color.text,
    fontSize: 15,
    paddingVertical: 0,
    textAlign: locale.startsWith('ar') ? ('right' as const) : ('left' as const),
  };
  const input = (
    label: string,
    val: string,
    set: (v: string) => void,
    max: number,
    kb?: 'phone-pad' | 'email-address',
  ) => (
    <TextInput
      accessibilityLabel={label}
      value={val}
      onChangeText={(v) => {
        set(v);
        // Only the identity fields detach; the rest are hidden while a customer is reused.
        if (attached && (set === setName || set === setPhone)) setAttached(null);
      }}
      placeholder={label}
      placeholderTextColor={theme.color.textMuted}
      maxLength={max}
      keyboardType={kb}
      autoCapitalize={kb === 'email-address' ? 'none' : undefined}
      style={field}
    />
  );
  const followOptions: { key: Follow; label: string }[] = [
    { key: 'today', label: s.fuToday },
    { key: 'tomorrow', label: s.fuTomorrow },
    { key: 'three', label: s.fuThreeDays },
    { key: 'pick', label: follow === 'pick' ? showDate(pickedDay, locale) : s.fuPick },
    { key: 'none', label: s.fuNone },
  ];
  const ownerField = ownerRow ? (
    <SelectField
      icon="person-outline"
      label={s.whoFollows}
      text={displayName(ownerRow)}
      input={
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <PersonAvatar name={displayName(ownerRow)} size={24} />
          <Text variant="body" numberOfLines={1} style={{ flex: 1, fontWeight: '600' }}>
            {displayName(ownerRow)}
          </Text>
        </View>
      }
      chevron={canPickOwner}
      onPress={canPickOwner ? () => void pickOwner() : undefined}
    />
  ) : null;
  return (
    <Screen edges={[]}>
      <PlainHeader
        title={existing ? s.editClient : s.newInquiry}
        subtitle={existing ? undefined : s.newInquirySub}
      />
      <ScrollView
        ref={scroller}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
      >
        <Section icon="person-outline" title={s.customerDetails}>
          <View style={{ gap: 4 }}>
            <Required label={s.namePh} />
            <SelectField
              icon="person-outline"
              label={s.namePh}
              input={input(s.namePh, name, setName, 120)}
            />
          </View>
          <SelectField
            icon="call-outline"
            label={s.phonePh}
            input={input(s.phonePh, phone, setPhone, 32, 'phone-pad')}
          />
          {attached ? null : (
            <>
              <SelectField
                icon="mail-outline"
                label={s.emailPh}
                input={input(s.emailPh, email, setEmail, 200, 'email-address')}
              />
              <SelectField
                icon="business-outline"
                label={s.companyPh}
                input={input(s.companyPh, company, setCompany, 120)}
              />
              <SelectField
                icon="location-outline"
                label={s.addressPh}
                input={input(s.addressPh, address, setAddress, 300)}
              />
            </>
          )}
        </Section>
        {matches.length ? (
          <ExistingCustomers
            groupId={groupId}
            matches={matches}
            currency={view.currency}
            attachedId={attached?.id ?? null}
            onUse={useCustomer}
            onClear={() => setAttached(null)}
          />
        ) : null}
        <Section icon="clipboard-outline" title={s.inquiryDetails}>
          <View style={{ gap: 4 }}>
            <Required label={s.needLabel} />
            <View
              style={{
                borderWidth: 1,
                borderColor: theme.color.border,
                borderRadius: theme.radius.lg,
                padding: theme.spacing.md,
                minHeight: 96,
              }}
            >
              <TextInput
                accessibilityLabel={s.needLabel}
                value={need}
                onChangeText={setNeed}
                placeholder={s.needPh}
                placeholderTextColor={theme.color.textMuted}
                maxLength={500}
                multiline
                style={[field, { minHeight: 56, textAlignVertical: 'top' }]}
              />
              <Text variant="micro" tone="muted" style={{ alignSelf: 'flex-end' }}>
                {`${need.length}/500`}
              </Text>
            </View>
          </View>
          {attached ? null : (
            <View style={{ gap: 4 }}>
              <Text variant="caption" style={{ fontWeight: '600' }}>
                {s.category}
              </Text>
              <SelectField
                icon="layers-outline"
                label={s.category}
                text={category ? categoryLabel(category) : s.selectCategory}
                placeholder={!category}
                onPress={() => void pickCategory()}
              />
            </View>
          )}
          <View style={{ gap: 4 }}>
            <Text variant="caption" style={{ fontWeight: '600' }}>
              {s.expectedValue}
            </Text>
            <AmountField
              currency={view.currency as CurrencyCode}
              value={value}
              onChange={setValue}
              size="compact"
            />
          </View>
        </Section>
        {attached ? null : (
          <Section icon="megaphone-outline" title={s.cameFrom}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {CLIENT_SOURCES.map((src) => (
                <Pressable
                  key={src}
                  accessibilityRole="button"
                  accessibilityState={{ selected: src === source }}
                  onPress={() => setSource(src)}
                  style={pill(src === source)}
                >
                  <Ionicons name={SOURCE_ICON[src]} size={16} color={pillColor(src === source)} />
                  <Text
                    variant="caption"
                    style={{ fontWeight: '700', color: pillColor(src === source) }}
                  >
                    {sourceLabel(src)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Section>
        )}
        {!existing ? (
          <Section icon="calendar-outline" title={s.followUp}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {followOptions.map((o) => (
                <Pressable
                  key={o.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: o.key === follow }}
                  onPress={() => (o.key === 'pick' ? openPick() : setFollow(o.key))}
                  style={pill(o.key === follow)}
                >
                  {o.key !== 'none' ? (
                    <Ionicons
                      name="calendar-outline"
                      size={16}
                      color={pillColor(o.key === follow)}
                    />
                  ) : null}
                  <Text
                    variant="caption"
                    style={{ fontWeight: '700', color: pillColor(o.key === follow) }}
                  >
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
            {ownerField ? (
              <View style={{ gap: 4 }}>
                <Required label={s.whoFollows} />
                {ownerField}
              </View>
            ) : null}
          </Section>
        ) : ownerField ? (
          <StandardCard style={{ gap: 4 }}>
            <Required label={s.whoFollows} />
            {ownerField}
          </StandardCard>
        ) : null}
        {attached ? null : (
          <Section icon="flag-outline" title={s.priority}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {PRIORITIES.map((p) => (
                <Pressable
                  key={p}
                  accessibilityRole="button"
                  accessibilityState={{ selected: p === priority }}
                  onPress={() => setPriority(p)}
                  style={pill(p === priority)}
                >
                  <Text
                    variant="caption"
                    style={{ fontWeight: '700', color: pillColor(p === priority) }}
                  >
                    {priorityLabel(p)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Section>
        )}
        {!existing ? (
          <Section icon="document-text-outline" title={s.notesOpt}>
            <View
              style={{
                borderWidth: 1,
                borderColor: theme.color.border,
                borderRadius: theme.radius.lg,
                padding: theme.spacing.md,
                minHeight: 96,
              }}
            >
              <TextInput
                accessibilityLabel={s.notesOpt}
                value={notes}
                onChangeText={setNotes}
                placeholder={s.notesPh}
                placeholderTextColor={theme.color.textMuted}
                maxLength={500}
                multiline
                style={[field, { minHeight: 56, textAlignVertical: 'top' }]}
              />
              <Text variant="micro" tone="muted" style={{ alignSelf: 'flex-end' }}>
                {`${notes.length}/500`}
              </Text>
            </View>
          </Section>
        ) : null}
      </ScrollView>
      <View
        style={{
          flexDirection: 'row',
          gap: theme.spacing.md,
          padding: theme.spacing.lg,
          paddingBottom: Math.max(theme.spacing.lg, clearance),
          borderTopWidth: 1,
          borderTopColor: theme.color.border,
          backgroundColor: theme.color.surface,
        }}
      >
        {!existing ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.saveAnother}
            accessibilityState={{ disabled: !name.trim() || busy }}
            disabled={!name.trim() || busy}
            onPress={() => void submit(true)}
            style={{
              flex: 1,
              height: 52,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radius.md,
              backgroundColor: theme.color.brandSoft,
              opacity: !name.trim() || busy ? 0.45 : 1,
            }}
          >
            <Text style={{ color: theme.color.brand, fontWeight: '700' }} numberOfLines={1}>
              {s.saveAnother}
            </Text>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <SaveButton
            label={existing ? s.save : s.saveInquiry}
            disabled={!name.trim() || busy}
            onPress={() => void submit(false)}
          />
        </View>
      </View>
    </Screen>
  );
}
