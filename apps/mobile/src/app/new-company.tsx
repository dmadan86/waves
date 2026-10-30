/**
 * Create company: a name, an optional logo and a currency, nothing else. It is
 * the same `group.create` (type Company, same guest guard and ad gate) as the
 * group form, but none of that form's group controls apply to a company.
 */

import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';

import { Button, Callout, Screen, Text, useTheme } from '@waves/ui';

import { CompanyLogoField } from '@/components/company/CompanyLogoField';
import { DetailRow, DetailRows } from '@/components/DetailRows';
import { CurrencySheet } from '@/components/expense/CurrencySheet';
import { ScenicBody, ScenicHeader, StandardCard } from '@/components/standard';
import { canUploadGroupPhoto, uploadGroupPhoto } from '@/data/api';
import { useCreateGroup } from '@/data/hooks';
import { GroupType } from '@/data/types';
import { deviceCountry, useStrings } from '@/i18n';
import { AdGateCancelledError } from '@/lib/adGateBridge';
import { useDefaultCurrency } from '@/lib/currency';
import { friendlyError } from '@/lib/errors';
import { useGuestGuard } from '@/lib/guestGuard';
import type { PickedImage } from '@/lib/image';
import { uploadWhenAllowed } from '@/lib/logoUploadWhenReady';
import { router } from '@/lib/navigation';
import { useToast } from '@/lib/toast';

export default function NewCompanyScreen() {
  const theme = useTheme();
  const { t } = useStrings();
  const createGroup = useCreateGroup();
  const defaultCurrency = useDefaultCurrency();
  const guard = useGuestGuard();
  const toast = useToast();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<string | null>(null);
  const [pickingCur, setPickingCur] = useState(false);
  const [logo, setLogo] = useState<PickedImage | null>(null);
  const [logoOpen, setLogoOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  const submit = async (): Promise<void> => {
    // Same gates as a new group: guest limit here, the ad gate inside the hook.
    if (guard.blockAddGroup()) return;
    setError(null);
    try {
      const groupId = await createGroup.mutateAsync({
        name: trimmed,
        type: GroupType.Company,
        country: deviceCountry(),
        currency: currency ?? defaultCurrency,
        emoji: '🏢',
        simplify: false,
      });
      if (logo) {
        void uploadWhenAllowed(
          () => canUploadGroupPhoto(groupId),
          () =>
            uploadGroupPhoto({
              groupId,
              base64: logo.base64,
              mimeType: logo.mimeType,
              kind: 'logo',
            }),
        ).then((done) => {
          if (!done) toast.show(t.company.logoLater, 'negative');
        });
      }
      // Lands on the company Overview, which shows the invite-your-team card
      // until there is a team.
      router.replace(`/group/${groupId}`);
    } catch (caught) {
      if (caught instanceof AdGateCancelledError) return;
      setError(friendlyError(caught, t.couldNotSave, 'newCompany.create'));
    }
  };

  return (
    <Screen edges={['bottom']}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <ScenicHeader title={t.company.newTitle} />
        <ScenicBody>
          <StandardCard>
            <Text style={{ fontSize: 13, fontWeight: '600', marginBottom: theme.spacing.xs }}>
              {t.company.nameLabel}
            </Text>
            <View
              style={{
                borderWidth: 1,
                borderColor: theme.color.border,
                borderRadius: 12,
                minHeight: 44,
                paddingHorizontal: theme.spacing.md,
                justifyContent: 'center',
              }}
            >
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={t.company.namePlaceholder}
                placeholderTextColor={theme.color.textFaint}
                accessibilityLabel={t.company.nameLabel}
                autoFocus
                style={{ fontSize: 16, color: theme.color.text, paddingVertical: 0 }}
              />
            </View>
          </StandardCard>
          <StandardCard>
            <DetailRows>
              <DetailRow
                icon="cash-outline"
                label={t.company.currencyRow}
                value={currency ?? defaultCurrency}
                onPress={() => setPickingCur(true)}
              />
              <View>
                <DetailRow
                  icon="image-outline"
                  label={t.company.logoRow}
                  value={logo ? '✓' : t.add}
                  placeholder={!logo}
                  expanded={logoOpen}
                  onPress={() => setLogoOpen((open) => !open)}
                />
                {logoOpen ? (
                  <View style={{ paddingBottom: theme.spacing.md }}>
                    <CompanyLogoField
                      stagedUri={logo?.uri ?? null}
                      onImage={(image) => {
                        setLogo(image);
                        return null;
                      }}
                      onRemove={() => setLogo(null)}
                    />
                  </View>
                ) : null}
              </View>
            </DetailRows>
          </StandardCard>
        </ScenicBody>
      </ScrollView>
      {pickingCur ? (
        <CurrencySheet
          value={currency ?? defaultCurrency}
          onPick={(code) => {
            setCurrency(code);
            setPickingCur(false);
          }}
          onClose={() => setPickingCur(false)}
        />
      ) : null}
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.xs,
          paddingBottom: theme.spacing.sm,
          gap: theme.spacing.xs,
        }}
      >
        {error ? <Callout tone="negative">{error}</Callout> : null}
        <Button
          label={t.company.createCompany}
          disabled={!trimmed || createGroup.isPending}
          onPress={() => void submit()}
        />
      </View>
    </Screen>
  );
}
