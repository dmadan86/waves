/**
 * Reading the text off a receipt on the phone itself — switched off.
 *
 * This used ML Kit's on-device text recogniser to send `receipt-parse` the
 * receipt's text instead of its photo. The recogniser's native libraries were
 * the single largest part of the app (roughly 30–45 MB per Android ABI, plus
 * the CJK script models on iOS), so it was removed to cut the download size.
 *
 * Every caller already treats `null` as "no usable text, upload the image", the
 * path `receipt-parse` has always accepted, so scanning keeps working: the
 * photo goes to the parser instead of its text. Bring the recogniser back here
 * (and the dependency in package.json) to restore the on-device path.
 */

export interface OcrResult {
  readonly text: string;
  /** How many lines the recogniser found. Useful for telling the user why. */
  readonly lines: number;
}

/** Always null: there is no on-device recogniser, so callers upload the image. */
export async function recogniseReceipt(_uri: string): Promise<OcrResult | null> {
  return null;
}
