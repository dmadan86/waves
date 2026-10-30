import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import type { CurrencyCode, Vendor, VendorLineKind } from '@waves/core';
import { AmountField, Sheet, Text, useTheme } from '@waves/ui';

import { FieldLabel, SaveButton } from '@/components/company/EntryForm';
import { MAX_COMPANY_PHOTOS } from '@/components/company/CompanyEntryPhotos';
import { PillButton, SegmentedPills } from '@/components/standard';
import { attachVendorPhoto, useAddVendorLine, useSetVendor } from '@/data/companyVendors';
import { todayIso } from '@/data/personal';
import { useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import { captureReceipt, pickAlbumPhoto, type PickedImage } from '@/lib/image';
import { useSync } from '@/sync';

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
  const [name, setName] = useState(vendor?.name ?? '');
  const [phone, setPhone] = useState(vendor?.phone ?? '');
  const [category, setCategory] = useState(vendor?.category ?? '');
  return (
    <Sheet visible onClose={onClose} closeLabel={s.close}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: theme.spacing.lg }}
      >
        <Text variant="title">{vendor ? s.rename : s.addVendor}</Text>
        <VendorField label={s.name} value={name} onChange={setName} />
        <VendorField label={s.phone} value={phone} onChange={setPhone} />
        <VendorField label={s.category} value={category} onChange={setCategory} />
        <SaveButton
          label={s.save}
          disabled={!name.trim() || save.isPending}
          onPress={() => {
            if (!name.trim() || save.isPending) return;
            save.mutate(
              { vendorId: vendor?.id, name: name.trim(), phone, category },
              {
                onSuccess: (id) => {
                  onClose();
                  onSaved?.(id);
                },
              },
            );
          }}
        />
      </ScrollView>
    </Sheet>
  );
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
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
  const [kind, setKind] = useState<VendorLineKind>(payment ? 'payment' : 'bill');
  const [photos, setPhotos] = useState<PickedImage[]>([]);
  const [picking, setPicking] = useState(false);
  const { flush } = useSync();
  const { notify } = useDialog();
  const photoError = (error: unknown): void => {
    void notify({
      title: friendlyError(error, t.company.photoFailed, 'vendor.photo.add'),
      tone: 'danger',
    });
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
      }
    }
    await flush([groupId]).catch(photoError);
  };
  const valid = amount > 0n && validDate(date);
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
        <VendorField label={s.note} value={note} onChange={setNote} maxLength={500} />
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
        <SaveButton
          label={payment ? s.recordPayment : s.addBill}
          disabled={!valid || add.isPending}
          onPress={() => {
            if (!valid || add.isPending) return;
            add.mutate(
              { vendorId, kind, amountMinor: amount, occurredOn: date, note },
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
