/**
 * The payment proof on a settlement — a screenshot the payer attaches, visible
 * to the two parties only (feature §4).
 *
 * The payer records that they paid (ADR-007: Waves never moves the money) and
 * can back it with an image — a bank confirmation, a UPI receipt. The payee
 * sees that image before tapping "Confirm received", so a confirmation is a
 * response to evidence rather than to a bare claim. Nobody else in the group
 * sees it: the row reached this device already RLS-filtered by the party
 * predicate, and the URL is signed only for a party. The enforcement is the DB
 * and r2-sign; this screen is the label on it.
 *
 * Unlike the offline-first ledger writes, attach and remove are direct online
 * RPCs — the bytes need an upload, and the settlement they hang off must already
 * exist server-side (its party check answers about a real row). So this control
 * only ever appears on a settlement that has already synced, never mid-record.
 */

import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { ActivityIndicator, Modal, Pressable, View } from 'react-native';

import { Button, IconButton, iconSize, Text, useTheme, MODAL_ORIENTATIONS } from '@waves/ui';

import { ZoomableImage } from '@/components/ZoomableImage';
import {
  useAttachSettlementProof,
  useRemoveSettlementProof,
  useSettlementProof,
} from '@/data/hooks';
import { restrictedImageUrl } from '@/lib/storage';
import { useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';

const THUMB = 72;
/** The compact strip on the pending-payment card: a thumbnail and a square tile. */
const TILE_THUMB = 56;
export const TILE = 48;

/** The thin rule between the card's tiles. */
export function tileDivider(theme: ReturnType<typeof useTheme>) {
  return { width: 1, height: TILE + 20, backgroundColor: theme.color.border } as const;
}

/**
 * Resolve a restricted key to a URL, telling "still resolving" apart from
 * "resolved to nothing" — a signing failure or a disabled backend would
 * otherwise spin forever. The async resolve is the only writer, keyed by the
 * path it was for, so no setState runs synchronously in the effect.
 */
function useRestrictedUrl(
  settlementId: string,
  path: string | null,
): { url: string | null; resolved: boolean } {
  const [fetched, setFetched] = useState<{ path: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    let active = true;
    void (async () => {
      const resolved = await restrictedImageUrl('settlement-proofs', settlementId, path);
      if (active) setFetched({ path, url: resolved });
    })();
    return () => {
      active = false;
    };
  }, [settlementId, path]);
  if (!path) return { url: null, resolved: true };
  if (fetched && fetched.path === path) return { url: fetched.url, resolved: true };
  return { url: null, resolved: false };
}

/**
 * `canManage` is true only for the payer — the party who says they paid. The
 * payee gets the same view but no add/remove: they are looking at the other
 * side's evidence, not their own.
 */
