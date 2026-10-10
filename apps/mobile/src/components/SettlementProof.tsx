/**
 * The payment proofs on a settlement — up to five screenshots the payer
 * attaches, visible to the two parties only (feature §4).
 *
 * The payer records that they paid (ADR-007: Waves never moves the money) and
 * can back it with images — a bank confirmation, a UPI receipt. The payee sees
 * them before tapping "Confirm received", so a confirmation is a response to
 * evidence rather than to a bare claim. Nobody else in the group sees them: the
 * rows reached this device already RLS-filtered by the party predicate, and the
 * URLs are signed only for a party. The enforcement is the DB and r2-sign; this
 * screen is the label on it.
 *
 * Unlike the offline-first ledger writes, attach and remove are direct online
 * RPCs — the bytes need an upload, and the settlement they hang off must already
 * exist server-side (its party check answers about a real row). So the add
 * control only ever appears on a settlement that has already synced.
 *
 * A free account that is out of storage is refused by r2-sign (STORAGE_CAP); the
 * add control answers with the same upgrade prompt every other upload uses.
 */

import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';

import { IconButton, iconSize, Text, useTheme, MODAL_ORIENTATIONS } from '@waves/ui';

import { ZoomableGallery, type GalleryPage } from '@/components/ZoomableGallery';
import {
  useAttachSettlementProof,
  useRemoveSettlementProof,
  useSettlementProofs,
  type SettlementProofRow,
} from '@/data/hooks';
import { fill, useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';
import { canAddProof, classifyProofAddFailure, ProofAddFailure } from '@/lib/paymentProof';
import { restrictedImageUrl } from '@/lib/storage';

const THUMB = 56;
const STACK_THUMB = 52;

/**
 * Resolve restricted keys to URLs, telling "still resolving" apart from
 * "resolved to nothing" — a signing failure or a disabled backend would
 * otherwise spin forever. The async resolve is the only writer, keyed by the
 * path it was for, so no setState runs synchronously in the effect.
 */
function useRestrictedUrls(
  settlementId: string,
  paths: readonly string[],
): ReadonlyMap<string, string | null> {
  const [fetched, setFetched] = useState<ReadonlyMap<string, string | null>>(new Map());
  const wanted = paths.join('|');
  useEffect(() => {
    let active = true;
    for (const path of wanted ? wanted.split('|') : []) {
      void (async () => {
        const url = await restrictedImageUrl('settlement-proofs', settlementId, path);
        if (active) setFetched((prev) => new Map(prev).set(path, url));
      })();
    }
    return () => {
      active = false;
    };
  }, [settlementId, wanted]);
  return fetched;
}

/** Adds a proof: pick, upload, record. Out of free storage → the upgrade prompt. */
export function useAddProof(groupId: string, settlementId: string) {
  const { t } = useStrings();
  const { confirm, notify } = useDialog();
  const attach = useAttachSettlementProof(groupId, settlementId);
  const add = (): void => {
    attach.mutate(undefined, {
      onError: (caught) => {
        if (classifyProofAddFailure(caught) === ProofAddFailure.StorageFull) {
          void confirm({
            title: t.storage.full,
            confirmLabel: t.storage.upgrade,
          }).then((upgrade) => {
            if (upgrade) router.push('/settings/upgrade');
          });
          return;
        }
        void notify({
          title: friendlyError(caught, t.couldNotSave, 'settlement.proof.add'),
          tone: 'danger',
        });
      },
    });
  };
  return { add, pending: attach.isPending };
}

/**
 * `canManage` is true only for the payer — the party who says they paid. The
 * payee gets the same view but no add/remove: they are looking at the other
 * side's evidence, not their own. `adder` lets a parent that also has an "Add
 * proof" action share one upload state with the add tile.
 */
export function SettlementProof({
  groupId,
  settlementId,
  canManage,
  adder,
  stack = false,
}: {
  groupId: string;
  settlementId: string;
  canManage: boolean;
  adder?: ReturnType<typeof useAddProof>;
  /**
   * One thumbnail with a "+N" badge and a chevron instead of the row — for a
   * card whose own action row carries "Add proof". Nothing when there are none.
   */
  stack?: boolean;
}): React.JSX.Element | null {
  const theme = useTheme();
  const { t } = useStrings();
  const { confirm } = useDialog();
  const proofs = useSettlementProofs(settlementId);
  const ownAdder = useAddProof(groupId, settlementId);
  const { add, pending } = adder ?? ownAdder;
  const remove = useRemoveSettlementProof(settlementId);
  const [viewing, setViewing] = useState<number | null>(null);

  const rows: SettlementProofRow[] = proofs.data ?? [];
  const urls = useRestrictedUrls(
    settlementId,
    rows.map((row) => row.storagePath),
  );

  const showAdd = !stack && canManage && canAddProof(rows.length);
  // No proof and I cannot add one → nothing to show. The payee sees this state
  // as an absence, not an empty control, until the payer attaches.
  if (rows.length === 0 && !showAdd) return null;

  const confirmRemove = (row: SettlementProofRow) => {
    void confirm({
      title: t.proof.removeConfirm,
      confirmLabel: t.proof.remove,
      tone: 'danger',
    }).then((ok) => {
      if (!ok) return;
      setViewing(null);
      remove.mutate({ proofId: row.id, storagePath: row.storagePath });
    });
  };

  const viewed = viewing === null ? null : (rows[Math.min(viewing, rows.length - 1)] ?? null);
  const viewedIndex = viewed ? rows.indexOf(viewed) : 0;
  const pages: GalleryPage[] = rows.map((row) => ({ url: urls.get(row.storagePath) ?? null }));

  const first = rows[0];
  const firstUrl = first ? urls.get(first.storagePath) : undefined;
  const stacked = first ? (
    <Pressable
      onPress={() => setViewing(0)}
      accessibilityRole="button"
      accessibilityLabel={t.proof.view}
      hitSlop={6}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: STACK_THUMB,
          height: STACK_THUMB,
          borderRadius: theme.radius.sm,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: theme.color.border,
          backgroundColor: theme.color.surfaceMuted,
        }}
      >
        {firstUrl ? (
          <Image
            source={{ uri: firstUrl }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {firstUrl === null ? (
              <Ionicons name="image-outline" size={iconSize.sm} color={theme.color.textFaint} />
            ) : (
              <ActivityIndicator size="small" color={theme.color.textFaint} />
            )}
          </View>
        )}
        {rows.length > 1 ? (
          <View
            style={{
              position: 'absolute',
              right: 3,
              bottom: 3,
              minWidth: 20,
              height: 20,
              paddingHorizontal: 4,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0,0,0,0.6)',
            }}
          >
            <Text variant="micro" style={{ color: '#fff', fontWeight: '700' }}>
              +{rows.length - 1}
            </Text>
          </View>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={iconSize.sm} color={theme.color.textFaint} />
    </Pressable>
  ) : null;

  return (
    <View>
      {stack ? (
        stacked
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: theme.spacing.sm, alignItems: 'center' }}
        >
          {rows.map((row, index) => {
            const url = urls.get(row.storagePath);
            return (
              <Pressable
                key={row.id}
                onPress={() => setViewing(index)}
                accessibilityRole="button"
                accessibilityLabel={fill(t.proof.viewerTitle, { n: index + 1, total: rows.length })}
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
          {showAdd ? (
            <Pressable
              onPress={add}
              disabled={pending}
              accessibilityRole="button"
              accessibilityLabel={t.proof.add}
              accessibilityState={{ disabled: pending }}
              style={{
                width: THUMB,
                height: THUMB,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: theme.color.border,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {pending ? (
                <ActivityIndicator color={theme.color.brand} />
              ) : (
                <Ionicons name="add" size={iconSize.lg} color={theme.color.brand} />
              )}
            </Pressable>
          ) : null}
        </ScrollView>
      )}

      <Modal
        supportedOrientations={MODAL_ORIENTATIONS}
        visible={viewed !== null}
        animationType="fade"
        onRequestClose={() => setViewing(null)}
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
            <IconButton label={t.common.close} onPress={() => setViewing(null)}>
              <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
            </IconButton>
            <Text variant="caption" tone="muted">
              {fill(t.proof.viewerTitle, { n: viewedIndex + 1, total: rows.length })}
            </Text>
            {canManage && viewed ? (
              <IconButton
                label={t.proof.remove}
                onPress={() => {
                  if (!remove.isPending) confirmRemove(viewed);
                }}
              >
                <Ionicons name="trash-outline" size={iconSize.lg} color={theme.color.negative} />
              </IconButton>
            ) : (
              <View style={{ width: 44 }} />
            )}
          </View>
          {viewed ? (
            // Keyed by the first row so the pager restarts at the tapped page
            // each time it opens, and after a removal shifts the others.
            <ZoomableGallery
              key={rows.length}
              pages={pages}
              index={viewedIndex}
              onIndexChange={setViewing}
            />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}
