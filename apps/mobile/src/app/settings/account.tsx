/**
 * Adding your details, whenever you feel like it (ADR-006).
 *
 * Waves asks for nothing to get started, so this screen exists for the moment
 * someone decides they want the account to outlive the phone. It attaches an
 * email or a phone number to the account they already have — it does not make
 * a new one, so everything entered as a guest comes with them.
 */

import { useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Platform, ScrollView, TextInput, View } from 'react-native';

import {
  Badge,
  Button,
  Callout,
  Card,
  ChipRow,
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

import {
  countryFlag,
  countryName,
  currencyForCountry,
  currencySymbol,
  dialingCodeForCountry,
} from '@waves/core';

import { CountryCodePicker } from '@/components/CountryCodePicker';
import { EditTextSheet } from '@/components/EditTextSheet';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { SettingsSection } from '@/components/SettingsSection';
import { useAvatarEditor } from '@/lib/avatarEditor';
import { requestCountry } from '@/lib/countryPickerBridge';
import { friendlyError } from '@/lib/errors';
import { confirmContact, startAddingContact, ContactChannel } from '@/data/api';
import { deviceCountry, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { router } from '@/lib/navigation';
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
    } catch (caught) {
      setError(friendlyError(caught, t.couldNotSave, 'account.link'));
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

  // Every text field on this screen wears the same skin — a filled, rounded
  // surface you can see and aim at — so a field never reads as static text and
  // the phone number sits flush against the dial-code chip beside it.
  const fieldStyle = {
    fontSize: 17,
    fontWeight: '600' as const,
    color: theme.color.text,
    backgroundColor: theme.color.surfaceMuted,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  };

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

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading">{t.contact.title}</Text>
        </View>
        <View style={{ width: 44 }} />
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
          paddingTop: theme.spacing.lg,
          gap: theme.spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Who this account is, and the one control the header carries.
            
            The portrait is tappable now. Every edit-profile screen worth
            copying makes it so — Beli, Lyft, BeReal, Binance, Instagram,
            Shopee all put a camera badge on the avatar right here — and the
            reason is simply that this is where somebody looks for it. It opens
            the same sheet the Settings portrait does (`useAvatarEditor`), so
            there is one behaviour and not two that drift. */}
        <View
          style={{
            alignItems: 'center',
            gap: theme.spacing.md,
            paddingTop: theme.spacing.sm,
          }}
        >
          <ProfileAvatar
            name={displayName}
            avatarUrl={avatarUrl}
            size={96}
            onPress={photo.open}
            busy={photo.busy}
          />
          <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            <Row style={{ gap: theme.spacing.sm }}>
              <Text variant="title">{displayName}</Text>
              {/* The badge says the account has no email or phone on it. When
                  somebody has not renamed themselves it repeats the name they
                  were given, which reads as a bug rather than a fact — so it is
                  held back for the untouched "Guest" name. */}
              {isGuest && displayName !== 'Guest' ? <Badge label={t.common.guest} /> : null}
            </Row>
            {accountContact ? (
              <Text variant="caption" tone="muted">
                {accountContact}
              </Text>
            ) : null}
            {photo.status ? (
              <Text variant="caption" tone="negative">
                {photo.status}
              </Text>
            ) : null}
          </View>
        </View>

        {/* What you have set, as a list you can read rather than a stack of
            forms you have to scroll.

            This was four cards, each holding one text field and a Save button
            that appeared when it was dirty, under a label of its own — so the
            page was mostly the space between things, and you could not see what
            your details *were* without reading four inputs. Every edit-profile
            screen on the reference boards is a dense list of label-and-value
            rows instead, and the value is the point: "Name · Madan" answers the
            question the screen is open for, at a glance.

            The rows are the same component Settings uses (`SettingsSection`),
            which is the other half of the ask — two lists one tap apart should
            not be two designs. Each one opens a focused editor: a sheet for the
            free text, the existing picker for the country.

            Currency is the exception and has no press: it is derived from the
            country above it and is shown because people look for it, not
            because it can be set. */}
        <SettingsSection
          title={t.account.detailsTitle}
          rows={[
            {
              icon: 'person-outline',
              label: t.account.displayName,
              value: name.trim() || t.common.yourName,
              valueMuted: !name.trim(),
              onPress: () => setEditing('name'),
            },
            {
              icon: 'location-outline',
              label: t.pickers.country,
              value: country
                ? `${countryFlag(country) ?? ''} ${countryName(country) ?? country}`.trim()
                : t.account.countryRequired,
              valueMuted: !country,
              onPress: () => {
                requestCountry({
                  initial: country,
                  onPicked: (next: string | null) => void saveCountry(next),
                });
                router.push('/country');
              },
            },
            {
              icon: 'cash-outline',
              label: t.account.currencyLabel,
              hint: t.account.currencyFromCountry,
              value: `${currencySymbol(currency)} ${currency}`,
            },
            {
              icon: 'home-outline',
              label: t.account.addressTitle,
              value: address.trim() || t.account.addressOptional,
              valueMuted: !address.trim(),
              onPress: () => setEditing('address'),
            },
          ]}
        />

        {/* One line of bad news for the rows above, which have no room for their
            own. Silent when a save worked: the row already shows the new value,
            and a "Saved" that has to be dismissed is a second thing to read. */}
        {rowStatus ? (
          <Text variant="caption" tone="negative">
            {rowStatus}
          </Text>
        ) : null}

        {/* The signed-in reassurance is gone: for a member it said nothing they
            did not already know. A guest, or somebody sent here by a limit, gets
            the one message that is actually actionable — as a Callout, the app's
            canonical shape for "read this". */}
        {isGuest || gateBody ? (
          <Callout tone="info" title={gateBody ? t.contact.gateTitle : undefined}>
            {gateBody ?? t.contact.guestBody}
          </Callout>
        ) : null}

        <View style={{ gap: theme.spacing.md }}>
          <GroupLabel icon="log-in-outline" title={t.contact.signInMethodsTitle} />
          {/* An email or phone, or a linked account — any of them signs you back
              in on another phone. */}
          <Card style={{ gap: theme.spacing.lg }}>
            <ChipRow<ContactChannel>
              value={channel}
              onChange={(next) => {
                // Not mid-request: switching the target while a code is in flight
                // would have confirm() check the code against a different address
                // than it was sent to.
                if (busy) return;
                setChannel(next);
                setSent(false);
                setDone(false);
                setError(null);
                setValue('');
              }}
              // Phone only where the build can prove one. The code comes from
              // Firebase, which is a native module, so a JavaScript-only update
              // onto an older binary would leave this chip selectable and the
              // "send code" under it dead — an offer the app cannot keep.
              options={
                phoneSignInAvailable()
                  ? [
                      { value: ContactChannel.Email, label: t.contact.email },
                      { value: ContactChannel.Phone, label: t.contact.phone },
                    ]
                  : [{ value: ContactChannel.Email, label: t.contact.email }]
              }
            />

            {existing ? (
              <Text variant="caption" tone="positive">
                {t.contact.alreadyAdded.replace('{value}', existing)}
              </Text>
            ) : null}

            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="caption" tone="muted">
                {channel === ContactChannel.Email ? t.contact.emailAddress : t.contact.phoneNumber}
              </Text>
              {channel === ContactChannel.Email ? (
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
                  style={fieldStyle}
                />
              ) : (
                // The dial code is its own control; the field beside it holds
                // only local digits. This is the country-code picker the phone
                // flow was missing.
                <Row style={{ gap: theme.spacing.sm, alignItems: 'stretch' }}>
                  <CountryCodePicker
                    code={phoneCountry}
                    onChange={(next) => {
                      // Changing the dial code changes the number, so any code
                      // already sent no longer matches — drop back to sending.
                      // And never mid-request, for the same reason the channel
                      // switch is guarded.
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
                    style={[fieldStyle, { flex: 1 }]}
                  />
                </Row>
              )}
            </View>

            {sent ? (
              <View style={{ gap: theme.spacing.xs }}>
                <Text variant="caption" tone="muted">
                  {channel === ContactChannel.Email ? t.contact.codeEmailed : t.contact.codeTexted}
                </Text>
                <TextInput
                  value={code}
                  onChangeText={setCode}
                  editable={!busy}
                  keyboardType="number-pad"
                  maxLength={6}
                  // The code has just arrived by SMS or email — let the OS offer
                  // the one-tap fill rather than making it be retyped by hand.
                  // `sms-otp` is Android's autofill hint; `oneTimeCode` is iOS's.
                  autoComplete="sms-otp"
                  textContentType="oneTimeCode"
                  accessibilityLabel={t.contact.verificationCode}
                  placeholder="123456"
                  placeholderTextColor={theme.color.textFaint}
                  style={[fieldStyle, { fontSize: 24, fontWeight: '700', letterSpacing: 6 }]}
                />
              </View>
            ) : null}

            {busy ? <ActivityIndicator color={theme.color.brand} /> : null}

            <Button
              label={
                sent
                  ? t.contact.confirm
                  : channel === ContactChannel.Email
                    ? t.contact.sendCodeEmail
                    : t.contact.sendCodePhone
              }
              size="lg"
              fullWidth
              disabled={busy || (sent ? code.trim().length < 6 : !looksValid)}
              onPress={() => void (sent ? confirm() : send())}
            />

            {sent ? (
              <Button
                label={t.contact.useDifferent}
                variant="ghost"
                onPress={() => setSent(false)}
              />
            ) : null}

            {done ? (
              <Text variant="caption" tone="positive">
                {t.contact.added}
              </Text>
            ) : null}
            {error ? <Callout tone="negative">{error}</Callout> : null}
          </Card>

          {/* Linking a social account, so it can sign this same account in later
              on another phone — the OAuth complement to the email/phone above.
              Under the same heading, because it is another way into the same
              account.

              Apple is offered on Android too, exactly as the sign-in screen
              offers it: `withApple` only reaches the native sheet for a fresh
              sign-in on iOS, and a link is always the browser round trip, so
              there is nothing platform-specific to hide here. The order follows
              the sign-in screen's — Apple first on iOS, where its guidelines
              want it at least as prominent as its neighbours. */}
          <Card style={{ gap: theme.spacing.md }}>
            <Text variant="caption" tone="muted">
              {t.contact.signInMethodsBody}
            </Text>
            <View style={{ gap: theme.spacing.md }}>
              {(Platform.OS === 'ios' ? PROVIDERS_APPLE_FIRST : PROVIDERS_GOOGLE_FIRST).map(
                (provider) => (
                  <ProviderRow
                    key={provider.id}
                    name={provider.name}
                    icon={provider.icon}
                    linked={linkedProviders.has(provider.id)}
                    busy={busy}
                    linkLabel={t.contact.link}
                    linkA11yLabel={t.contact.linkProvider.replace('{provider}', provider.name)}
                    linkedLabel={t.contact.linked}
                    onLink={() => void link(provider.id === 'apple' ? withApple : withGoogle)}
                  />
                ),
              )}
            </View>
          </Card>
        </View>

        <Text variant="micro" tone="muted" align="center">
          {t.contact.footnote}
        </Text>
      </ScrollView>

      {/* The editors, over the list. Outside the ScrollView so a sheet is
          anchored to the screen rather than to a scroll position, and so the
          keyboard it raises does not push the list it came from. */}
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

/**
 * A section label in the settings grammar: a leading glyph in a soft brand
 * circle beside the heading, matching the rows on (tabs)/profile so this screen
 * reads as one of the settings family rather than a bespoke form. It replaces
 * the bare `SectionHeader` here — the icon gives each grouped card a fast,
 * scannable anchor (Mobbin — Me+, Vivino: grouped rows led by an icon). No
 * chevron: every group below is edited in place, so there is nowhere to go.
 */
function GroupLabel({ icon, title }: { icon: keyof typeof Ionicons.glyphMap; title: string }) {
  const theme = useTheme();
  return (
    <Row style={{ gap: theme.spacing.md, marginBottom: theme.spacing.xs }}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: theme.radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.brandSoft,
        }}
      >
        <Ionicons name={icon} size={iconSize.md} color={theme.color.brand} />
      </View>
      {/* Marked as a header so a screen reader's heading navigation can still
          jump between sections, exactly as the `SectionHeader` it replaced did. */}
      <Text variant="heading" accessibilityRole="header">
        {title}
      </Text>
    </Row>
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
 * One provider in the "ways to sign in" list: its mark, its name, and either a
 * Linked badge or a button to link it. Icon-and-name so the row reads at a
 * glance; the action says exactly what it does.
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
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <Row style={{ gap: theme.spacing.md }}>
        <Ionicons name={icon} size={iconSize.xl} color={theme.color.text} />
        <Text variant="body">{name}</Text>
      </Row>
      {linked ? (
        <Badge label={linkedLabel} tone="positive" />
      ) : (
        <Button
          label={linkLabel}
          accessibilityLabel={linkA11yLabel}
          size="sm"
          variant="secondary"
          disabled={busy}
          // 38pt on its own — hitSlop lifts the target over the 44 floor
          // without enlarging the small trailing pill.
          hitSlop={8}
          onPress={onLink}
        />
      )}
    </Row>
  );
}
