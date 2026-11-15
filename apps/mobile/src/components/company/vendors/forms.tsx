import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import type { CurrencyCode, Vendor, VendorLineKind } from '@waves/core';
import { AmountField, Sheet, Text, useTheme } from '@waves/ui';

import { FieldLabel, SaveButton } from '@/components/company/EntryForm';
import { MAX_COMPANY_PHOTOS } from '@/components/company/CompanyEntryPhotos';
import { PillButton, SegmentedPills } from '@/components/standard';
import {
  attachVendorPhoto,
  useAddVendorLine,
  useCompanyVendors,
  useSetVendor,
} from '@/data/companyVendors';
import { todayIso } from '@/data/personal';
import { useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { StorageCapError } from '@/lib/storage';
import { companyPhotoError } from '@/data/companyStorage';
import { captureReceipt, pickAlbumPhoto, type PickedImage } from '@/lib/image';
import { useSync } from '@/sync';
import {
  addCategory,
  categoryOptions,
  removeCategory,
  toggleCategory,
} from '@/lib/vendorCategories';

export function VendorField({
  label,
  value,
  onChange,
  maxLength = 120,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
}) {
  const theme = useTheme();
  const { locale } = useStrings();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <FieldLabel>{label}</FieldLabel>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        maxLength={maxLength}
        style={{
          color: theme.color.text,
          fontSize: 16,
          textAlign: locale.startsWith('ar') ? 'right' : 'left',
          paddingVertical: theme.spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: theme.color.border,
        }}
      />
    </View>
  );
}

