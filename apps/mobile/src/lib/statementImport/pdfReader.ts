/**
 * Opening a statement PDF on the phone.
 *
 * The PDF is opened here, the person's password (Indian banks protect almost
 * every statement; it is usually a date of birth or part of the customer id) is
 * typed here and used here, the text layer is read page by page, and only the
 * redacted text leaves the phone. The password is never sent, stored or logged.
 *
 * The engine is pdf.js, bundled into the app (`pdfReaderHtml.generated.ts`) and
 * run in a hidden WebView (`usePdfReader`), so it works offline and nothing is
 * fetched. The conversation with it is `pdfReaderProtocol.ts`; the one-file
 * state machine is `pdfReaderSession.ts`. Everything after this seam
 * (redaction, chunking, the function call, the balance check, Review) works on
 * page text and page images.
 */

/** A page as read: its text, or, for a scan with no text layer, a picture of it. */
export type PdfPageRead =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'image'; readonly base64: string; readonly mimeType: 'image/jpeg' };

export type PdfReadFailure =
  'unsupported' | 'password_needed' | 'wrong_password' | 'too_many_pages' | 'unreadable';

export type PdfReadResult =
  | {
      readonly ok: true;
      /** Every page, in order. */
      readonly pages: readonly PdfPageRead[];
    }
  | { readonly ok: false; readonly reason: PdfReadFailure };

/**
 * True where there is a WebView to host pdf.js: iOS and Android. (This app's web
 * build is a static marketing export; the web app has its own import page.)
 * `EXPO_OS` is inlined by Expo at bundle time and absent in unit tests.
 */
export const PDF_READING_AVAILABLE: boolean = process.env.EXPO_OS !== 'web';

/** The longest the whole read may take, and the longest any one step may take. */
export const PDF_TOTAL_TIMEOUT_MS = 120_000;
export const PDF_STEP_TIMEOUT_MS = 30_000;

/** Width a scanned page is drawn at: wide enough for small print, small enough to upload. */
export const PDF_SCAN_WIDTH_PX = 1400;
