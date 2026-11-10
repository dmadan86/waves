/**
 * ota entrypoint — the thin `Deno.serve` shell. `verify_jwt = false` in
 * `supabase/config.toml`: devices ask for updates before (and without) any
 * session. The logic is in `handler.ts`; see `docs/ota.md`.
 */

import { serveWithCors } from '../_shared/auth.ts';
import { otaR2 } from '../_shared/r2.ts';
import { handleOta } from './handler.ts';

const URL_TTL_SECONDS = 3600;

function objectUrl(key: string): string {
  const { endpoint, bucket } = otaR2();
  return `${endpoint}/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

serveWithCors((request) =>
  handleOta(request, {
    privateKey: Deno.env.get('OTA_PRIVATE_KEY'),
    async getJson(key) {
      const response = await otaR2().client.fetch(objectUrl(key));
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) throw new Error(`R2 read failed: ${response.status}`);
      return await response.json();
    },
    async assetUrl(key) {
      // A public custom domain on the bucket is cheaper and cacheable; without
      // one, every asset gets a short-lived presigned GET.
      const base = Deno.env.get('OTA_ASSET_BASE_URL')?.replace(/\/+$/, '');
      if (base) return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
      const url = new URL(objectUrl(key));
      url.searchParams.set('X-Amz-Expires', String(URL_TTL_SECONDS));
      const signed = await otaR2().client.sign(new Request(url), { aws: { signQuery: true } });
      return signed.url;
    },
  }),
);
