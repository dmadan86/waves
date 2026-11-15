/**
 * Navigation guard for the hidden PDF-reader WebView.
 *
 * The WebView loads a local HTML document (`source={{ html: ... }}`). On both
 * iOS and Android react-native-webview represents an html-source load as
 * either `about:blank` (the initial synthetic frame) or `data:text/html,...`
 * (the actual content frame). Every other URL is an attempted navigation away
 * from the sandboxed page and must be blocked.
 *
 * This predicate is exported so it can be unit-tested without a WebView.
 */

/**
 * Returns true when the navigation request is the WebView loading its own
 * html-source document, false for every other URL (external navigations,
 * javascript: URIs, etc.).
 *
 * Safe to use as the `onShouldStartLoadWithRequest` callback — React Native
 * WebView will call `navigate` only when this returns `true`.
 */
export function isAllowedReaderUrl(url: string): boolean {
  return url === 'about:blank' || url.startsWith('data:text/html');
}
