/**
 * "Company logo": upload from the gallery or camera, or paste a link the phone
 * downloads itself (no server fetch). Optional and admin-only; the caller decides
 * what a picked image does (stage it on the create screen, upload it in settings).
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import { Text, iconSize, useTheme } from '@waves/ui';

import { GroupPhoto } from '@/components/GroupPhoto';
import { useStrings } from '@/i18n';
import { logoFromBytes, pickLogo, type PhotoSource, type PickedImage } from '@/lib/image';
import { downloadLogo, parseLogoUrl, type LogoLinkError } from '@/lib/logoLink';

export function logoErrorText(
  t: ReturnType<typeof useStrings>['t'],
  error: LogoLinkError | 'decode',
): string {
  const c = t.company;
  switch (error) {
    case 'empty':
      return c.logoErrEmpty;
    case 'invalid':
      return c.logoErrInvalid;
    case 'not_https':
      return c.logoErrNotHttps;
    case 'blocked_host':
      return c.logoErrBlocked;
    case 'timeout':
      return c.logoErrTimeout;
    case 'network':
      return c.logoErrNetwork;
    case 'http':
      return c.logoErrHttp;
    case 'svg':
      return c.logoErrSvg;
    case 'too_large':
      return c.logoErrTooLarge;
    case 'too_many_redirects':
      return c.logoErrRedirects;
    case 'decode':
      return c.logoErrDecode;
    default:
      return c.logoErrNotImage;
  }
}

interface Props {
  /** The stored logo, if any. */
  photoPath?: string | null;
  /** A staged pick not yet uploaded (create screen). */
  stagedUri?: string | null;
  emoji?: string | null;
  busy?: boolean;
  /** Return an error message to show inline, or null when it worked. */
  onImage: (image: PickedImage) => Promise<string | null> | string | null;
  onRemove?: () => void;
}

export function CompanyLogoField({
  photoPath,
  stagedUri,
  emoji,
  busy = false,
  onImage,
  onRemove,
}: Props) {
  const theme = useTheme();
  const { t } = useStrings();
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const has = Boolean(photoPath || stagedUri);
  const loading = busy || working;

  const run = async (get: () => Promise<PickedImage | string | null>): Promise<void> => {
    setError(null);
    setWorking(true);
    try {
      const got = await get();
      if (got === null) return;
      if (typeof got === 'string') return setError(got);
      const message = await onImage(got);
      if (message) setError(message);
      else {
        setLinkOpen(false);
        setLink('');
      }
    } finally {
      setWorking(false);
    }
  };

  const fromLink = (): Promise<void> =>
    run(async () => {
      const parsed = parseLogoUrl(link);
      if (!parsed.ok) return logoErrorText(t, parsed.error);
      const got = await downloadLogo(parsed.url);
      if (!got.ok) return logoErrorText(t, got.error);
      return (await logoFromBytes(got.bytes, got.mime)) ?? logoErrorText(t, 'decode');
    });

  const chip = (label: string, icon: keyof typeof Ionicons.glyphMap, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: theme.color.brandSoft,
        opacity: pressed || loading ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.sm} color={theme.color.brand} />
      <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
  const pick = (source: PhotoSource) => () => void run(() => pickLogo(source));

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <GroupPhoto
          photoPath={photoPath}
          localUri={stagedUri}
          emoji={emoji ?? '🏢'}
          size={56}
          busy={loading}
          logo
        />
        <View style={{ flex: 1, gap: 6 }}>
          <Text variant="body" style={{ fontWeight: '700' }}>
            {t.company.logoRow}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {chip(t.company.logoUpload, 'image-outline', pick('library'))}
            {chip(t.company.takePhoto, 'camera-outline', pick('camera'))}
            {chip(t.company.logoLink, 'link-outline', () => setLinkOpen((open) => !open))}
            {has && onRemove ? chip(t.company.logoRemove, 'trash-outline', onRemove) : null}
          </View>
        </View>
      </View>

      {linkOpen ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <TextInput
            value={link}
            onChangeText={(text) => {
              setLink(text);
              setError(null);
            }}
            placeholder={t.company.logoLinkPlaceholder}
            placeholderTextColor={theme.color.textFaint}
            accessibilityLabel={t.company.logoLink}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={() => void fromLink()}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 15,
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: theme.color.border,
              color: theme.color.text,
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.company.logoUse}
            disabled={loading || link.trim().length === 0}
            onPress={() => void fromLink()}
            style={{ opacity: loading || link.trim().length === 0 ? 0.4 : 1 }}
          >
            {working ? (
              <ActivityIndicator color={theme.color.brand} />
            ) : (
              <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '700' }}>
                {t.company.logoUse}
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {error ? (
        <Text variant="caption" style={{ color: theme.color.negative }} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
