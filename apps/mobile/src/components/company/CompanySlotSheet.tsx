/**
 * The compact paywall for an extra company: "Your first company is free. Each extra company is {price}/month."
 * Subscribe buys a company slot, Restore re-reads the store account. `onReady` fires once the server
 * confirms a free slot, so the caller can create (or renew) the company, which the server then binds.
 * Never a dead button: with no store product the sheet says so and offers only Close.
 */

import { useEffect, useState } from 'react';
import type { PurchasesStoreProduct } from 'react-native-purchases';
import { View } from 'react-native';

import { Button, Sheet, Text, useTheme } from '@waves/ui';

import { fetchSlotStatus, waitForFreeSlot } from '@/data/companySlotApi';
import { useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import {
  buyCompanySlot,
  loadCompanySlotProduct,
  purchasesAvailable,
  restore,
} from '@/lib/purchases';

export function CompanySlotSheet({
  visible,
  onClose,
  onReady,
}: {
  visible: boolean;
  onClose: () => void;
  onReady: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const { notify } = useDialog();
  const [product, setProduct] = useState<PurchasesStoreProduct | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    void (purchasesAvailable() ? loadCompanySlotProduct() : Promise.resolve(null)).then(
      (found) => live && setProduct(found),
    );
    return () => {
      live = false;
    };
  }, [visible]);

  const ready = () => {
    onClose();
    onReady();
  };

  const subscribe = async () => {
    if (!product || busy) return;
    setBusy(true);
    try {
      const outcome = await buyCompanySlot(product);
      if (outcome === 'cancelled') return;
      if (outcome === 'pending') {
        await notify({ title: t.companySlot.pending });
        return;
      }
      // The store tells the server first (webhook); wait for the slot to show up there.
      if (await waitForFreeSlot()) ready();
      else await notify({ title: t.companySlot.setupSlow });
    } catch {
      await notify({ title: t.companySlot.buyFailed, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const restorePurchases = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await restore();
      if ((await fetchSlotStatus())?.has_free_slot || (await waitForFreeSlot(3))) {
        await notify({ title: t.companySlot.restored });
        ready();
      } else {
        await notify({ title: t.companySlot.noneFound });
      }
    } catch {
      await notify({ title: t.companySlot.buyFailed, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.md }}>
        <Text variant="title">{t.companySlot.title}</Text>
        {product ? (
          <>
            <Text variant="body" tone="muted">
              {t.companySlot.body.replace('{price}', product.priceString)}
            </Text>
            <Button
              label={t.companySlot.subscribe}
              fullWidth
              disabled={busy}
              onPress={() => void subscribe()}
            />
            <Button
              label={t.companySlot.restore}
              variant="secondary"
              fullWidth
              disabled={busy}
              onPress={() => void restorePurchases()}
            />
          </>
        ) : (
          <>
            <Text variant="body" tone="muted">
              {product === undefined ? t.common.loading : t.companySlot.unavailable}
            </Text>
            {product === null ? (
              <Button label={t.common.close} fullWidth onPress={onClose} />
            ) : null}
          </>
        )}
      </View>
    </Sheet>
  );
}
