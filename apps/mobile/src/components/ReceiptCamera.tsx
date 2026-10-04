/**
 * Full-screen camera for the quick-expense receipt: shutter, flash, close, and
 * a gallery button (bottom-left, like the system camera) that hands off to the
 * photo library.
 *
 * Only ever loaded (a lazy import) once `cameraAvailable()` is true, so
 * `expo-camera` is never evaluated on a binary that lacks it — the same
 * discipline as `ScannerCamera`.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { iconSize, MODAL_ORIENTATIONS, palette } from '@waves/ui';

import { useStrings } from '@/i18n';
import type { CameraShot } from '@/lib/quickReceipt';

const GLASS = 'rgba(0,0,0,0.45)';

function GlassButton({
  label,
  onPress,
  active,
  children,
}: {
  label: string;
  onPress: () => void;
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
        width: 48,
        height: 48,
        borderRadius: 24,
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

export default function ReceiptCamera({
  onShot,
  onLibrary,
  onClose,
  onDenied,
}: {
  onShot: (shot: CameraShot) => void;
  onLibrary: () => void;
  onClose: () => void;
  onDenied: () => void;
}) {
  const { t } = useStrings();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [flash, setFlash] = useState(false);
  const [shooting, setShooting] = useState(false);
  const [mountFailed, setMountFailed] = useState(false);

  // Ask once on open; a refusal (or a camera that will not start) falls back to
  // the library with a short message rather than a dead dark screen.
  const asked = useRef(false);
  useEffect(() => {
    if (!permission || permission.granted) return;
    if (permission.canAskAgain && !asked.current) {
      asked.current = true;
      void requestPermission();
      return;
    }
    onDenied();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission]);
  useEffect(() => {
    if (mountFailed) onDenied();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountFailed]);

  const shoot = (): void => {
    if (shooting || !camera.current) return;
    setShooting(true);
    void camera.current
      .takePictureAsync({ quality: 0.9 })
      .then((pic) => onShot({ uri: pic.uri, width: pic.width, height: pic.height }))
      .catch(() => setShooting(false));
  };

  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      supportedOrientations={MODAL_ORIENTATIONS}
    >
      <View style={{ flex: 1, backgroundColor: palette.night900 }}>
        {permission?.granted ? (
          <CameraView
            ref={camera}
            style={StyleSheet.absoluteFill}
            facing="back"
            flash={flash ? 'on' : 'off'}
            onMountError={() => setMountFailed(true)}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={palette.white} />
          </View>
        )}

        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: insets.top + 12,
            left: 20,
            right: 20,
            flexDirection: 'row',
            justifyContent: 'space-between',
          }}
        >
          <GlassButton label={t.common.close} onPress={onClose}>
            <Ionicons name="close" size={iconSize.lg} color={palette.white} />
          </GlassButton>
          <GlassButton
            label={t.quickExpense.receiptFlash}
            active={flash}
            onPress={() => setFlash((f) => !f)}
          >
            <Ionicons
              name={flash ? 'flash' : 'flash-off'}
              size={iconSize.lg}
              color={flash ? palette.night900 : palette.white}
            />
          </GlassButton>
        </View>

        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            bottom: insets.bottom + 28,
            left: 28,
            right: 28,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <GlassButton label={t.quickExpense.receiptGallery} onPress={onLibrary}>
            <Ionicons name="images-outline" size={iconSize.lg} color={palette.white} />
          </GlassButton>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.quickExpense.receiptShutter}
            accessibilityState={{ busy: shooting, disabled: !permission?.granted }}
            disabled={shooting || !permission?.granted}
            onPress={shoot}
            style={({ pressed }) => ({
              width: 76,
              height: 76,
              borderRadius: 38,
              borderWidth: 4,
              borderColor: palette.white,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed || shooting ? 0.6 : 1,
            })}
          >
            <View
              style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: palette.white }}
            />
          </Pressable>
          {/* Balances the gallery button so the shutter sits centred. */}
          <View style={{ width: 48, height: 48 }} />
        </View>
      </View>
    </Modal>
  );
}
