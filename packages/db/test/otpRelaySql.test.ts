/**
 * Static guards for the OTP relay migration.
 *
 * The integration suite exercises database behaviour when Postgres is running,
 * but this branch is often audited on machines without the local service. These
 * assertions pin the critical concurrency contract in the migration text: one
 * phone may have only one live Firebase→GoTrue exchange, and a second live open
 * must refuse instead of replacing the first row.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const originalMigration = readFileSync(
  join(__dirname, '../prisma/migrations/20260912120000_otp_relay/migration.sql'),
  'utf8',
);
const followupMigration = readFileSync(
  join(__dirname, '../prisma/migrations/20260912150000_refuse_concurrent_otp_relay/migration.sql'),
  'utf8',
);

describe('otp relay migration SQL', () => {
  it('refuses a second live exchange instead of replacing it', () => {
    expect(followupMigration).toContain("LANGUAGE plpgsql SECURITY DEFINER");
    expect(followupMigration).toContain(
      "WHERE public.otp_relay.requested_at <= now() - interval '30 seconds'",
    );
    expect(followupMigration).toContain('OTP_RELAY_BUSY: an exchange is already open for this phone');
  });

  it('requires claim and close to name the exchange they own', () => {
    expect(originalMigration).toContain(
      'CREATE FUNCTION public.waves_otp_relay_claim(p_phone text, p_exchange uuid)',
    );
    expect(originalMigration).toContain('AND exchange = p_exchange');
    expect(originalMigration).toContain(
      'CREATE FUNCTION public.waves_otp_relay_close(p_phone text, p_exchange uuid)',
    );
    expect(originalMigration).toContain(
      'DELETE FROM public.otp_relay WHERE phone = p_phone AND exchange = p_exchange',
    );
  });
});
