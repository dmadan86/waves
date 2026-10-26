import { requireOptionalNativeModule } from 'expo';
import { Linking, Platform } from 'react-native';
import type { UpiResponse } from './upiResponse';

/** Native callbacks are reconciliation hints only. They never confirm receipt. */
export interface UpiResult extends Omit<UpiResponse, 'txnRef'> {
  utr?: string | null;
  txnRef?: string | null;
}

export async function launchUpi(uri: string): Promise<UpiResult | null> {
  const native =
    Platform.OS === 'android'
      ? requireOptionalNativeModule<{ launchUpi(uri: string): Promise<UpiResponse | null> }>(
          'WavesUpi',
        )
      : null;
  if (native) {
    const result = await native.launchUpi(uri);
    if (!result) return null;
    // Reference hint only. Status and responseCode never drive payment state.
    const utr = result.ApprovalRefNo || result.txnId;
    return { ...result, ...(utr ? { utr } : {}) };
  }
  await Linking.openURL(uri);
  return null;
}
