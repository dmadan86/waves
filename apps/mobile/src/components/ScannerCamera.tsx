/**
 * The live camera that reads an invite QR — the leaf that actually touches
 * `expo-camera`.
 *
 * It is only ever loaded (via a dynamic import) once `cameraAvailable()` is
 * true, so importing `expo-camera` here cannot crash an older binary: the
 * module is never evaluated on a build that lacks the native side. Everything
 * that belongs to the camera lives here — the permission dance, the torch, the
 * viewfinder — while the route above owns navigation and the paste-a-link way
 * in, which has to work on the states where there is no camera at all.
 *
 * The screen is the camera, edge to edge, with the surround dimmed and a hole
 * cut where the code goes. That shape is the one every mature scanner has
 * converged on (WhatsApp, LINE, Telegram, BeReal, Splitwise): the dim says
 * where to aim without a word, and the corner brackets mark the target without
 * boxing in the frame the way a full border does. The one instruction sits
 * above the hole so it never covers what the person is aiming at, and the
 * feedback sits below it, in space that is always reserved so nothing jumps
 * when a message arrives.
 *
 * The geometry is deliberately symmetric — three stacked bands, the middle one
 * a row of dim / hole / dim — so it mirrors correctly in Arabic for free.
 * Nothing here is positioned from a hardcoded edge.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Callout, iconSize, palette, Row, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { tokenFromScan } from '@/lib/qrScan';

/** The wash over everything that is not the viewfinder. Dark enough to say
 *  "aim here", light enough that the rest of the shot is still visible — a
 *  blackout would hide the thing being pointed at. */
const DIM = 'rgba(10, 10, 26, 0.62)';
/** The chip a floating control sits on, so a white glyph survives a white wall
 *  behind it. */
const GLASS = 'rgba(10, 10, 26, 0.55)';
/** How long a good read is celebrated before the screen changes. Long enough to
 *  be seen as "it worked", short enough not to feel like a wait. */
const FOUND_MS = 420;
/** How long a "that is not a Waves code" stays up after the bad code leaves the
 *  frame. The timer restarts on every frame the code is still in view. */
const INVALID_MS = 4000;
/** The corner brackets: arm length and stroke. */
const CORNER = 34;
const STROKE = 4;

/** What the camera has to say about the last thing it read. */
type Reading = 'idle' | 'found' | 'invalid';

/**
 * One of the four bracket arms around the viewfinder. Drawn as a corner rather
 * than a closed border because a closed border reads as a window the code has
 * to fit exactly, and it does not — the reader is happy with a code anywhere in
 * the hole. All four corners are drawn, so mirroring the layout in Arabic swaps
 * which is which and changes nothing about how it looks.
 */
function Corner({
  vertical,
  horizontal,
  color,
}: {
  vertical: 'top' | 'bottom';
  horizontal: 'left' | 'right';
  color: string;
}) {
  const theme = useTheme();
  const top = vertical === 'top';
  const left = horizontal === 'left';
  return (
    <View
      style={{
        position: 'absolute',
        top: top ? 0 : undefined,
        bottom: top ? undefined : 0,
        left: left ? 0 : undefined,
        right: left ? undefined : 0,
        width: CORNER,
        height: CORNER,
        borderColor: color,
        borderTopWidth: top ? STROKE : 0,
        borderBottomWidth: top ? 0 : STROKE,
        borderLeftWidth: left ? STROKE : 0,
        borderRightWidth: left ? 0 : STROKE,
        borderTopLeftRadius: top && left ? theme.radius.xl : 0,
        borderTopRightRadius: top && !left ? theme.radius.xl : 0,
        borderBottomLeftRadius: !top && left ? theme.radius.xl : 0,
        borderBottomRightRadius: !top && !left ? theme.radius.xl : 0,
      }}
    />
  );
}

/** A round control that floats on the camera: dark chip by default, inverted to
 *  white while it is on, so its state is a fill and a label rather than a
 *  colour alone. */
