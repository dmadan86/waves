/**
 * Paying — how people pay you.
 *
 * Was the second face of the profile screen (a SegmentedTab); it is now a row
 * in the settings list with a page of its own. The country decides which rails
 * exist, so it sits above them and is changeable here — the device guess is
 * only a start. Changing country resets the rail to that country's default and
 * clears any handle typed for the old one: a UPI ID means nothing once the rail
 * is Aani.
 *
 * It writes only the payment fields, so saving here never touches the name.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  countryFlag,
  countryName,
  currencySymbol,
  defaultRailFor,
  isValidHandle,
  railById,
  railsFor,
} from '@waves/core';
import {
  Button,
  Card,
  directionalIcon,
  EmptyState,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { friendlyError } from '@/lib/errors';
import { deviceCountry, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { requestCountry } from '@/lib/countryPickerBridge';
import { useDefaultCurrency } from '@/lib/currency';
import { router } from '@/lib/navigation';

export default function PayingScreen() {
  const { profile, profileSettled, reloadProfile } = useAuth();
  const { t } = useStrings();
  // Seed once, keyed on the id, so Save never writes an empty seed over a real
  // row before the profile has loaded.
  //
  // Blank while it is on its way, but not blank for ever: when the load has
  // settled with no profile it is not coming, and an empty screen with no way
  // out is the wrong answer to that.
  if (!profile) {
    return (
      <Screen>
        {profileSettled ? (
          <EmptyState
            title={t.loadError}
            body={t.loadErrorBody}
            action={<Button label={t.retry} variant="secondary" onPress={reloadProfile} />}
          />
        ) : (
          <View />
        )}
      </Screen>
    );
  }
  return <PayingForm key={profile.id} />;
}

function PayingForm() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t } = useStrings();
  const { profile, updateProfile } = useAuth();
  const currency = useDefaultCurrency();

  const [country, setCountry] = useState<string | null>(profile?.country_code ?? deviceCountry());
  /**
   * How this person is paid. Falls back through the rail pair, then the old
   * `default_vpa` — anything written before rails existed can only have been a
   * UPI ID, and nobody should have to type theirs again.
   */
  const [rail, setRail] = useState(
    profile?.payment_rail ?? (profile?.default_vpa ? 'upi' : defaultRailFor(country)),
  );
  const [handle, setHandle] = useState(profile?.payment_handle ?? profile?.default_vpa ?? '');
  const [status, setStatus] = useState<string | null>(null);

  // Changing country changes which rails exist, so the rail drops to that
  // country's default and any handle typed for the old rail is cleared.
  const onCountry = (next: string | null): void => {
    setCountry(next);
    setRail(defaultRailFor(next));
    setHandle('');
  };
  const openCountry = (): void => {
    requestCountry({ initial: country, onPicked: onCountry });
    router.push('/country');
  };

  const railInfo = railById(rail);
  const rails = railsFor(country);
  const trimmed = handle.trim();
  const handleValid = trimmed === '' || isValidHandle(rail, trimmed);
  // The rail falls back to the country's default — the same seed the state took
  // — so switching rail alone still counts as a change. Comparing rail against
  // itself never did.
  const dirty =
    country !== (profile?.country_code ?? deviceCountry()) ||
    trimmed !== (profile?.payment_handle ?? profile?.default_vpa ?? '') ||
    rail !== (profile?.payment_rail ?? (profile?.default_vpa ? 'upi' : defaultRailFor(country)));

  const save = async (): Promise<void> => {
    setStatus(null);
    // Some rails carry no handle at all (railInfo.handle === 'none') — you pick
    // the rail and there is nothing to type. Those save the rail with no handle;
    // only a rail that needs a handle is dropped when the handle is left empty.
    const needsHandle = railInfo?.handle !== 'none';
    const hasHandle = needsHandle && trimmed !== '';
    try {
      await updateProfile({
        country_code: country,
        payment_rail: needsHandle && trimmed === '' ? null : rail,
        payment_handle: hasHandle ? trimmed : null,
        // Kept in step while the older screens still read it. A handle on any
        // other rail is not a UPI ID and must not masquerade as one.
        default_vpa: rail === 'upi' && hasHandle ? trimmed : null,
      });
      setStatus(t.account.saved);
    } catch (caught) {
      setStatus(friendlyError(caught, t.couldNotSave, 'paying.save'));
    }
  };

  // The country's first three rails, the way the country card names them.
  const settles = rails
    .slice(0, 3)
    .map((entry) => entry.label)
    .join(', ');

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Back, then the title over a line on what the screen is for, with a
            small card-and-coin drawing off to the right. */}
        <View style={{ paddingTop: theme.spacing.sm }}>
          <IconButton label={t.common.back} onPress={() => router.back()}>
            <Ionicons
              name={directionalIcon('chevron-back')}
              size={iconSize.lg}
              color={theme.color.text}
            />
          </IconButton>
          <Row style={{ alignItems: 'flex-end', gap: theme.spacing.md }}>
            <View style={{ flex: 1, paddingBottom: 2 }}>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={{ fontSize: 26, lineHeight: 32, fontWeight: '800', color: theme.color.text }}
              >
                {t.receiving.title}
              </Text>
              <Text variant="body" tone="muted" numberOfLines={2}>
                {t.receiving.subtitle}
              </Text>
            </View>
            <WalletArt symbol={currencySymbol(currency)} />
          </Row>
        </View>

        {/* The country decides which rails exist below, so it sits above them
            and is changeable here — the device guess is only a start. */}
        <Card style={{ padding: theme.spacing.md }}>
          <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <View
              style={{
                width: 56,
                height: 42,
                borderRadius: 10,
                overflow: 'hidden',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.color.surfaceMuted,
              }}
            >
              <Text style={{ fontSize: 34, lineHeight: 42 }}>{countryFlag(country) ?? '🌐'}</Text>
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text variant="caption" tone="muted">
                {t.pickers.country}
              </Text>
              <Text variant="body" numberOfLines={1} style={{ fontWeight: '700' }}>
                {country ? (countryName(country) ?? country) : t.pickers.notSet}
              </Text>
              {settles ? (
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {t.receiving.settlesWith.replace('{rails}', settles)}
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t.receiving.change}: ${t.pickers.country}`}
              onPress={openCountry}
              hitSlop={6}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 2,
                height: 36,
                paddingStart: theme.spacing.md,
                paddingEnd: theme.spacing.sm,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: theme.color.border,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text variant="caption" style={{ fontWeight: '600' }}>
                {t.receiving.change}
              </Text>
              <Ionicons
                name={directionalIcon('chevron-forward')}
                size={iconSize.sm}
                color={theme.color.textMuted}
              />
            </Pressable>
          </Row>
        </Card>

        <Card style={{ padding: theme.spacing.md, gap: theme.spacing.md }}>
          <View style={{ gap: 2 }}>
            <Text variant="subheading">{t.account.howPeoplePayYou}</Text>
            <Text variant="caption" tone="muted">
              {t.receiving.howSub}
            </Text>
          </View>

          {/* Whatever this person's country uses, as tiles — the glyph over the
              name, the chosen one lit. In India that still starts on UPI; in the
              UAE on Aani. Scrolls sideways past the first four. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: theme.spacing.sm }}
          >
            {rails.map((entry) => {
              const selected = entry.id === rail;
              return (
                <Pressable
                  key={entry.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={entry.label}
                  onPress={() => setRail(entry.id)}
                  style={({ pressed }) => ({
                    width: 74,
                    height: 72,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    borderRadius: 14,
                    borderWidth: selected ? 1.5 : 1,
                    borderColor: selected ? theme.color.brand : theme.color.border,
                    backgroundColor: selected ? theme.color.brandSoft : theme.color.surface,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Ionicons
                    name={entry.icon as keyof typeof Ionicons.glyphMap}
                    size={iconSize.lg}
                    color={selected ? theme.color.brand : theme.color.text}
                  />
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                    style={{
                      fontSize: 12,
                      paddingHorizontal: 4,
                      fontWeight: selected ? '700' : '500',
                      color: selected ? theme.color.brand : theme.color.text,
                    }}
                  >
                    {entry.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {railInfo && railInfo.handle !== 'none' ? (
            <View
              style={{
                gap: theme.spacing.sm,
                padding: theme.spacing.md,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.scheme === 'dark' ? theme.color.surfaceMuted : '#F4F2FD',
              }}
            >
              <Text variant="body" style={{ fontWeight: '700' }}>
                {t.account.yourRailDetails.replace('{rail}', railInfo.label)}
              </Text>
              <Row
                style={{
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  height: 48,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: handleValid ? theme.color.border : theme.color.negative,
                  backgroundColor: theme.color.surface,
                }}
              >
                <TextInput
                  value={handle}
                  onChangeText={setHandle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel={t.account.yourRailDetails.replace('{rail}', railInfo.label)}
                  placeholder={railInfo.handleHint}
                  placeholderTextColor={theme.color.textFaint}
                  style={{
                    flex: 1,
                    fontSize: 16,
                    fontWeight: '600',
                    color: handleValid ? theme.color.text : theme.color.negative,
                    paddingVertical: 0,
                  }}
                />
                {/* A tick once the handle reads right, a mark when it does not;
                    nothing while the field is empty. */}
                {trimmed !== '' ? (
                  <Ionicons
                    name={handleValid ? 'checkmark-circle' : 'alert-circle'}
                    size={iconSize.lg}
                    color={handleValid ? theme.color.positive : theme.color.negative}
                  />
                ) : null}
              </Row>
              <Row style={{ alignItems: 'flex-start', gap: theme.spacing.sm }}>
                <Ionicons
                  name={handleValid ? 'shield-checkmark' : 'alert-circle-outline'}
                  size={iconSize.md}
                  color={handleValid ? theme.color.brand : theme.color.negative}
                />
                <Text
                  variant="caption"
                  tone={handleValid ? 'muted' : 'negative'}
                  style={{ flex: 1 }}
                >
                  {!handleValid
                    ? t.account.handleWrong.replace('{hint}', railInfo.handleHint.toLowerCase())
                    : railInfo.link
                      ? t.account.railLinkNote
                      : t.account.railManualNote}
                </Text>
              </Row>
            </View>
          ) : (
            <Text variant="caption" tone="muted">
              {t.account.nothingToAdd}
            </Text>
          )}

          <Button
            label={t.common.save}
            size="lg"
            fullWidth
            disabled={!dirty || !handleValid}
            onPress={() => void save()}
          />
          {status ? (
            <Text
              variant="caption"
              align="center"
              tone={status === t.account.saved ? 'positive' : 'negative'}
            >
              {status}
            </Text>
          ) : null}
        </Card>
      </ScrollView>
    </Screen>
  );
}

/**
 * The header's picture: a tilted brand card with a coin at its corner and
 * three strokes bursting above, drawn from views. Decoration only, so it is
 * hidden from screen readers.
 */
function WalletArt({ symbol }: { symbol: string }) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width: 96, height: 76 }}
    >
      <View
        style={{
          position: 'absolute',
          start: 4,
          bottom: 0,
          width: 76,
          height: 50,
          borderRadius: 12,
          backgroundColor: theme.color.brand,
          transform: [{ rotate: '-12deg' }],
          opacity: 0.9,
        }}
      >
        <View
          style={{
            marginTop: 22,
            marginStart: 10,
            width: 26,
            height: 7,
            borderRadius: 4,
            backgroundColor: 'rgba(255, 255, 255, 0.5)',
          }}
        />
      </View>
      <View
        style={{
          position: 'absolute',
          end: 0,
          bottom: 6,
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: '#F6A23B',
          borderWidth: 3,
          borderColor: '#FFD48A',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: '800', color: '#FFFFFF' }}>{symbol}</Text>
      </View>
      {[-30, 0, 30].map((angle, index) => (
        <View
          key={angle}
          style={{
            position: 'absolute',
            top: index === 1 ? 0 : 6,
            end: 26 - index * 12,
            width: 3,
            height: 14,
            borderRadius: 2,
            backgroundColor: theme.color.brand,
            opacity: 0.6,
            transform: [{ rotate: `${angle}deg` }],
          }}
        />
      ))}
    </View>
  );
}
