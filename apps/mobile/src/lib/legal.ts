/**
 * The published Terms and Privacy Policy, on the website, in the app's
 * language. These are the documents the stores ask a paywall and a sign-in
 * screen to link to; the in-app Privacy screen is settings, not the policy.
 */

import * as WebBrowser from 'expo-web-browser';

import { reportHandled } from './observability';

const SITE = 'https://wavs.co.in';
/** The languages the site publishes these pages in; anything else gets English. */
const SITE_LANGUAGES = new Set(['en', 'ta', 'hi', 'ar']);

export type LegalDoc = 'terms' | 'privacy';

export function legalUrl(doc: LegalDoc, language: string): string {
  const lang = SITE_LANGUAGES.has(language) ? language : 'en';
  return `${SITE}/${lang}/${doc}`;
}

/** Open the page in an in-app browser sheet. */
export function openLegal(doc: LegalDoc, language: string): void {
  WebBrowser.openBrowserAsync(legalUrl(doc, language)).catch((error: unknown) => {
    reportHandled(error, `legal.open.${doc}`);
  });
}