function GlassButton({
  label,
  onPress,
  active,
  children,
}: {
  label: string;
  onPress: () => void;
  /** Omitted for a control that is not a toggle. */
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={active === undefined ? undefined : { selected: active }}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? palette.white : GLASS,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}

/**
 * The states where there is a screen but no picture: permission not asked for
 * yet, permission refused, a camera that would not start. They wear the same
 * dark ground as the camera — the person opened a scanner, and dropping them
 * onto a light page would read as having been thrown somewhere else — and each
 * one carries the way out that actually applies to it.
 */
function DarkState({
  title,
  body,
  action,
  onClose,
  onPasteLink,
  closeLabel,
  pasteLabel,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  onClose: () => void;
  onPasteLink: () => void;
  closeLabel: string;
  pasteLabel: string;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: palette.night900 }}>
      <Row
        style={{ paddingTop: insets.top + theme.spacing.sm, paddingHorizontal: theme.spacing.xl }}
      >
        <GlassButton label={closeLabel} onPress={onClose}>
          <Ionicons name="close" size={iconSize.lg} color={palette.white} />
        </GlassButton>
      </Row>

      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.xxl,
          paddingBottom: insets.bottom + theme.spacing.xxxl,
        }}
      >
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: theme.radius.xl,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: GLASS,
            marginBottom: theme.spacing.sm,
          }}
        >
          <Ionicons name="camera-outline" size={iconSize.huge} color={palette.white} />
        </View>
        <Text variant="heading" align="center" style={{ color: palette.white }}>
          {title}
        </Text>
        <Text variant="body" align="center" style={{ color: palette.ink300 }}>
          {body}
        </Text>
        <View style={{ height: theme.spacing.md }} />
        {action}
        <Button label={pasteLabel} variant="onBrandOutline" onPress={onPasteLink} />
      </View>
    </View>
  );
}

