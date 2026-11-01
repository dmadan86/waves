/**
 * Add a vendor. Three ways to fill the form (scan a code, paste a link, look up a Waves ID),
 * then the form itself. Nothing here links the vendor to a Waves account: the lookups only
 * prefill name and phone, which is all a vendor row stores.
 */
import { lazy, Suspense, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';

import { Callout, Screen, Sheet, Text, useTheme } from '@waves/ui';

import { SaveButton } from '@/components/company/EntryForm';
import { ScenicBody, ScenicHeader, StandardCard } from '@/components/standard';
import { findPerson } from '@/data/api';
import { useSetVendor } from '@/data/companyVendors';
import { useStrings } from '@/i18n';
import { channelFor } from '@/lib/linkMember';
import { router } from '@/lib/navigation';
import { cameraAvailable } from '@/lib/qrScan';
import { parseVendorShare } from '@/lib/vendorShare';

const VendorQrScan = lazy(() => import('@/components/company/vendors/VendorQrScan'));

type Mode = 'scan' | 'link' | 'id';
const MODES: { mode: Mode; icon: keyof typeof Ionicons.glyphMap }[] = [
  { mode: 'scan', icon: 'qr-code-outline' },
  { mode: 'link', icon: 'link-outline' },
  { mode: 'id', icon: 'at-outline' },
];

function Field({
  icon,
  value,
  onChange,
  placeholder,
  maxLength = 120,
  keyboardType,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  onChange?: (v: string) => void;
  placeholder: string;
  maxLength?: number;
  keyboardType?: 'phone-pad' | 'email-address';
  onPress?: () => void;
}) {
  const theme = useTheme();
  const muted = theme.color.textMuted;
  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        minHeight: 48,
        paddingHorizontal: theme.spacing.md,
        borderWidth: 1,
        borderColor: theme.color.border,
        borderRadius: theme.radius.pill,
      }}
    >
      <Ionicons name={icon} size={20} color={muted} />
      {onPress ? (
        <Text tone={value ? undefined : 'muted'} style={{ flex: 1 }}>
          {value || placeholder}
        </Text>
      ) : (
        <TextInput
          accessibilityLabel={placeholder}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={muted}
          maxLength={maxLength}
          keyboardType={keyboardType}
          autoCapitalize={keyboardType ? 'none' : 'words'}
          style={{ flex: 1, color: theme.color.text, fontSize: 16, paddingVertical: 10 }}
        />
      )}
      {onPress ? <Ionicons name="chevron-down" size={18} color={theme.color.text} /> : null}
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={placeholder} onPress={onPress}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

