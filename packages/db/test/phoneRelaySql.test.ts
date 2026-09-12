/**
 * Static guards for the phone OTP relay migrations.
 *
 * The live DB integration suite covers these rules when Postgres is available,
 * but this audit environment may not have the local service. These assertions
 * keep the migration text from regressing on the concurrency contract: one phone
 * may have only one live Firebase→GoTrue exchange, and every claim/close must
 * name the exchange it owns.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const originalRelayMigration = readFileSync(
  join(__dirname, '../prisma/migrations/20260912120000_otp_relay/migration.sql'),
  'utf8',
);
const concurrentRelayMigration = readFileSync(
  join(__dirname, '../prisma/migrations/20260912160000_refuse_concurrent_phone_relay/migration.sql'),
  'utf8',
);

describe('phone OTP relay SQL', () => {
  it('refuses a second live exchange instead of replacing it', () => {
    expect(concurrentRelayMigration).toContain('CREATE OR REPLACE FUNCTION public.waves_otp_relay_open');
    expect(concurrentRelayMigration).toContain("LANGUAGE plpgsql SECURITY DEFINER");
    expect(concurrentRelayMigration).toContain(
      "WHERE public.otp_relay.requested_at <= now() - interval '30 seconds'",
    );
    expect(concurrentRelayMigration).toContain(
      'OTP_RELAY_BUSY: an exchange is already open for this phone',
    );
  });

  it('keeps claim and close scoped to the exchange owner', () => {
    expect(originalRelayMigration).toContain(
      'CREATE FUNCTION public.waves_otp_relay_claim(p_phone text, p_exchange uuid)',
    );
    expect(originalRelayMigration).toContain('AND exchange = p_exchange');
    expect(originalRelayMigration).toContain(
      'CREATE FUNCTION public.waves_otp_relay_close(p_phone text, p_exchange uuid)',
    );
    expect(originalRelayMigration).toContain(
      'DELETE FROM public.otp_relay WHERE phone = p_phone AND exchange = p_exchange',
    );
  });
});
