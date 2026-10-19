/**
 * The receipt row of a personal entry: add a photo, see it full screen, replace
 * or remove it.
 *
 * It owns the bytes, not the entry. Uploading puts the photo in R2 straight
 * away and reports the new key; the screen decides whether to keep it when the
 * person taps Save. A photo that was added and then replaced or removed before
 * saving is deleted here at once; the one the entry already had is deleted by
 * the screen after the save lands (`staleReceiptKeys`).
 */

import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Modal, Pressable, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Button, IconButton, iconSize, Text, useTheme, MODAL_ORIENTATIONS } from '@waves/ui';

import { DetailRow } from '@/components/DetailRows';
import { ZoomableGallery } from '@/components/ZoomableGallery';
import { useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import { captureReceipt, pickReceiptImage } from '@/lib/image';
import {
  personalReceiptUrl,
  removePersonalReceipt,
  uploadPersonalReceipt,
} from '@/lib/personalReceipt';
import { StoragePaidOnlyError, StorageCapError } from '@/lib/storage';

export function PersonalReceiptRow({
  value,
  savedKey,
  onChange,
}: {
  /** The key the form currently holds, or null. */
  value: string | null;
  /** The key the saved entry holds; never deleted from here. */
  savedKey: string | null;
  onChange: (key: string | null) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const { choose, confirm, notify } = useDialog();
  const ownerId = useViewerId();
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [url, setUrl] = useState<{ key: string; url: string | null } | null>(null);

  // Resolve the photo only while it is open: a list of entries must not sign a
  // URL per row, and the form should not fetch bytes nobody asked to see.
  useEffect(() => {
    if (!viewing || !value) return;
    let live = true;
    void personalReceiptUrl(value).then((resolved) => {
      if (live) setUrl({ key: value, url: resolved });
    });
    return () => {
      live = false;
    };
  }, [viewing, value]);

  /** A photo added in this form and never saved has no other owner: drop it now. */
  const dropIfUnsaved = (key: string | null): void => {
    if (key && key !== savedKey) void removePersonalReceipt(ownerId, key);
  };

  const add = async (): Promise<void> => {
    if (busy || !ownerId) return;
    const way = await choose({
      title: t.personalReceipt.addTitle,
      options: [
        { id: 'camera', label: t.personalReceipt.camera, icon: 'camera-outline' },
        { id: 'library', label: t.personalReceipt.library, icon: 'images-outline' },
      ],
    });
    if (!way) return;
    setBusy(true);
    try {
      const picked = way === 'camera' ? await captureReceipt() : await pickReceiptImage();
      if (!picked) return;
      const key = await uploadPersonalReceipt({
        ownerId,
        base64: picked.base64,
        mimeType: picked.mimeType,
      });
      dropIfUnsaved(value);
      onChange(key);
    } catch (caught) {
      const body =
        caught instanceof StoragePaidOnlyError
          ? t.personalReceipt.paidOnly
          : caught instanceof StorageCapError
            ? t.personalReceipt.storageFull
            : friendlyError(caught, t.personalReceipt.couldNotAdd, 'personalReceipt.add');
      await notify({ title: t.personalReceipt.title, body });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    const ok = await confirm({
      title: t.personalReceipt.removeTitle,
      body: t.personalReceipt.removeBody,
      confirmLabel: t.personalReceipt.remove,
      tone: 'danger',
    });
    if (!ok) return;
    dropIfUnsaved(value);
    setViewing(false);
    onChange(null);
  };

  const replace = async (): Promise<void> => {
    setViewing(false);
    await add();
  };

  const page = value && url?.key === value ? url.url : null;

  return (
    <>
      <DetailRow
        icon={value ? 'receipt' : 'receipt-outline'}
        iconColor={value ? theme.color.brand : undefined}
        label={t.personalReceipt.title}
        value={
          busy
            ? t.personalReceipt.saving
            : value
              ? t.personalReceipt.attached
              : t.personalReceipt.add
        }
        onPress={() => (value ? setViewing(true) : void add())}
      />
      <Modal
        supportedOrientations={MODAL_ORIENTATIONS}
        visible={viewing && value !== null}
        animationType="fade"
        onRequestClose={() => setViewing(false)}
      >
        {/* A Modal is its own native root on Android: without this, pinch and pan never reach the image. */}
        <GestureHandlerRootView style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingHorizontal: theme.spacing.xl,
                paddingTop: theme.spacing.xxl,
                paddingBottom: theme.spacing.sm,
              }}
            >
              <IconButton label={t.common.close} onPress={() => setViewing(false)}>
                <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
              </IconButton>
              <Text variant="caption" tone="muted">
                {t.personalReceipt.private}
              </Text>
              <IconButton label={t.personalReceipt.remove} onPress={() => void remove()}>
                <Ionicons name="trash-outline" size={iconSize.lg} color={theme.color.negative} />
              </IconButton>
            </View>
            <View style={{ flex: 1 }}>
              {page ? (
                <ZoomableGallery pages={[{ url: page }]} index={0} onIndexChange={() => {}} />
              ) : url?.key === value ? (
                <Pressable style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Text tone="muted">{t.personalReceipt.unavailable}</Text>
                </Pressable>
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator color={theme.color.brand} />
                </View>
              )}
            </View>
            <View style={{ padding: theme.spacing.xl }}>
              <Button
                label={t.personalReceipt.replace}
                variant="secondary"
                fullWidth
                onPress={() => void replace()}
              />
            </View>
          </View>
        </GestureHandlerRootView>
      </Modal>
    </>
  );
}
