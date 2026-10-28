/**
 * The photos on one company entry. Visible to the entry's employee and the
 * company admins only: the rows reached this phone already filtered by the
 * database, and each URL is signed for 60 seconds by `r2-sign`, which re-checks
 * the caller. This component is the label on that, not the lock.
 *
 * Attach and remove are direct online RPCs (the bytes need an upload), so the
 * add control flushes the queued entry first.
 */

import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { IconButton, iconSize, MODAL_ORIENTATIONS, Text, useTheme } from '@waves/ui';

import { ZoomableGallery, type GalleryPage } from '@/components/ZoomableGallery';
import { PillButton } from '@/components/standard';
import { useAddCompanyPhoto, useCompanyPhotos, useRemoveCompanyPhoto } from '@/data/companyEntries';
import { useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import { restrictedImageUrl } from '@/lib/storage';

const THUMB = 64;
/** Most photos on an entry; the server enforces the same limit. */
export const MAX_COMPANY_PHOTOS = 10;

export function CompanyEntryPhotos({
  groupId,
  entryId,
  canAdd,
  canRemove,
}: {
  groupId: string;
  entryId: string;
  canAdd: boolean;
  /** Admin, or the employee for a photo they uploaded. */
  canRemove: (uploaderMemberId: string) => boolean;
}): React.JSX.Element | null {
  const theme = useTheme();
  const { t } = useStrings();
  const { confirm, notify } = useDialog();
  const photos = useCompanyPhotos(entryId);
  const add = useAddCompanyPhoto(groupId, entryId);
  const remove = useRemoveCompanyPhoto(groupId);
  const [viewing, setViewing] = useState<number | null>(null);
  const [urls, setUrls] = useState<ReadonlyMap<string, string | null>>(new Map());

  const wanted = photos.map((photo) => photo.storagePath).join('|');
  useEffect(() => {
    let active = true;
    for (const path of wanted ? wanted.split('|') : []) {
      void restrictedImageUrl('company-entry-images', entryId, path).then((url) => {
        if (active) setUrls((prev) => new Map(prev).set(path, url));
      });
    }
    return () => {
      active = false;
    };
  }, [entryId, wanted]);

  const addFrom = (source: 'camera' | 'library'): void => {
    add.mutate(source, {
      onError: (caught) => {
        void notify({
          title: friendlyError(caught, t.company.photoFailed, 'company.photo.add'),
          tone: 'danger',
        });
      },
    });
  };

  if (photos.length === 0 && !canAdd) return null;
  const showAdd = canAdd && photos.length < MAX_COMPANY_PHOTOS;
  const viewed = viewing === null ? null : (photos[Math.min(viewing, photos.length - 1)] ?? null);
  const pages: GalleryPage[] = photos.map((photo) => ({
    url: urls.get(photo.storagePath) ?? null,
    preview: photo.preview,
  }));

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {photos.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: theme.spacing.sm }}
        >
          {photos.map((photo, index) => {
            const url = urls.get(photo.storagePath);
            return (
              <Pressable
                key={photo.id}
                onPress={() => setViewing(index)}
                accessibilityRole="button"
                accessibilityLabel={t.company.photos}
                style={{
                  width: THUMB,
                  height: THUMB,
                  borderRadius: theme.radius.md,
                  overflow: 'hidden',
                  backgroundColor: theme.color.surfaceMuted,
                }}
              >
                {url || photo.preview ? (
                  <Image
                    source={{ uri: url ?? photo.preview ?? undefined }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                  />
                ) : (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    {url === null ? (
                      <Ionicons
                        name="image-outline"
                        size={iconSize.md}
                        color={theme.color.textFaint}
                      />
                    ) : (
                      <ActivityIndicator color={theme.color.textFaint} />
                    )}
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {showAdd ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
          <PillButton
            label={t.company.takePhoto}
            icon="camera-outline"
            chevron={false}
            onPress={() => addFrom('camera')}
          />
          <PillButton
            label={t.company.choosePhoto}
            icon="image-outline"
            chevron={false}
            onPress={() => addFrom('library')}
          />
          {add.isPending ? <ActivityIndicator color={theme.color.brand} /> : null}
        </View>
      ) : null}
      {photos.length > 0 ? (
        <Text variant="micro" tone="muted">
          {t.company.photoPrivacy}
        </Text>
      ) : null}

      <Modal
        supportedOrientations={MODAL_ORIENTATIONS}
        visible={viewed !== null}
        animationType="fade"
        onRequestClose={() => setViewing(null)}
      >
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
              <IconButton label={t.common.close} onPress={() => setViewing(null)}>
                <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
              </IconButton>
              {viewed && canRemove(viewed.uploaderMemberId) ? (
                <IconButton
                  label={t.company.removePhoto}
                  onPress={() => {
                    if (remove.isPending) return;
                    void confirm({
                      title: t.company.removePhotoTitle,
                      confirmLabel: t.company.removePhoto,
                      tone: 'danger',
                    }).then((ok) => {
                      if (!ok) return;
                      setViewing(null);
                      remove.mutate({ photoId: viewed.id });
                    });
                  }}
                >
                  <Ionicons name="trash-outline" size={iconSize.lg} color={theme.color.negative} />
                </IconButton>
              ) : (
                <View style={{ width: 44 }} />
              )}
            </View>
            {viewed ? (
              <ZoomableGallery
                key={photos.length}
                pages={pages}
                index={viewing ?? 0}
                onIndexChange={setViewing}
              />
            ) : null}
          </View>
        </GestureHandlerRootView>
      </Modal>
    </View>
  );
}