export function VendorForm({
  groupId,
  vendor,
  onClose,
  onSaved,
}: {
  groupId: string;
  vendor?: Vendor;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyVendors;
  const save = useSetVendor(groupId);
  const { vendors } = useCompanyVendors(groupId);
  const [name, setName] = useState(vendor?.name ?? '');
  const [phone, setPhone] = useState(vendor?.phone ?? '');
  const [cats, setCats] = useState<string[]>([...(vendor?.categories ?? [])]);
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);
  const presets = [
    s.catMaterials,
    s.catCement,
    s.catElectrical,
    s.catPlumbing,
    s.catPainting,
    s.catHardware,
    s.catLabour,
  ];
  const morePresets = [
    s.catSupplier,
    s.catContractor,
    s.catLandlord,
    s.catUtilities,
    s.catTransport,
    s.catOther,
  ];
  const options = categoryOptions(
    presets,
    morePresets,
    vendors.map((v) => v.categories),
    expanded,
  );
  const commitDraft = (): void => {
    setCats((c) => addCategory(c, draft));
    setDraft('');
  };
  const input = {
    flex: 1,
    color: theme.color.text,
    fontSize: 16,
    paddingVertical: theme.spacing.sm,
  } as const;
  const field = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
  } as const;
  const submit = (): void => {
    if (!name.trim() || save.isPending) return;
    save.mutate(
      { vendorId: vendor?.id, name: name.trim(), phone, categories: addCategory(cats, draft) },
      {
        onSuccess: (id) => {
          onClose();
          onSaved?.(id);
        },
      },
    );
  };
  const button = (label: string, onPress: () => void, primary: boolean, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        flex: 1,
        height: 48,
        flexDirection: 'row',
        gap: theme.spacing.xs,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radius.md,
        backgroundColor: primary ? theme.color.brand : 'transparent',
        borderWidth: primary ? 0 : 1,
        borderColor: theme.color.border,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {primary ? <Ionicons name="checkmark" size={18} color={theme.color.onBrand} /> : null}
      <Text
        variant="subheading"
        style={{ color: primary ? theme.color.onBrand : theme.color.text, fontWeight: '700' }}
      >
        {label}
      </Text>
    </Pressable>
  );
  return (
    <Sheet visible onClose={onClose} closeLabel={s.close}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: theme.spacing.lg }}
      >
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
            <Ionicons name="storefront-outline" size={22} color={theme.color.brand} />
          </View>
          <Text variant="title" style={{ flex: 1 }}>
            {vendor ? s.editVendor : s.addVendor}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.close}
            hitSlop={8}
            onPress={onClose}
          >
            <Ionicons name="close" size={24} color={theme.color.textMuted} />
          </Pressable>
        </View>
        <View style={{ gap: theme.spacing.sm }}>
          <FieldLabel>{s.vendorNameRequired}</FieldLabel>
          <View style={field}>
            <Ionicons name="storefront-outline" size={20} color={theme.color.textMuted} />
            <TextInput
              accessibilityLabel={s.vendorNameRequired}
              value={name}
              onChangeText={setName}
              maxLength={120}
              style={input}
            />
          </View>
        </View>
        <View style={{ gap: theme.spacing.sm }}>
          <FieldLabel>{s.phone}</FieldLabel>
          <View style={field}>
            <Ionicons name="call-outline" size={20} color={theme.color.textMuted} />
            <TextInput
              accessibilityLabel={s.phone}
              value={phone}
              onChangeText={setPhone}
              maxLength={32}
              keyboardType="phone-pad"
              style={input}
            />
          </View>
        </View>
        <View style={{ gap: theme.spacing.sm }}>
          <FieldLabel>{s.categories}</FieldLabel>
          <View style={[field, { flexWrap: 'wrap', paddingVertical: theme.spacing.xs }]}>
            {cats.map((c) => (
              <Pressable
                key={c}
                accessibilityRole="button"
                accessibilityLabel={s.removeCategory.replace('{name}', c)}
                onPress={() => setCats((list) => removeCategory(list, c))}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.xs,
                  paddingHorizontal: theme.spacing.sm,
                  height: 30,
                  borderRadius: theme.radius.sm,
                  backgroundColor: theme.color.brandSoft,
                }}
              >
                <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '600' }}>
                  {c}
                </Text>
                <Ionicons name="close" size={14} color={theme.color.brand} />
              </Pressable>
            ))}
            <TextInput
              accessibilityLabel={s.addOrSelectCategory}
              placeholder={s.addOrSelectCategory}
              placeholderTextColor={theme.color.textFaint}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={commitDraft}
              maxLength={40}
              returnKeyType="done"
              blurOnSubmit={false}
              style={[input, { minWidth: 140 }]}
            />
          </View>
        </View>
        <View
          style={{
            gap: theme.spacing.md,
            padding: theme.spacing.md,
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: theme.color.border,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="subheading" style={{ flex: 1, fontWeight: '700' }}>
              {s.selectOrAddCategories}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.addCategory}
              onPress={commitDraft}
            >
              <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '700' }}>
                {`+ ${s.addCategory}`}
              </Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {options.map((c) => {
              const on = cats.some((x) => x.toLowerCase() === c.toLowerCase());
              return (
                <Pressable
                  key={c}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={c}
                  onPress={() => setCats((list) => toggleCategory(list, c))}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.xs,
                    paddingHorizontal: theme.spacing.md,
                    height: 40,
                    borderRadius: theme.radius.sm,
                    borderWidth: 1,
                    borderColor: on ? theme.color.brand : theme.color.border,
                    backgroundColor: on ? theme.color.brandSoft : 'transparent',
                  }}
                >
                  <Ionicons
                    name={on ? 'checkbox' : 'square-outline'}
                    size={18}
                    color={on ? theme.color.brand : theme.color.textMuted}
                  />
                  <Text variant="caption">{c}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? s.showLess : s.showMore}
            onPress={() => setExpanded((e) => !e)}
          >
            <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '700' }}>
              {`${expanded ? '-' : '+'} ${expanded ? s.showLess : s.showMore}`}
            </Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          {button(s.cancel, onClose, false)}
          {button(s.save, submit, true, !name.trim() || save.isPending)}
        </View>
      </ScrollView>
    </Sheet>
  );
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function useLinePhotos(groupId: string) {
  const { t } = useStrings();
  const [photos, setPhotos] = useState<PickedImage[]>([]);
  const [picking, setPicking] = useState(false);
  const { flush } = useSync();
  const { notify } = useDialog();
  const photoError = (error: unknown): void => {
    void notify({ title: companyPhotoError(error, t, 'vendor.photo.add'), tone: 'danger' });
  };
  const pickPhoto = async (source: 'camera' | 'library'): Promise<void> => {
    if (picking || photos.length >= MAX_COMPANY_PHOTOS) return;
    setPicking(true);
    try {
      const picked = source === 'camera' ? await captureReceipt() : await pickAlbumPhoto();
      if (picked) setPhotos((previous) => [...previous, picked].slice(0, MAX_COMPANY_PHOTOS));
    } catch (error) {
      photoError(error);
    } finally {
      setPicking(false);
    }
  };
  const uploadPhotos = async (lineId: string, picked: PickedImage[]): Promise<void> => {
    try {
      await flush([groupId]);
    } catch (error) {
      photoError(error);
      return;
    }
    for (const photo of picked) {
      try {
        await attachVendorPhoto(groupId, lineId, photo);
      } catch (error) {
        photoError(error);
        if (error instanceof StorageCapError) break;
      }
    }
    await flush([groupId]).catch(photoError);
  };
  return { photos, setPhotos, uploadPhotos, pickPhoto };
}