export default function AddVendorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyVendors;
  const save = useSetVendor(groupId);
  const [mode, setMode] = useState<Mode>('scan');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [picking, setPicking] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [category, setCategory] = useState('');
  const categories = [
    s.catSupplier,
    s.catContractor,
    s.catLandlord,
    s.catUtilities,
    s.catTransport,
    s.catOther,
  ];

  const help = { scan: s.helpScan, link: s.helpLink, id: s.helpId }[mode];
  const apply = (found: { name?: string; phone?: string } | null): void => {
    if (!found) return setNote(s.lookupFailed);
    setName(found.name ?? '');
    setPhone(found.phone ?? '');
    setNote(null);
  };
  const run = async (): Promise<void> => {
    if (mode === 'scan') {
      setNote(cameraAvailable() ? null : s.lookupFailed);
      if (cameraAvailable()) setScanning(true);
      return;
    }
    if (mode === 'link') return apply(parseVendorShare(code));
    const channel = channelFor(code);
    if (!channel) return setNote(s.idHint);
    setBusy(true);
    try {
      const person = await findPerson(channel, code.trim());
      apply(
        person
          ? { name: person.display_name, ...(channel === 'phone' && { phone: code.trim() }) }
          : null,
      );
    } catch {
      setNote(s.lookupFailed);
    } finally {
      setBusy(false);
    }
  };
  const valid = name.trim().length > 0 && !save.isPending;
  const modeLabel = { scan: s.scanQr, link: s.useLink, id: s.findId }[mode];

  return (
    <Screen edges={[]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: theme.spacing.lg }}
      >
        <ScenicHeader
          title={s.addVendor}
          subtitle={s.addSubtitle}
          titleAlign="start"
          circleBack
          wash
        />
        <ScenicBody>
          <View style={{ gap: theme.spacing.sm }}>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              {MODES.map((m) => {
                const on = m.mode === mode;
                const label = { scan: s.scanQr, link: s.fromLink, id: s.wavesId }[m.mode];
                return (
                  <Pressable
                    key={m.mode}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => {
                      setMode(m.mode);
                      setNote(null);
                    }}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      gap: theme.spacing.xs,
                      paddingVertical: theme.spacing.md,
                      borderRadius: theme.radius.lg,
                      borderWidth: 1.5,
                      borderColor: on ? theme.color.brand : 'transparent',
                      backgroundColor: on ? theme.color.brandSoft : theme.color.surface,
                    }}
                  >
                    <Ionicons
                      name={m.icon}
                      size={26}
                      color={on ? theme.color.brand : theme.color.textMuted}
                    />
                    <Text style={{ fontWeight: '700' }}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text variant="caption" tone="muted" align="center">
              {help}
            </Text>
          </View>
          {mode !== 'scan' ? (
            <Field
              icon={mode === 'link' ? 'link-outline' : 'at-outline'}
              value={code}
              onChange={setCode}
              placeholder={mode === 'link' ? s.linkPlaceholder : s.idPlaceholder}
              maxLength={300}
              keyboardType={mode === 'id' ? 'email-address' : undefined}
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy || (mode !== 'scan' && !code.trim())}
            onPress={() => void run()}
            style={{
              height: 52,
              flexDirection: 'row',
              gap: theme.spacing.sm,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.brand,
              opacity: busy || (mode !== 'scan' && !code.trim()) ? 0.45 : 1,
            }}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Ionicons
                name={mode === 'scan' ? 'scan-outline' : 'search-outline'}
                size={22}
                color="#fff"
              />
            )}
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 17 }}>{modeLabel}</Text>
          </Pressable>
          {note ? <Callout tone="negative">{note}</Callout> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.color.border }} />
            <Text variant="caption" tone="muted" style={{ fontWeight: '700' }}>
              {s.or}
            </Text>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.color.border }} />
          </View>
          <StandardCard>
            <View style={{ gap: theme.spacing.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: theme.radius.md,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: theme.color.brandSoft,
                  }}
                >
                  <Ionicons name="create-outline" size={20} color={theme.color.brand} />
                </View>
                <Text variant="heading" style={{ fontSize: 18 }}>
                  {s.enterManually}
                </Text>
              </View>
              <Field
                icon="person-outline"
                value={name}
                onChange={setName}
                placeholder={`${s.name} *`}
              />
              <Field
                icon="call-outline"
                value={phone}
                onChange={setPhone}
                placeholder={s.phoneOptional}
                maxLength={20}
                keyboardType="phone-pad"
              />
              <Field
                icon="pricetag-outline"
                value={category}
                placeholder={s.categoryOptional}
                onPress={() => setPicking(true)}
              />
            </View>
          </StandardCard>
        </ScenicBody>
      </ScrollView>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
        <SaveButton
          label={s.saveVendor}
          disabled={!valid}
          onPress={() =>
            save.mutate(
              { name, phone, category },
              {
                onSuccess: (vendorId) =>
                  router.replace(`/group/${groupId}/company-vendor?vendorId=${vendorId}`),
              },
            )
          }
        />
      </View>
      {scanning ? (
        <Suspense fallback={null}>
          <VendorQrScan
            onClose={() => setScanning(false)}
            onRead={(data) => {
              setScanning(false);
              apply(parseVendorShare(data));
            }}
          />
        </Suspense>
      ) : null}
      {picking ? (
        <Sheet visible onClose={() => setPicking(false)} closeLabel={s.close}>
          <Text variant="title">{s.category}</Text>
          {categories.map((c) => (
            <Pressable
              key={c}
              accessibilityRole="button"
              onPress={() => {
                setCategory(c);
                setPicking(false);
              }}
              style={{ paddingVertical: theme.spacing.md }}
            >
              <Text style={{ fontWeight: c === category ? '700' : '400' }}>{c}</Text>
            </Pressable>
          ))}
        </Sheet>
      ) : null}
    </Screen>
  );
}
