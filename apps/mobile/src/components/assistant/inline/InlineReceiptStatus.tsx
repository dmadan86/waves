/**
 * The receipt just attached to the saved expense: a thumbnail, "Attached ✓" and
 * a way to take it off, or the failure with "Try again". Shown under the
 * follow-up card, so it outlives the question that asked for it.
 */

import { lazy, Suspense } from 'react';
import { ActivityIndicator, Image, View } from 'react-native';

import { Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { SmallAction } from './SmallAction';
import type { InlineReceipt } from './useInlineReceipt';

// Only loaded when the in-app camera opens (the binary may not have the module).
const ReceiptCamera = lazy(() => import('@/components/ReceiptCamera'));

export function InlineReceiptStatus({ receipt }: { receipt: InlineReceipt }) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.inline;
  const { picker, status, image } = receipt;

  return (
    <>
      {status !== 'idle' || picker.busy ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            minHeight: 44,
          }}
        >
          {image ? (
            <Image
              source={{ uri: image.uri }}
              accessibilityLabel={s.receiptThumb}
              style={{ width: 40, height: 40, borderRadius: theme.radius.sm }}
            />
          ) : null}
          {status === 'uploading' || picker.busy ? (
            <>
              <ActivityIndicator color={theme.color.brand} />
              <Text tone="muted">{s.attaching}</Text>
            </>
          ) : status === 'attached' ? (
            <>
              <Text style={{ flex: 1, color: theme.color.brand, fontWeight: '700' }}>
                {s.attached}
              </Text>
              <SmallAction label={s.removeReceipt} onPress={receipt.remove} />
            </>
          ) : (
            <>
              <Text
                style={{ flex: 1, color: theme.color.negative }}
                accessibilityLiveRegion="polite"
              >
                {s.attachFailed}
              </Text>
              <SmallAction label={s.retry} onPress={receipt.retry} />
            </>
          )}
        </View>
      ) : null}
      {picker.cameraOpen ? (
        <Suspense fallback={null}>
          <ReceiptCamera
            onShot={picker.onShot}
            onLibrary={picker.onLibrary}
            onClose={picker.closeCamera}
            onDenied={picker.onDenied}
          />
        </Suspense>
      ) : null}
    </>
  );
}