export default function ScannerCamera({
  onToken,
  onClose,
  onPasteLink,
}: {
  onToken: (token: string) => void;
  onClose: () => void;
  /** Opens the route's paste-a-link sheet. Offered on every state, including
   *  the ones with no working camera — a person whose camera is refused is
   *  otherwise stranded on a screen that can do nothing for them. */
  onPasteLink: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useStrings();
  const { width } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();

  // A read fires many frames a second; once we have a good token we hand it up
  // once and stop, and a bad read only flags itself without locking the camera.
  const handled = useRef(false);
  const [reading, setReading] = useState<Reading>('idle');
  const [torch, setTorch] = useState(false);
  const [mountFailed, setMountFailed] = useState(false);

  // Both the celebration and the "not a Waves code" notice are timed, and both
  // are still pending if the person backs out mid-read. One ref holds whichever
  // is outstanding so unmounting cancels it rather than calling `onToken` — a
  // navigation — from a screen that is already gone.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether the refusal has already been spoken for the code currently in
  // frame. Tracked in a ref rather than off `reading`, because a bad code sits
  // in view for many frames a second and a screen reader must say so once.
  const announced = useRef(false);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onScan = (data: string): void => {
    if (handled.current) return;
    const token = tokenFromScan(data);
    if (!token) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        announced.current = false;
        setReading('idle');
      }, INVALID_MS);
      if (!announced.current) {
        announced.current = true;
        AccessibilityInfo.announceForAccessibility(t.misc.scanInvalid);
      }
      setReading('invalid');
      return;
    }
    handled.current = true;
    setReading('found');
    AccessibilityInfo.announceForAccessibility(t.misc.scanFound);
    // Hand off a beat later, so the frame turning and the "code found" line are
    // seen. A scanner that navigates the instant it reads leaves the person
    // wondering whether their own tap did it.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onToken(token), FOUND_MS);
  };

  if (!permission) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: palette.night900,
        }}
      >
        <ActivityIndicator color={palette.white} />
      </View>
    );
  }

  if (!permission.granted) {
    // Two different refusals. "Not asked yet" can still be asked; a permanent
    // no can only be undone in the system settings, and a button that says
    // "Allow camera" and then does nothing is the worst of both.
    const canAsk = permission.canAskAgain;
    return (
      <DarkState
        title={canAsk ? t.misc.scanAllowTitle : t.misc.scanDeniedTitle}
        body={canAsk ? t.misc.scanAllowBody : t.misc.scanDenied}
        action={
          <Button
            label={canAsk ? t.misc.scanAllow : t.pickers.openSettings}
            variant="onBrand"
            size="lg"
            onPress={() => void (canAsk ? requestPermission() : Linking.openSettings())}
          />
        }
        onClose={onClose}
        onPasteLink={onPasteLink}
        closeLabel={t.common.close}
        pasteLabel={t.misc.scanPasteLink}
      />
    );
  }

  if (mountFailed) {
    // The camera is in the build and allowed, and still would not start: a
    // device without one, or one another app is holding.
    return (
      <DarkState
        title={t.misc.scanCameraFailedTitle}
        body={t.misc.scanCameraFailed}
        onClose={onClose}
        onPasteLink={onPasteLink}
        closeLabel={t.common.close}
        pasteLabel={t.misc.scanPasteLink}
      />
    );
  }

  // The hole, sized off the screen so it stays a comfortable square on a small
  // phone and does not grow into a wall on a tablet.
  const hole = Math.max(200, Math.min(width - 96, 300));
  const brackets = reading === 'found' ? theme.color.brand : palette.white;

  return (
    <View style={{ flex: 1, backgroundColor: palette.night900 }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => onScan(data)}
        onMountError={() => setMountFailed(true)}
        // A camera has nothing for a screen reader to read, so it is named
        // instead: what this region is, and that it works by itself.
        accessible
        accessibilityLabel={t.misc.scanViewfinder}
      />

      {/* Three bands: dim, then the row that carries the hole, then dim. The
          bottom band is the taller one, which lifts the viewfinder above the
          middle of the screen — where a phone held out at a code naturally
          points, and clear of the controls underneath. `box-none` so the dim
          never eats a tap meant for a control sitting on it. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <View
          pointerEvents="box-none"
          style={{
            flex: 1,
            backgroundColor: DIM,
            paddingTop: insets.top + theme.spacing.sm,
            paddingHorizontal: theme.spacing.xl,
            justifyContent: 'space-between',
          }}
        >
          <Row>
            <GlassButton label={t.common.close} onPress={onClose}>
              <Ionicons name="close" size={iconSize.lg} color={palette.white} />
            </GlassButton>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text variant="heading" style={{ color: palette.white }}>
                {t.misc.scanToJoin}
              </Text>
            </View>
            {/* Restaurants at night are most of what gets scanned, so the light
                is a peer of the close button rather than something to go
                looking for. */}
            <GlassButton
              label={torch ? t.misc.scanTorchOff : t.misc.scanTorchOn}
              active={torch}
              onPress={() => setTorch((on) => !on)}
            >
              <Ionicons
                name={torch ? 'flashlight' : 'flashlight-outline'}
                size={iconSize.lg}
                color={torch ? palette.ink900 : palette.white}
              />
            </GlassButton>
          </Row>

          {/* The one instruction, above the hole so it is never covering the
              thing being aimed at. */}
          <Text
            variant="body"
            align="center"
            style={{ color: palette.white, paddingBottom: theme.spacing.xl }}
          >
            {t.misc.scanHint}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', height: hole }} pointerEvents="none">
          <View style={{ flex: 1, backgroundColor: DIM }} />
          <View style={{ width: hole, height: hole }}>
            <Corner vertical="top" horizontal="left" color={brackets} />
            <Corner vertical="top" horizontal="right" color={brackets} />
            <Corner vertical="bottom" horizontal="left" color={brackets} />
            <Corner vertical="bottom" horizontal="right" color={brackets} />
          </View>
          <View style={{ flex: 1, backgroundColor: DIM }} />
        </View>

        <View
          pointerEvents="box-none"
          style={{
            flex: 1.35,
            backgroundColor: DIM,
            paddingHorizontal: theme.spacing.xl,
            paddingBottom: insets.bottom + theme.spacing.xl,
            justifyContent: 'space-between',
          }}
        >
          {/* Reserved height whether or not there is anything to say, so the
              paste button underneath does not move when a message arrives. */}
          <View
            accessibilityLiveRegion="polite"
            style={{
              minHeight: 84,
              paddingTop: theme.spacing.xl,
              alignItems: 'center',
              justifyContent: 'flex-start',
            }}
          >
            {reading === 'found' ? (
              <Row
                style={{
                  backgroundColor: theme.color.brand,
                  borderRadius: theme.radius.pill,
                  paddingVertical: theme.spacing.sm,
                  paddingHorizontal: theme.spacing.lg,
                  gap: theme.spacing.sm,
                }}
              >
                <Ionicons name="checkmark-circle" size={iconSize.lg} color={palette.white} />
                <Text variant="subheading" style={{ color: palette.white }}>
                  {t.misc.scanFound}
                </Text>
              </Row>
            ) : reading === 'invalid' ? (
              <Callout tone="negative">{t.misc.scanInvalid}</Callout>
            ) : null}
          </View>

          {/* The way in for somebody who cannot scan — most often because the
              link arrived in a chat on this very phone, and there is no second
              screen to point the camera at. */}
          <View style={{ alignItems: 'center' }}>
            <Button
              label={t.misc.scanPasteLink}
              variant="onBrandOutline"
              icon={<Ionicons name="link" size={iconSize.base} color={palette.white} />}
              onPress={onPasteLink}
            />
          </View>
        </View>
      </View>
    </View>
  );
}
