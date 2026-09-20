#!/usr/bin/env bash
# Upload every file in this directory to the public artwork bucket.
#
# Public artwork only. Never point this at the private image bucket: that one is
# reached through the r2-sign edge function and its objects are per-person.
set -euo pipefail

BUCKET="${WAVES_ART_BUCKET:-waves-art}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

find "$ROOT" -type f \( -name '*.webp' -o -name '*.png' -o -name '*.svg' \) -print0 |
  while IFS= read -r -d '' file; do
    key="${file#"$ROOT"/}"
    case "$key" in
      *.webp) type="image/webp" ;;
      *.png) type="image/png" ;;
      *.svg) type="image/svg+xml" ;;
      *) continue ;;
    esac
    echo "→ $key"
    # A year of caching: the key is the identity of the picture, and a redraw is
    # published over it, so a stale copy costs at most one refresh cycle.
    wrangler r2 object put "$BUCKET/$key" \
      --file "$file" \
      --content-type "$type" \
      --cache-control "public, max-age=31536000, immutable" \
      --remote
  done

echo "done. Public base: wrangler r2 bucket dev-url get $BUCKET"
