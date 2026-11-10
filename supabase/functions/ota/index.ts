/**
 * ota entrypoint — the thin `Deno.serve` shell. `verify_jwt = false` in
 * `supabase/config.toml`: devices ask for updates before (and without) any
 * session. It only reads the OTA bucket; the logic is in `handler.ts`.
 */

import { serveWithCors } from '../_shared/auth.ts';
import { otaR2 } from '../_shared/r2.ts';
import { handleOta } from './handler.ts';

serveWithCors((request) =>
  handleOta(request, {
    async getText(key) {
      const { client, endpoint, bucket } = otaR2();
      const path = key.split('/').map(encodeURIComponent).join('/');
      const response = await client.fetch(`${endpoint}/${bucket}/${path}`);
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) throw new Error(`R2 read failed: ${response.status}`);
      return await response.text();
    },
  }),
);
