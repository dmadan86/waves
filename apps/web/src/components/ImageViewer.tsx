'use client';

/**
 * Looking at one image, full screen.
 *
 * A bill is the thing people actually want to read — the line that says what
 * the ₹4,820 was — so a thumbnail is not enough and neither is a new tab, which
 * loses the page behind it. This is the viewer pattern from Photos and every
 * chat app: a dark backdrop, the image at its own aspect ratio, and the
 * controls floating over it rather than in a bar.
 *
 * The phone's version pinches and double-taps to zoom. A browser already has
 * zoom, so this offers the one thing a browser cannot do for itself: open the
 * original at full resolution in a new tab.
 *
 * Dialog behaviour is the part worth being careful about. Escape closes it, the
 * backdrop closes it, focus moves into it when it opens and returns to whatever
 * opened it when it closes, and while it is open the page behind does not
 * scroll — otherwise the ledger slides around under a full-screen image.
 */

import { useCallback, useEffect, useRef } from 'react';
import { ExternalLink, X } from 'lucide-react';

import { useStrings } from '@/i18n-context';

export function ImageViewer({
  url,
  alt,
  onClose,
}: {
  url: string;
  /** What the image is, for somebody who cannot see it. */
  alt: string;
  onClose: () => void;
}) {
  const { t } = useStrings();
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  // Whatever had focus when this opened, so it can be handed back on close.
  const opener = useRef<Element | null>(null);

  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    opener.current = document.activeElement;
    closeButton.current?.focus();

    const body = document.body;
    const scrollWas = body.style.overflow;
    body.style.overflow = 'hidden';

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      // A dialog keeps the keyboard inside it: tabbing past the last control
      // should reach the first, not the page underneath.
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = panel.current.querySelectorAll<HTMLElement>('button, a[href]');
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      body.style.overflow = scrollWas;
      // Back to the tile that opened this, so a keyboard does not land at the
      // top of the document every time somebody looks at a bill.
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [close]);

  return (
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      // The backdrop closes, but only when the backdrop itself was clicked —
      // a drag that ends outside the image should not count, and neither
      // should a click on the image.
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div ref={panel} className="viewer-panel">
        <div className="viewer-bar">
          <a
            className="viewer-button"
            href={url}
            target="_blank"
            rel="noreferrer"
            title={t.receipt.openOriginal}
          >
            <ExternalLink size={18} strokeWidth={1.75} aria-hidden />
            <span>{t.receipt.openOriginal}</span>
          </a>
          <button
            ref={closeButton}
            type="button"
            className="viewer-button"
            onClick={close}
            aria-label={t.receipt.close}
            title={t.receipt.close}
          >
            <X size={20} strokeWidth={2} aria-hidden />
          </button>
        </div>

        {/* A signed URL from a private bucket: next/image would need the host
            allow-listed and would proxy bytes it has no business proxying. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="viewer-image" src={url} alt={alt} />
      </div>
    </div>
  );
}
