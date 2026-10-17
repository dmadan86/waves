/**
 * Opening a statement PDF on the phone: NOT YET AVAILABLE.
 *
 * The design is that the PDF is opened here, the person's password (Indian banks
 * protect almost every statement; it is usually a date of birth or part of the
 * customer id) is typed here and used here, the text layer is read page by page,
 * and only the redacted text leaves the phone. The password is never sent,
 * stored or logged.
 *
 * Doing that needs something that can decrypt a PDF and read its text layer, and
 * this app has nothing that can: no PDF module, no WebView to host pdf.js, and
 * the pure-JS route (an RC4 / AES decryptor plus a content-stream parser) is
 * a PDF engine we would own for ever. So this file is the seam, and it is
 * honest about it: `PDF_READING_AVAILABLE` is false and `readPdfText` says
 * `unsupported`. The screen reads the flag and tells the person plainly instead
 * of failing late.
 *
 * To turn it on, implement `readPdfText` below (pdf.js inside `react-native-webview`
 * is the usual route: add both packages) and flip the flag. Everything after
 * this seam (redaction, chunking, the function call, the balance check, Review)
 * is already built and tested against text dumps of synthetic statements.
 */

export type PdfReadResult =
  | {
      readonly ok: true;
      /** Text layer per page, in order. An empty string is a page with no text (a scan). */
      readonly pages: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason:
        'unsupported' | 'password_needed' | 'wrong_password' | 'too_many_pages' | 'unreadable';
    };

/** False until a PDF engine is bundled; the screen offers PDF only when this is true. */
export const PDF_READING_AVAILABLE = false;

/** Read the text of every page of a PDF. The password stays in this call. */
export async function readPdfText(_bytes: Uint8Array, _password?: string): Promise<PdfReadResult> {
  return { ok: false, reason: 'unsupported' };
}
