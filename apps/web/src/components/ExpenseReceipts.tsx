'use client';

/**
 * The bill behind an expense (E2), and anything attached to it since (A44).
 *
 * The web could not show a receipt at all, which is the wrong way round: a
 * laptop is a far better place to read a printed bill than a phone, and "what
 * was this ₹4,820" is usually answered by looking at the thing rather than by
 * discussing it.
 *
 * Two kinds of image land here and they are gated differently, which is why
 * they resolve differently:
 *
 * - **The kept receipt** hangs off the expense version and is group-readable:
 *   a bill everybody is paying a share of is not a private document. It
 *   resolves by path.
 * - **Attachments** may be `group` or `parties`. The RLS policy decides which
 *   rows come back at all, and the party-only ones are addressed by *subject*
 *   so the edge function re-checks membership before it signs anything. Those
 *   live only on R2, so with R2 off they are simply not there yet — which is
 *   said out loud rather than shown as a broken tile.
 *
 * There is also `receipt_share_url` (E3) — a link to the author's own cloud
 * copy. It is not ours and not signed by us, so it is offered as a link out and
 * never loaded as an image.
 *
 * Nothing here uploads. The browser reads bills; the phone still keeps them.
 */

import { useEffect, useState } from 'react';
import { ExternalLink, ImageOff, Receipt as ReceiptIcon } from 'lucide-react';

import type { ExpenseVersion } from '@waves/api-client';

import { ImageViewer } from '@/components/ImageViewer';
import { useStrings } from '@/i18n-context';
import { waves } from '@/lib/waves';

interface Tile {
  key: string;
  /** Resolved lazily; `undefined` is "still resolving", `null` is "gone". */
  url: string | null | undefined;
  label: string;
  partyOnly: boolean;
}

export function ExpenseReceipts({
  expenseId,
  version,
}: {
  expenseId: string;
  version: ExpenseVersion;
}) {
  const { t } = useStrings();
  const [tiles, setTiles] = useState<Tile[] | null>(null);
  const [open, setOpen] = useState<Tile | null>(null);

  const receiptId = version.receipt_id ?? null;
  const shareUrl = version.receipt_share_url ?? null;

  useEffect(() => {
    let active = true;

    void (async () => {
      const found: Tile[] = [];

      // The kept bill, if there is one. A receipt row with no path is a scan
      // that never finished uploading; it is not a tile.
      if (receiptId) {
        const row = await waves.receipt(receiptId).catch(() => null);
        if (row?.storage_path) {
          const url = await waves.imageUrl('receipts', row.storage_path);
          found.push({
            key: `receipt-${row.id}`,
            url,
            label: t.receipt.theBill,
            partyOnly: false,
          });
        }
      }

      // Anything attached since. A row that comes back is a row this reader is
      // allowed to see — the policy already decided that.
      const attachments = await waves.expenseAttachments(expenseId).catch(() => []);
      for (const row of attachments) {
        const url =
          row.visibility === 'parties'
            ? await waves.restrictedImageUrl('expense-attachments', expenseId, row.storage_path)
            : await waves.imageUrl('expense-attachments', row.storage_path);
        found.push({
          key: `attachment-${row.id}`,
          url,
          label: row.visibility === 'parties' ? t.receipt.partyOnly : t.receipt.attachment,
          partyOnly: row.visibility === 'parties',
        });
      }

      if (active) setTiles(found);
    })();

    return () => {
      active = false;
    };
  }, [expenseId, receiptId, t.receipt.theBill, t.receipt.attachment, t.receipt.partyOnly]);

  // Nothing kept and nothing linked: the panel does not appear at all. An empty
  // "Receipt" heading on every expense that never had one is noise on the
  // screen people read most.
  if (tiles !== null && tiles.length === 0 && !shareUrl) return null;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t.receipt.title}</h2>
      </div>

      {tiles === null ? (
        <div className="receipt-grid">
          <span className="sk receipt-tile" />
        </div>
      ) : (
        <div className="receipt-grid">
          {tiles.map((tile) => (
            <ReceiptTile key={tile.key} tile={tile} onOpen={() => setOpen(tile)} />
          ))}
        </div>
      )}

      {shareUrl ? (
        <a
          className="btn soft receipt-share"
          href={shareUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          <ExternalLink size={16} strokeWidth={1.75} aria-hidden />
          {t.receipt.openShared}
        </a>
      ) : null}

      {open?.url ? (
        <ImageViewer url={open.url} alt={open.label} onClose={() => setOpen(null)} />
      ) : null}
    </section>
  );
}

function ReceiptTile({ tile, onOpen }: { tile: Tile; onOpen: () => void }) {
  const { t } = useStrings();

  // Resolved to nothing: the image is on a backend this browser cannot reach
  // (a party-only attachment with R2 off), or it has been removed. Either way
  // it is a stated absence, not a broken tile.
  if (tile.url === null) {
    return (
      <div className="receipt-tile is-missing">
        <ImageOff size={20} strokeWidth={1.75} aria-hidden />
        <span>{tile.partyOnly ? t.receipt.notAvailableHere : t.receipt.missing}</span>
      </div>
    );
  }

  if (tile.url === undefined) return <span className="sk receipt-tile" />;

  return (
    <button type="button" className="receipt-tile" onClick={onOpen}>
      {/* A signed URL from a private bucket — see ImageViewer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={tile.url} alt={tile.label} loading="lazy" />
      <span className="receipt-tile-label">
        <ReceiptIcon size={13} strokeWidth={2} aria-hidden />
        {tile.label}
      </span>
    </button>
  );
}
