import { lazy, Suspense, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { ActivityIndicator, TextInput, View } from 'react-native';

import {
  Button,
  Callout,
  EmptyState,
  IconButton,
  iconSize,
  palette,
  Row,
  Screen,
  Sheet,
  Text,
  useTheme,
} from '@waves/ui';

import { useStrings } from '@/i18n';
import { cameraAvailable, tokenFromScan } from '@/lib/qrScan';

// Only pulled in when the native camera is present — a dynamic import so an
// older binary never even evaluates `expo-camera`.
const ScannerCamera = lazy(() => import('@/components/ScannerCamera'));

/**
 * Point the camera at a group's invite QR and land in the join flow.
 *
 * The scanned code carries the same invite token an invite link does, so a good
 * read just hands off to `/join?token=…` — the one screen that already previews
 * the group and runs the ghost-claim. `from=scan` travels with it so that
 * screen knows a dead link should offer another scan rather than only a way
 * back to the app.
 *
 * The camera is not the only way in, and this route rather than the camera leaf
 * owns the other one. A QR-only screen strands the commonest case there is: the
 * link arrived in a chat on this same phone, so there is no second screen to
 * point a camera at. The paste sheet lives here because it has to keep working
 * on every state where the camera does not — refused permission, a camera that
 * will not start, a binary built before `expo-camera` existed.
 */
export default function ScanScreen() {
  const theme = useTheme();
  const { t } = useStrings();
  const available = cameraAvailable();
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  // Both ways in — the camera and the sheet — end in the same navigation, and
  // either can fire twice: a double tap on "Open invite", or the camera reading
  // a code in the moment before the screen goes. The leaf holds the same guard
  // for its own reads; this one covers both roads at the point they meet.
  const navigated = useRef(false);

  const open = (token: string): void => {
    if (navigated.current) return;
    navigated.current = true;
    router.replace(`/join?token=${encodeURIComponent(token)}&from=scan`);
  };

  /**
   * Offer the clipboard, but only when it is holding one of our links.
   *
   * Reading the clipboard to fill a field is a small liberty, and it is only
   * worth taking when the answer is the thing the person came here to do.
   * Anything else — a password, half an email — is dropped without ever being
   * shown, so the sheet cannot surface clipboard contents that have nothing to
   * do with Waves.
   */
  const openPaste = (): void => {
    // A fresh sheet every time. Reopening onto the rejected text from last time,
    // with the error that explained it already gone, reads as the field having
    // broken rather than as a link that did not work.
    setPasted('');
    setPasteError(null);
    setPasting(true);
    void Clipboard.getStringAsync()
      .then((clip) => {
        if (!clip || !tokenFromScan(clip)) return;
        // Only into a field nobody has touched yet: the read is asynchronous and
        // somebody typing fast can be ahead of it, and their own text wins.
        setPasted((current) => (current === '' ? clip.trim() : current));
      })
      .catch(() => {
        // Some Android builds refuse a clipboard read outright. Offering to fill
        // the field is a courtesy, so failing at it is not worth a word — the
        // field is there to be typed into either way.
      });
  };

  const submitPaste = (): void => {
    const token = tokenFromScan(pasted);
    if (!token) {
      setPasteError(t.misc.scanPasteInvalid);
      return;
    }
    setPasting(false);
    open(token);
  };

  return (
    <>
      {available ? (
        <View style={{ flex: 1, backgroundColor: palette.night900 }}>
          <Suspense
            fallback={
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color={palette.white} />
              </View>
            }
          >
            <ScannerCamera
              onToken={open}
              onClose={() => router.back()}
              onPasteLink={openPaste}
              paused={pasting}
            />
          </Suspense>
        </View>
      ) : (
        // No camera in this build. Nothing here is a camera screen, so it wears
        // the app's ordinary chrome rather than pretending to be a viewfinder —
        // and it still carries the paste route, which works perfectly well
        // without one.
        <Screen edges={['top', 'bottom']}>
          <Row style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
            <IconButton label={t.common.close} onPress={() => router.back()}>
              <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
            </IconButton>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text variant="heading">{t.misc.scanToJoin}</Text>
            </View>
            <View style={{ width: 44 }} />
          </Row>

          <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: theme.spacing.xl }}>
            <EmptyState
              icon={
                <Ionicons name="qr-code-outline" size={iconSize.xxl} color={theme.color.brand} />
              }
              title={t.misc.scanToJoin}
              body={t.misc.scanRebuild}
              action={<Button label={t.misc.scanPasteLink} onPress={openPaste} />}
            />
          </View>
        </Screen>
      )}

      <Sheet visible={pasting} onClose={() => setPasting(false)} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">{t.misc.scanPasteTitle}</Text>
          <Text variant="caption" tone="muted">
            {t.misc.scanPasteBody}
          </Text>

          <Row
            style={{
              backgroundColor: theme.color.surfaceMuted,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
            }}
          >
            <Ionicons name="link" size={iconSize.md} color={theme.color.textMuted} />
            <TextInput
              value={pasted}
              onChangeText={(next) => {
                setPasted(next);
                setPasteError(null);
              }}
              placeholder={t.misc.scanPastePlaceholder}
              placeholderTextColor={theme.color.textFaint}
              accessibilityLabel={t.misc.scanPasteTitle}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              keyboardType="url"
              onSubmitEditing={submitPaste}
              returnKeyType="go"
              style={{
                flex: 1,
                ...theme.typography.body,
                color: theme.color.text,
                paddingVertical: theme.spacing.xs,
              }}
            />
          </Row>

          {pasteError ? <Callout tone="negative">{pasteError}</Callout> : null}

          <Button
            label={t.misc.scanPasteAction}
            size="lg"
            fullWidth
            disabled={pasted.trim().length === 0}
            onPress={submitPaste}
          />
        </View>
      </Sheet>
    </>
  );
}