export function SettlementProof({
  groupId,
  settlementId,
  canManage,
  layout = 'stack',
}: {
  groupId: string;
  settlementId: string;
  canManage: boolean;
  /**
   * 'stack' is the full-width control the other screens use. 'tiles' is the
   * pending-payment card's compact strip: a thumbnail and a square Proof tile,
   * sized to sit beside the card's own Cancel tile.
   */
  layout?: 'stack' | 'tiles';
}): React.JSX.Element | null {
  const theme = useTheme();
  const { t } = useStrings();
  const { confirm } = useDialog();
  const proof = useSettlementProof(settlementId);
  const attach = useAttachSettlementProof(groupId, settlementId);
  const remove = useRemoveSettlementProof(settlementId);
  const [viewing, setViewing] = useState(false);

  const row = proof.data;
  const { url, resolved } = useRestrictedUrl(settlementId, row?.storagePath ?? null);

  // No proof and I cannot add one → nothing to show. The payee sees this state
  // as an absence, not an empty control, until the payer attaches.
  if (!row && !canManage) return null;

  const confirmRemove = () => {
    if (!row) return;
    void confirm({
      title: t.proof.removeConfirm,
      confirmLabel: t.proof.remove,
      tone: 'danger',
    }).then((ok) => {
      if (!ok) return;
      setViewing(false);
      remove.mutate({ proofId: row.id, storagePath: row.storagePath });
    });
  };

  // Shared by both layouts: the full-screen look at the image, with the
  // payer's remove in its corner.
  const viewer = (
    <Modal
      supportedOrientations={MODAL_ORIENTATIONS}
      visible={viewing}
      animationType="fade"
      onRequestClose={() => setViewing(false)}
    >
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
          {canManage ? (
            <IconButton
              label={t.proof.remove}
              onPress={() => {
                if (!remove.isPending) confirmRemove();
              }}
            >
              <Ionicons name="trash-outline" size={iconSize.lg} color={theme.color.negative} />
            </IconButton>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>
        {url ? (
          <ZoomableImage uri={url} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {resolved ? (
              <Ionicons name="image-outline" size={iconSize.xl} color={theme.color.textFaint} />
            ) : (
              <ActivityIndicator color={theme.color.brand} />
            )}
          </View>
        )}
      </View>
    </Modal>
  );

  if (layout === 'tiles') {
    // A replacement attaches the new image first and only then drops the old
    // one, so a cancelled picker or a failed upload never costs the proof the
    // payee may already be looking at.
    const pickProof = () => {
      if (attach.isPending) return;
      const previous = row;
      void attach.mutateAsync().then(
        (attached) => {
          if (attached && previous) {
            remove.mutate({ proofId: previous.id, storagePath: previous.storagePath });
          }
        },
        () => {},
      );
    };
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        {row ? (
          // The badge overhangs the thumbnail's corner, so it is a sibling of
          // the clipped image rather than inside it.
          <View style={{ width: TILE_THUMB, height: TILE_THUMB }}>
            <Pressable
              onPress={() => setViewing(true)}
              accessibilityRole="button"
              accessibilityLabel={t.proof.view}
              style={{
                width: TILE_THUMB,
                height: TILE_THUMB,
                borderRadius: theme.radius.sm,
                overflow: 'hidden',
                backgroundColor: theme.color.surfaceMuted,
              }}
            >
              {url ? (
                <Image
                  source={{ uri: url }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
                />
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  {resolved ? (
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
            {canManage ? (
              <Pressable
                onPress={confirmRemove}
                disabled={remove.isPending}
                accessibilityRole="button"
                accessibilityLabel={t.proof.remove}
                hitSlop={8}
                style={{
                  position: 'absolute',
                  top: -6,
                  end: -6,
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: theme.color.brand,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="close" size={14} color={theme.color.onBrand} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {canManage ? (
          <>
            {row ? <View style={tileDivider(theme)} /> : null}
            <Pressable
              onPress={pickProof}
              disabled={attach.isPending}
              accessibilityRole="button"
              accessibilityLabel={row ? t.proof.replace : t.proof.add}
              style={{ alignItems: 'center', gap: theme.spacing.xs }}
            >
              <View
                style={{
                  width: TILE,
                  height: TILE,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.color.brandSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {attach.isPending ? (
                  <ActivityIndicator color={theme.color.brand} />
                ) : (
                  <Ionicons name="camera-outline" size={iconSize.lg} color={theme.color.brand} />
                )}
              </View>
              <Text variant="caption" tone="muted">
                {t.proof.tile}
              </Text>
            </Pressable>
          </>
        ) : null}
        {viewer}
      </View>
    );
  }

  if (!row) {
    return (
      <Button
        label={t.proof.add}
        variant="secondary"
        size="md"
        disabled={attach.isPending}
        onPress={() => attach.mutate()}
        icon={
          attach.isPending ? undefined : (
            <Ionicons name="camera-outline" size={iconSize.md} color={theme.color.brand} />
          )
        }
      />
    );
  }

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="caption" tone="muted">
        {t.proof.title}
      </Text>
      <Pressable
        onPress={() => setViewing(true)}
        accessibilityRole="button"
        accessibilityLabel={t.proof.view}
        style={{
          width: THUMB,
          height: THUMB,
          borderRadius: theme.radius.md,
          overflow: 'hidden',
          backgroundColor: theme.color.surfaceMuted,
        }}
      >
        {url ? (
          <Image
            source={{ uri: url }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {resolved ? (
              <Ionicons name="image-outline" size={iconSize.lg} color={theme.color.textFaint} />
            ) : (
              <ActivityIndicator color={theme.color.textFaint} />
            )}
          </View>
        )}
      </Pressable>

      {viewer}
    </View>
  );
}
