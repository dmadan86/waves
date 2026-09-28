/**
 * Adding your details, whenever you feel like it (ADR-006).
 *
 * Waves asks for nothing to get started, so this screen exists for the moment
 * someone decides they want the account to outlive the phone. It attaches an
 * email or a phone number to the account they already have — it does not make
 * a new one, so everything entered as a guest comes with them.
 */

import { useRef, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  Badge,
  Button,
  Callout,
  ChipRow,
  directionalIcon,
  Divider,
  EmptyState,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import {
  countryFlag,
  countryName,
  currencyForCountry,
  currencySymbol,
  dialingCodeForCountry,
} from '@waves/core';

import { CountryCodePicker } from '@/components/CountryCodePicker';
import { DismissibleCallout } from '@/components/DismissibleCallout';
import { EditTextSheet } from '@/components/EditTextSheet';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { useAvatarEditor } from '@/lib/avatarEditor';
import { requestCountry } from '@/lib/countryPickerBridge';
import { friendlyError } from '@/lib/errors';
import { confirmContact, startAddingContact, ContactChannel } from '@/data/api';
import { deviceCountry, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useIdentityTaken } from '@/lib/useIdentityTaken';
import { router } from '@/lib/navigation';
import { SPEC_ACCENT, SPEC_INK, SPEC_MUTED } from '@/lib/specPalette';
import { phoneSignInAvailable } from '@/lib/phoneAuth';

export default function AccountScreen() {
  const { profile, profileSettled, reloadProfile } = useAuth();
  const { t } = useStrings();
  // The name field seeds from `profile` exactly once. Mount the form only once
  // there is a profile to seed from, keyed on its id, so a name that arrives
  // after the first paint is not left as an empty seed that Save would write
  // back over the real row.
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
  return <AccountForm key={profile.id} />;
}

function AccountForm() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t } = useStrings();
  const { session, profile, isGuest, refresh, updateProfile, withGoogle, withApple } = useAuth();
  const resolveIdentityTaken = useIdentityTaken();

  // Set when a guest was sent here by a limit rather than arriving on their own
  // (ADR-006 addendum). It only changes the explainer at the top; the linking
  // below is the same either way.
  const { reason } = useLocalSearchParams<{ reason?: 'group_limit' | 'trial_expired' }>();
  const gateBody =
    reason === 'group_limit'
      ? t.contact.gateGroupBody
      : reason === 'trial_expired'
        ? t.contact.gateExpiredBody
        : null;

  // The display name lives here now — "You" folded into "Your account", since
  // both were the same thing edited on two screens. Seeded once from the
  // profile; the key on this screen's owner keeps it honest across a swap.
  const [name, setName] = useState(profile?.display_name ?? '');
  const [nameStatus, setNameStatus] = useState<string | null>(null);
  /** Which row's editor is open, or null. */
  const [editing, setEditing] = useState<'name' | 'address' | null>(null);
  const [rowSaving, setRowSaving] = useState(false);
  // The portrait's sheet, shared with Settings so the two cannot drift.
  const photo = useAvatarEditor();

  // Region: the country decides the default currency (and settle rails) and,
  // optionally, a postal address. Seeded from the profile, falling back to the
  // phone's region so the field is rarely empty on first open.
  const [country, setCountry] = useState<string | null>(
    profile?.country_code ?? deviceCountry() ?? null,
  );
  const [regionStatus, setRegionStatus] = useState<string | null>(null);
  const [address, setAddress] = useState(profile?.address ?? '');
  const [addressStatus, setAddressStatus] = useState<string | null>(null);
  // The country drives this: it is what every new group and expense starts on.
  const currency = currencyForCountry(country) ?? profile?.default_currency ?? 'INR';
  // The list has one place to say something went wrong, so the three writes
  // behind it share one line rather than each owning a slot in a layout that no
  // longer has slots.
  const rowStatus = [nameStatus, regionStatus, addressStatus].find(
    (line) => line && line !== t.account.saved,
  );

  const [channel, setChannel] = useState<ContactChannel>(ContactChannel.Email);
  const [value, setValue] = useState('');
  // The dial code is a control, not a prefix baked into the field: the phone's
  // region is a guess, wrong for anyone whose language is English (US) while
  // they sit in India. The field holds the local digits; this holds the country.
  const [phoneCountry, setPhoneCountry] = useState<string>(
    profile?.country_code ?? deviceCountry() ?? 'IN',
  );
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const existing =
    channel === ContactChannel.Email
      ? (session?.user.email ?? null)
      : (session?.user.phone ?? null);

  // A stable subtitle for the identity header: the account's own contact,
  // independent of which channel the form below is currently pointed at, so it
  // does not flip as the chips are toggled. Purely a label.
  const accountContact = session?.user.email ?? session?.user.phone ?? null;

  // The portrait's photo. A Google/Apple sign-in carries a photo in the
  // session's user metadata, but the profile row only holds one if a trigger
  // copied it across — older accounts have a null `avatar_url` and so showed
  // initials here. Fall back to the provider photo (an https URL that resolves
  // straight through) so the header shows the real face whether or not the
  // column was ever filled. `||`, not `??`: an empty-string avatar (a cleared
  // column, or a provider that sends '') is "no photo", so it must fall through
  // to the next source rather than be handed on as a blank URL. This mirrors the
  // derivation on (tabs)/profile deliberately — kept local so this screen does
  // not depend on that one (a separate change is in flight there).
  const oauthAvatar =
    (session?.user?.user_metadata?.avatar_url as string | undefined) ||
    (session?.user?.user_metadata?.picture as string | undefined) ||
    null;
  const avatarUrl = profile?.avatar_url || oauthAvatar;

  // The name shown in the header portrait, never blank — the same "You"
  // fallback the save path already uses, so the header agrees with the row.
  const displayName = name.trim() || t.account.you;

  // Which providers already sign this account in, so a linked one shows as done
  // rather than offering to link what is already linked. Adding one goes through
  // the same `withGoogle`/`withApple` the sign-in screen uses: for somebody
  // already signed in, `planAuth` turns that into a link, never a fresh sign-in
  // that would strand this account (ADR-006).
  const linkedProviders = new Set(
    (session?.user.identities ?? []).map((identity) => identity.provider),
  );

  const link = async (start: () => Promise<void>): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await start();
      await refresh();
    } catch (thrown) {
      // Already somebody's login: offer the switch instead of an error.
      const caught = await resolveIdentityTaken(thrown);
      if (caught !== null) setError(friendlyError(caught, t.couldNotSave, 'account.link'));
    } finally {
      setBusy(false);
    }
  };

  const saveName = async (next: string): Promise<void> => {
    setNameStatus(null);
    setRowSaving(true);
    try {
      // Only the name. The empty name falls back to "You" so nobody is nameless.
      await updateProfile({ display_name: next.trim() || t.account.you });
      setName(next.trim());
      setNameStatus(t.account.saved);
      // Closed only once the write landed: a sheet that shuts on tap and fails
      // behind the person's back is how a name silently does not change.
      setEditing(null);
    } catch (caught) {
      setNameStatus(friendlyError(caught, t.couldNotSave, 'account.saveName'));
    } finally {
      setRowSaving(false);
    }
  };

  // Picking a country saves it and, with it, the currency it implies — the one
  // decision the field exists to make. Serialised: a save in flight blocks a
  // second pick, so a slow first response can never land after and overwrite a
  // newer choice, and a failed save puts the row back to the country that is
  // actually stored rather than leaving an unsaved one selected.
  const countrySaving = useRef(false);
  const saveCountry = async (next: string | null): Promise<void> => {
    if (countrySaving.current) return;
    const prior = country;
    countrySaving.current = true;
    setCountry(next);
    setRegionStatus(null);
    try {
      await updateProfile({
        country_code: next,
        default_currency: currencyForCountry(next) ?? profile?.default_currency ?? 'INR',
      });
      setRegionStatus(t.account.saved);
    } catch (caught) {
      setCountry(prior);
      setRegionStatus(friendlyError(caught, t.couldNotSave, 'account.saveCountry'));
    } finally {
      countrySaving.current = false;
    }
  };

  const saveAddress = async (next: string): Promise<void> => {
    setAddressStatus(null);
    setRowSaving(true);
    try {
      // Empty clears it to null rather than storing a blank string.
      await updateProfile({ address: next.trim() || null });
      setAddress(next.trim());
      setAddressStatus(t.account.saved);
      setEditing(null);
    } catch (caught) {
      setAddressStatus(friendlyError(caught, t.couldNotSave, 'account.saveAddress'));
    } finally {
      setRowSaving(false);
    }
  };

  // One normalised form is validated, sent and confirmed, so the code always
  // goes to the address the confirmation is checked against. For a phone that is
  // the picked country's dial code plus the local digits typed in the field.
  const dialCode = dialingCodeForCountry(phoneCountry) ?? '';
  const normalised =
    channel === ContactChannel.Email ? value.trim() : `${dialCode}${value.replace(/[^\d]/g, '')}`;

  const looksValid =
    channel === ContactChannel.Email
      ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)
      : /^\+?[0-9]{8,15}$/.test(normalised);

  const send = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await startAddingContact(channel, normalised);
      setSent(true);
    } catch (caught) {
      setError(friendlyError(caught, t.couldNotSave, 'account.sendContact'));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await confirmContact(channel, normalised, code);
      await refresh();
      setDone(true);
      setSent(false);
      setCode('');
    } catch (caught) {
      setError(friendlyError(caught, t.couldNotSave, 'account.confirmContact'));
    } finally {
      setBusy(false);
    }
  };

  const dark = theme.scheme === 'dark';
  const ink = dark ? theme.color.text : SPEC_INK;
  const muted = dark ? theme.color.textMuted : SPEC_MUTED;
  const accent = dark ? theme.color.brand : SPEC_ACCENT;
  const inputStyle = {
    fontSize: 15,
    color: ink,
    backgroundColor: dark ? theme.color.surfaceMuted : '#F3F2F9',
    borderRadius: 22,
    paddingHorizontal: theme.spacing.md,
    height: 44,
  };
  const actionLabel = sent
    ? t.contact.confirm
    : channel === ContactChannel.Email
      ? t.contact.sendCodeEmail
      : t.contact.sendCodePhone;
  const actionDisabled = busy || (sent ? code.trim().length < 6 : !looksValid);

  return (
    <Screen>
      {/* Two faint lavender washes behind the portrait, as on the mockup. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
        <View
          style={{
            position: 'absolute',
            top: 90,
            left: -80,
            width: 200,
            height: 220,
            borderRadius: 110,
            backgroundColor: dark ? 'rgba(140,131,255,0.06)' : '#ECE9FB',
            opacity: 0.8,
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: 110,
            right: -90,
            width: 200,
            height: 220,
            borderRadius: 110,
            backgroundColor: dark ? 'rgba(120,170,255,0.05)' : '#E8EEFC',
            opacity: 0.8,
          }}
        />
      </View>

      <Row
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
          alignItems: 'center',
          gap: theme.spacing.xs,
        }}
      >
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons name={directionalIcon('chevron-back')} size={iconSize.lg} color={ink} />
        </IconButton>
        <Text style={{ flex: 1, fontSize: 21, lineHeight: 27, fontWeight: '800', color: ink }}>
          {t.contact.title}
        </Text>
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Who this account is. The portrait carries the camera badge and opens
            the same sheet the Settings portrait does (`useAvatarEditor`), so
            there is one behaviour and not two that drift. */}
        <View style={{ alignItems: 'center', gap: 2 }}>
          <ProfileAvatar
            name={displayName}
            avatarUrl={avatarUrl}
            size={84}
            onPress={photo.open}
            busy={photo.busy}
            lightBadge
          />
          <Row style={{ gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
            <Text style={{ fontSize: 19, fontWeight: '800', color: ink }}>{displayName}</Text>
            {/* Held back for the untouched "Guest" name, where it would only
                repeat it and read as a bug. */}
            {isGuest && displayName !== 'Guest' ? <Badge label={t.common.guest} /> : null}
          </Row>
          {accountContact ? (
            <Text style={{ fontSize: 13, color: muted }}>{accountContact}</Text>
          ) : null}
          {photo.status ? (
            <Text variant="caption" tone="negative">
              {photo.status}
            </Text>
          ) : null}
        </View>

        {/* What you have set, as label-and-value rows you can read at a glance;
            each opens a focused editor. Currency has no press: it follows the
            country and is shown because people look for it. */}
        <SoftCard style={{ paddingVertical: 0, paddingBottom: 4, gap: 0 }}>
          <Row
            style={{
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingTop: 12,
              paddingBottom: 10,
            }}
          >
            <Text
              accessibilityRole="header"
              style={{ fontSize: 16, fontWeight: '800', color: ink }}
            >
              {t.contact.personalDetails}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t.common.edit} ${t.account.displayName}`}
              onPress={() => setEditing('name')}
              hitSlop={6}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 14,
                backgroundColor: theme.color.brandSoft,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name="pencil" size={13} color={accent} />
              <Text style={{ fontSize: 13, fontWeight: '600', color: accent }}>
                {t.common.edit}
              </Text>
            </Pressable>
          </Row>
          <View
            style={{
              height: 1,
              backgroundColor: theme.color.border,
              marginHorizontal: -theme.spacing.md,
            }}
          />
          <DetailRow
            icon="person-outline"
            tint={theme.tint.lilac}
            label={t.account.displayName}
            sub={name.trim() || t.common.yourName}
            onPress={() => setEditing('name')}
          />
          <Divider />
          <DetailRow
            icon="location-outline"
            tint={dark ? theme.tint.mint : { bg: '#E3F5EC', ink: '#2E9E6A' }}
            label={t.pickers.country}
            value={
              country
                ? `${countryFlag(country) ?? ''} ${countryName(country) ?? country}`.trim()
                : t.account.countryRequired
            }
            onPress={() => {
              requestCountry({
                initial: country,
                onPicked: (next: string | null) => void saveCountry(next),
              });
              router.push('/country');
            }}
          />
          <Divider />
          <DetailRow
            icon="cash-outline"
            tint={theme.tint.sky}
            label={t.account.currencyLabel}
            sub={t.account.currencyFromCountry}
            value={`${currencySymbol(currency)} ${currency}`}
          />
          <Divider />
          <DetailRow
            icon="home-outline"
            tint={theme.tint.peach}
            label={t.account.addressTitle}
            sub={address.trim() || t.account.addressOptional}
            onPress={() => setEditing('address')}
          />
        </SoftCard>

        {/* One line of bad news for the rows above. Silent when a save worked:
            the row already shows the new value. */}
        {rowStatus ? (
          <Text variant="caption" tone="negative">
            {rowStatus}
          </Text>
        ) : null}

        {/* The limit that sent them here is the reason for the visit, so it
            stays; the guest reassurance can be closed for good. */}
        {gateBody ? (
          <Callout tone="info" title={t.contact.gateTitle}>
            {gateBody}
          </Callout>
        ) : isGuest ? (
          <DismissibleCallout name="account.guestReassurance" tone="info">
            {t.contact.guestBody}
          </DismissibleCallout>
        ) : null}

        <View style={{ marginTop: theme.spacing.xs, paddingHorizontal: 4 }}>
          <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '800', color: ink }}>
            {t.contact.securityTitle}
          </Text>
          <Text style={{ fontSize: 13, color: muted }}>{t.contact.securitySub}</Text>
        </View>

        {/* An email or phone — either signs you back in on another phone. */}
        <SoftCard>
          <Row style={{ gap: 12, alignItems: 'center' }}>
            <Disc
              icon={channel === ContactChannel.Email ? 'mail-outline' : 'call-outline'}
              tint={theme.tint.lilac}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: ink }}>
                {channel === ContactChannel.Email ? t.contact.email : t.contact.phone}
              </Text>
              <Text numberOfLines={1} style={{ fontSize: 13, color: muted }}>
                {existing
                  ? t.contact.alreadyAdded.replace('{value}', existing)
                  : channel === ContactChannel.Email
                    ? t.contact.emailAddress
                    : t.contact.phoneNumber}
              </Text>
            </View>
          </Row>

          {/* Phone only where the build can prove one: the code comes from a
              native module, so an older binary would leave the chip dead. */}
          {phoneSignInAvailable() ? (
            <ChipRow<ContactChannel>
              value={channel}
              onChange={(next) => {
                // Not mid-request: switching the target while a code is in
                // flight would check it against a different address.
                if (busy) return;
                setChannel(next);
                setSent(false);
                setDone(false);
                setError(null);
                setValue('');
              }}
              options={[
                { value: ContactChannel.Email, label: t.contact.email },
                { value: ContactChannel.Phone, label: t.contact.phone },
              ]}
            />
          ) : null}

          {sent ? (
            <View style={{ gap: theme.spacing.xs }}>
              <Text style={{ fontSize: 12, color: muted }}>
                {channel === ContactChannel.Email ? t.contact.codeEmailed : t.contact.codeTexted}
              </Text>
              <Row style={{ gap: theme.spacing.sm }}>
                <TextInput
                  value={code}
                  onChangeText={setCode}
                  editable={!busy}
                  keyboardType="number-pad"
                  maxLength={6}
                  // The code has just arrived — let the OS offer the one-tap
                  // fill: `sms-otp` on Android, `oneTimeCode` on iOS.
                  autoComplete="sms-otp"
                  textContentType="oneTimeCode"
                  accessibilityLabel={t.contact.verificationCode}
                  placeholder="123456"
                  placeholderTextColor={theme.color.textFaint}
                  style={[inputStyle, { flex: 1, fontWeight: '700', letterSpacing: 4 }]}
                />
                <PillButton
                  label={actionLabel}
                  disabled={actionDisabled}
                  busy={busy}
                  onPress={() => void confirm()}
                />
              </Row>
              <Button
                label={t.contact.useDifferent}
                variant="ghost"
                size="sm"
                onPress={() => setSent(false)}
              />
            </View>
          ) : channel === ContactChannel.Email ? (
            <Row style={{ gap: theme.spacing.sm }}>
              <TextInput
                value={value}
                onChangeText={(next) => {
                  setValue(next);
                  setSent(false);
                  setDone(false);
                }}
                editable={!busy}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                accessibilityLabel={t.contact.emailAddress}
                placeholder={t.contact.emailPlaceholder}
                placeholderTextColor={theme.color.textFaint}
                style={[inputStyle, { flex: 1 }]}
              />
              <PillButton
                label={actionLabel}
                disabled={actionDisabled}
                busy={busy}
                onPress={() => void send()}
              />
            </Row>
          ) : (
            // The dial code is its own control; the field beside it holds only
            // local digits.
            <View style={{ gap: theme.spacing.sm }}>
              <Row style={{ gap: theme.spacing.sm, alignItems: 'stretch' }}>
                <CountryCodePicker
                  code={phoneCountry}
                  onChange={(next) => {
                    // A new dial code is a new number: any code already sent no
                    // longer matches. Never mid-request.
                    if (busy) return;
                    setPhoneCountry(next);
                    setSent(false);
                    setDone(false);
                    setError(null);
                    setCode('');
                  }}
                />
                <TextInput
                  value={value}
                  onChangeText={(next) => {
                    setValue(next);
                    setSent(false);
                    setDone(false);
                  }}
                  editable={!busy}
                  autoComplete="tel"
                  keyboardType="phone-pad"
                  accessibilityLabel={t.contact.phoneNumber}
                  placeholder={t.contact.phonePlaceholder.replace('{code}', '').trim()}
                  placeholderTextColor={theme.color.textFaint}
                  style={[inputStyle, { flex: 1 }]}
                />
              </Row>
              <PillButton
                label={actionLabel}
                disabled={actionDisabled}
                busy={busy}
                onPress={() => void send()}
              />
            </View>
          )}

          {done ? (
            <Text variant="caption" tone="positive">
              {t.contact.added}
            </Text>
          ) : null}
          {error ? <Callout tone="negative">{error}</Callout> : null}
        </SoftCard>

        {/* Linking a social account, so it can sign this same account in later
            on another phone. Apple is offered on Android too, as the sign-in
            screen does; Apple leads on iOS, per its guidelines. */}
        <SoftCard>
          <Row style={{ gap: 12, alignItems: 'flex-start' }}>
            <Disc icon="link-outline" tint={theme.tint.lilac} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: ink }}>
                {t.contact.linkedAccounts}
              </Text>
              <Text style={{ fontSize: 13, lineHeight: 18, color: muted }}>
                {t.contact.signInMethodsBody}
              </Text>
              <View style={{ marginTop: theme.spacing.xs }}>
                {(Platform.OS === 'ios' ? PROVIDERS_APPLE_FIRST : PROVIDERS_GOOGLE_FIRST).map(
                  (provider, index) => (
                    <View key={provider.id}>
                      {index > 0 ? <Divider /> : null}
                      <ProviderRow
                        name={provider.name}
                        icon={provider.icon}
                        linked={linkedProviders.has(provider.id)}
                        busy={busy}
                        linkLabel={t.contact.link}
                        linkA11yLabel={t.contact.linkProvider.replace('{provider}', provider.name)}
                        linkedLabel={t.contact.linked}
                        onLink={() => void link(provider.id === 'apple' ? withApple : withGoogle)}
                      />
                    </View>
                  ),
                )}
              </View>
            </View>
          </Row>
        </SoftCard>

        <Row
          style={{
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 14,
            backgroundColor: dark ? theme.color.surfaceMuted : '#EEECF7',
          }}
        >
          <Ionicons name="shield-checkmark-outline" size={20} color={accent} />
          <Text style={{ flex: 1, fontSize: 12, lineHeight: 17, color: muted }}>
            {t.contact.footnote}
          </Text>
        </Row>
      </ScrollView>

      {/* The editors, over the list. Outside the ScrollView so a sheet is
          anchored to the screen, and the keyboard it raises does not push the
          list it came from. */}
      <EditTextSheet
        visible={editing === 'name'}
        title={t.account.displayName}
        hint={t.account.displayNameHint}
        value={name}
        placeholder={t.common.yourName}
        saving={rowSaving}
        onSave={(next) => void saveName(next)}
        onClose={() => setEditing(null)}
      />
      <EditTextSheet
        visible={editing === 'address'}
        title={t.account.addressTitle}
        hint={t.account.addressHint}
        value={address}
        placeholder={t.account.addressPlaceholder}
        multiline
        autoCapitalize="sentences"
        saving={rowSaving}
        onSave={(next) => void saveAddress(next)}
        onClose={() => setEditing(null)}
      />
    </Screen>
  );
}

type IconName = keyof typeof Ionicons.glyphMap;

/** A white card with the redesign's soft corners and lift. */
function SoftCard({ children, style }: { children: ReactNode; style?: object }) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.color.surface,
          borderRadius: 20,
          padding: theme.spacing.md,
          gap: theme.spacing.md,
          shadowColor: '#2A1E6B',
          shadowOpacity: theme.scheme === 'dark' ? 0 : 0.06,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** A glyph on its own pastel disc. */
function Disc({ icon, tint }: { icon: IconName; tint: { bg: string; ink: string } }) {
  return (
    <View
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tint.bg,
      }}
    >
      <Ionicons name={icon} size={17} color={tint.ink} />
    </View>
  );
}

/** A violet pill for the form's one action, with a spinner while it runs. */
function PillButton({
  label,
  disabled,
  busy,
  onPress,
}: {
  label: string;
  disabled: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const accent = theme.scheme === 'dark' ? theme.color.brand : SPEC_ACCENT;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 44,
        paddingHorizontal: theme.spacing.lg,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: accent,
        opacity: disabled && !busy ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator size="small" color="#FFFFFF" />
      ) : (
        <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>{label}</Text>
      )}
    </Pressable>
  );
}

/**
 * One of your details: its glyph on a pastel disc, the label over its value or
 * hint, the value (if short) on the right, and a chevron when it opens an
 * editor. A row with no `onPress` is read-only and draws no chevron.
 */
function DetailRow({
  icon,
  tint,
  label,
  sub,
  value,
  onPress,
}: {
  icon: IconName;
  tint: { bg: string; ink: string };
  label: string;
  sub?: string;
  value?: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const ink = dark ? theme.color.text : SPEC_INK;
  const muted = dark ? theme.color.textMuted : SPEC_MUTED;
  const body = (
    <Row style={{ gap: 12, paddingVertical: 8, alignItems: 'center' }}>
      <Disc icon={icon} tint={tint} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: ink }}>{label}</Text>
        {sub ? (
          <Text numberOfLines={1} style={{ fontSize: 13, color: muted }}>
            {sub}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text numberOfLines={1} style={{ maxWidth: '45%', fontSize: 14, color: muted }}>
          {value}
        </Text>
      ) : null}
      {onPress ? (
        <Ionicons name={directionalIcon('chevron-forward')} size={16} color={muted} />
      ) : null}
    </Row>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[label, value ?? sub].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {body}
    </Pressable>
  );
}

/**
 * The identity providers this screen can attach, as data rather than repeated
 * markup. `id` is the provider string Supabase stores on `user.identities`, so
 * it is what decides whether a row is already linked — it must stay spelled the
 * way the server spells it. Brand names are not translated.
 */
const PROVIDER_GOOGLE = { id: 'google', name: 'Google', icon: 'logo-google' } as const;
const PROVIDER_APPLE = { id: 'apple', name: 'Apple', icon: 'logo-apple' } as const;
const PROVIDERS_APPLE_FIRST = [PROVIDER_APPLE, PROVIDER_GOOGLE];
const PROVIDERS_GOOGLE_FIRST = [PROVIDER_GOOGLE, PROVIDER_APPLE];

/**
 * One provider in the linked-accounts list: its mark, its name, and either a
 * green Linked pill or a small button to link it.
 */
function ProviderRow({
  name,
  icon,
  linked,
  busy,
  linkLabel,
  linkA11yLabel,
  linkedLabel,
  onLink,
}: {
  name: string;
  icon: 'logo-google' | 'logo-apple';
  linked: boolean;
  busy: boolean;
  linkLabel: string;
  /** Names the provider aloud, because the visible pill only says "Link". */
  linkA11yLabel: string;
  linkedLabel: string;
  onLink: () => void;
}) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  return (
    <Row style={{ gap: 12, paddingVertical: 10, alignItems: 'center' }}>
      <Ionicons
        name={icon}
        size={20}
        color={icon === 'logo-google' ? '#4285F4' : dark ? theme.color.text : '#000000'}
      />
      <Text style={{ flex: 1, fontSize: 15, color: dark ? theme.color.text : SPEC_INK }}>
        {name}
      </Text>
      {linked ? (
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 3,
            borderRadius: 12,
            backgroundColor: theme.color.positiveSoft,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: '600', color: theme.color.positive }}>
            {linkedLabel}
          </Text>
        </View>
      ) : (
        <Button
          label={linkLabel}
          accessibilityLabel={linkA11yLabel}
          size="sm"
          variant="secondary"
          disabled={busy}
          // hitSlop lifts the target over the 44 floor without enlarging the pill.
          hitSlop={8}
          onPress={onLink}
        />
      )}
    </Row>
  );
}
