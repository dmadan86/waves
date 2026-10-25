/**
 * The hidden WebView that hosts pdf.js, as a hook.
 *
 *   const pdf = usePdfReader();
 *   ...
 *   <>{pdf.element}</>                      // render once, anywhere in the screen
 *   const result = await pdf.read(bytes);   // mounts the WebView, reads, unmounts it
 *   if (!result.ok && result.reason === 'password_needed') {
 *     const again = await pdf.unlock(typed); // same WebView, bytes not re-sent
 *   }
 *   pdf.cancel();                            // person gave up on the password
 *
 * The WebView exists only while a read (or a wait for a password) is under way,
 * and is unmounted the moment there is a result, so a statement does not sit in
 * a WebView's memory. The page is local HTML with pdf.js inlined: it loads
 * nothing, and navigation away from it is refused.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import {
  WebView as UntypedRefWebView,
  type WebViewMessageEvent,
  type WebViewProps,
} from 'react-native-webview';

import { PDF_READER_HTML } from './pdfReaderHtml.generated';
import type { PdfReadResult } from './pdfReader';
import { injectionFor, type ToPage } from './pdfReaderProtocol';
import { PdfReadSession } from './pdfReaderSession';

type WebViewHandle = { injectJavaScript(script: string): void };
// react-native-webview 14 types WebView as a plain function component, which drops `ref`
// from its props although the native component still forwards it.
const WebView = UntypedRefWebView as unknown as React.ComponentType<
  WebViewProps & { ref?: React.Ref<WebViewHandle> }
>;

export interface PdfReader {
  /** Render this once in the screen. It is null whenever no read is under way. */
  readonly element: React.JSX.Element | null;
  read(bytes: Uint8Array, password?: string): Promise<PdfReadResult>;
  /** After `password_needed` / `wrong_password`. */
  unlock(password: string): Promise<PdfReadResult>;
  cancel(): void;
}

const hidden = { position: 'absolute', width: 1, height: 1, opacity: 0.01 } as const;

export function usePdfReader(): PdfReader {
  const [mounted, setMounted] = useState(false);
  const webView = useRef<WebViewHandle>(null);
  const session = useRef<PdfReadSession | null>(null);

  const teardown = useCallback(() => {
    session.current?.cancel();
    session.current = null;
    setMounted(false);
  }, []);

  // Leaving the screen mid-read stops it and drops the page.
  useEffect(() => teardown, [teardown]);

  /** Keep the page for a locked file; drop it for any other result. */
  const settled = useCallback(
    async (owner: PdfReadSession, pending: Promise<PdfReadResult>): Promise<PdfReadResult> => {
      const result = await pending;
      const locked =
        !result.ok && (result.reason === 'password_needed' || result.reason === 'wrong_password');
      // A newer read may have replaced this one; it is not ours to tear down.
      if (!locked && session.current === owner) teardown();
      return result;
    },
    [teardown],
  );

  const read = useCallback(
    (bytes: Uint8Array, password?: string) => {
      session.current?.cancel();
      const next = new PdfReadSession({
        send: (message: ToPage) => webView.current?.injectJavaScript(injectionFor(message)),
      });
      session.current = next;
      setMounted(true);
      return settled(next, next.start(bytes, password));
    },
    [settled],
  );

  const unlock = useCallback(
    (password: string) => {
      const current = session.current;
      if (!current) return Promise.resolve<PdfReadResult>({ ok: false, reason: 'unreadable' });
      return settled(current, current.retry(password));
    },
    [settled],
  );

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    session.current?.handle(event.nativeEvent.data);
  }, []);

  const onFailure = useCallback(() => {
    // The page failed to load or its process died: nothing to read with.
    session.current?.cancel();
  }, []);

  const element = useMemo(
    () =>
      mounted ? (
        <View pointerEvents="none" style={hidden} accessibilityElementsHidden>
          <WebView
            ref={webView}
            source={{ html: PDF_READER_HTML }}
            javaScriptEnabled
            domStorageEnabled={false}
            cacheEnabled={false}
            incognito
            allowFileAccess={false}
            allowsInlineMediaPlayback={false}
            javaScriptCanOpenWindowsAutomatically={false}
            setSupportMultipleWindows={false}
            onMessage={onMessage}
            onError={onFailure}
            onHttpError={onFailure}
            onContentProcessDidTerminate={onFailure}
            onRenderProcessGone={onFailure}
            style={{ width: 1, height: 1 }}
          />
        </View>
      ) : null,
    [mounted, onFailure, onMessage],
  );

  return useMemo(
    () => ({ element, read, unlock, cancel: teardown }),
    [element, read, unlock, teardown],
  );
}