export function PhotoStrip({
  photos,
  setPhotos,
  pickPhoto,
}: {
  photos: PickedImage[];
  setPhotos: (next: (previous: PickedImage[]) => PickedImage[]) => void;
  pickPhoto: (source: 'camera' | 'library') => Promise<void>;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <>
      {photos.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: theme.spacing.sm }}
        >
          {photos.map((photo, index) => (
            <View key={index} style={{ width: 64, height: 64 }}>
              <Image
                source={{ uri: photo.uri }}
                contentFit="cover"
                style={{ width: 64, height: 64, borderRadius: theme.radius.md }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.company.removePhoto}
                onPress={() => setPhotos((previous) => previous.filter((_, i) => i !== index))}
                style={{
                  position: 'absolute',
                  top: 0,
                  end: 0,
                  width: 32,
                  height: 32,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.color.surfaceMuted,
                }}
              >
                <Ionicons name="close" size={20} color={theme.color.text} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      {photos.length < MAX_COMPANY_PHOTOS ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          <PillButton
            label={t.company.takePhoto}
            icon="camera-outline"
            chevron={false}
            onPress={() => void pickPhoto('camera')}
          />
          <PillButton
            label={t.company.choosePhoto}
            icon="image-outline"
            chevron={false}
            onPress={() => void pickPhoto('library')}
          />
        </View>
      ) : null}
    </>
  );
}

export function validIsoDate(value: string): boolean {
  return validDate(value);
}

export function VendorLineForm({
  groupId,
  vendorId,
  currency,
  payment = false,
  submitted = false,
  onClose,
}: {
  groupId: string;
  vendorId: string;
  currency: string;
  payment?: boolean;
  submitted?: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyVendors;
  const add = useAddVendorLine(groupId);
  const [amount, setAmount] = useState(0n);
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [kind, setKind] = useState<VendorLineKind>(payment ? 'payment' : 'bill');
  const { photos, setPhotos, uploadPhotos, pickPhoto } = useLinePhotos(groupId);
  const valid = amount > 0n && validDate(date) && (!dueOn || validDate(dueOn));
  return (
    <Sheet visible onClose={onClose} closeLabel={s.close}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: theme.spacing.lg }}
      >
        <Text variant="title">{payment ? s.recordPayment : s.addBill}</Text>
        {submitted ? (
          <Text variant="caption" tone="muted">
            {s.billHint}
          </Text>
        ) : null}
        {payment ? (
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <SegmentedPills
              options={[
                { value: 'advance', label: s.advance },
                { value: 'payment', label: s.payment },
              ]}
              value={kind}
              onChange={setKind}
            />
          </View>
        ) : null}
        <FieldLabel>{s.amount}</FieldLabel>
        <AmountField
          currency={currency as CurrencyCode}
          value={amount}
          onChange={setAmount}
          size="compact"
        />
        <VendorField
          label={`${s.date} (${s.dateHint})`}
          value={date}
          onChange={setDate}
          maxLength={10}
        />
        {!validDate(date) ? (
          <Text variant="caption" tone="negative">
            {s.invalidDate}
          </Text>
        ) : null}
        {kind === 'bill' ? (
          <VendorField
            label={`${s.dueDate} (${s.dateHint})`}
            value={dueOn}
            onChange={setDueOn}
            maxLength={10}
          />
        ) : null}
        <VendorField label={s.note} value={note} onChange={setNote} maxLength={500} />
        <PhotoStrip photos={photos} setPhotos={setPhotos} pickPhoto={pickPhoto} />
        <SaveButton
          label={payment ? s.recordPayment : s.addBill}
          disabled={!valid || add.isPending}
          onPress={() => {
            if (!valid || add.isPending) return;
            add.mutate(
              {
                vendorId,
                kind,
                amountMinor: amount,
                occurredOn: date,
                note,
                dueOn: kind === 'bill' ? dueOn : null,
              },
              {
                onSuccess: (lineId) => {
                  onClose();
                  if (photos.length) void uploadPhotos(lineId, photos);
                },
              },
            );
          }}
        />
      </ScrollView>
    </Sheet>
  );
}
