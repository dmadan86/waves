import { Linking } from 'react-native';

/** Native callbacks are reconciliation hints only. They never confirm receipt. */
export interface UpiResult {
  utr?: string | null;
  txnRef?: string | null;
}

export async function launchUpi(uri: string): Promise<UpiResult | null> {
  await Linking.openURL(uri);
  return null;
}
