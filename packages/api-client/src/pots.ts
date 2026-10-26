import type { SupabaseClient } from '@supabase/supabase-js';

export type PotStatus = 'open' | 'closed' | 'carried';
export type PotReferenceSource = 'self' | 'sms' | 'statement' | 'intent';
export interface PotRow {
  id: string;
  group_id: string;
  name: string;
  currency: string;
  per_head_minor: string;
  treasurer_member_id: string;
  status: PotStatus;
  carried_from_pot_id: string | null;
  created_by: string;
  created_at: string;
  closed_at: string | null;
  pay_code: string;
}
export interface PotContributionRow {
  id: string;
  pot_id: string;
  from_member_id: string;
  to_member_id: string;
  currency: string;
  amount: string;
  status: 'initiated' | 'confirmed' | 'auto_confirmed' | 'disputed' | 'cancelled';
  reference: string | null;
  reference_source: PotReferenceSource | null;
  initiated_at: string;
  confirmed_at: string | null;
}
/** Includes refunds/top-ups too: direction relative to the treasurer matters. */
export type PotWithContributions = PotRow & { contributions: PotContributionRow[] };
export interface CreatePotInput {
  groupId: string;
  name: string;
  currency: string;
  perHeadMinor: bigint;
  treasurerMemberId: string;
  clientMutationId: string;
}
export interface RecordPotContributionInput {
  potId: string;
  fromMemberId: string;
  toMemberId: string;
  amount: bigint;
  clientMutationId: string;
  reference?: string | null;
  referenceSource?: PotReferenceSource | null;
}
export interface PotMutationInput {
  potId: string;
  clientMutationId: string;
}
export interface CarryPotInput extends PotMutationInput {
  groupId: string;
  name: string;
}
export interface PotPayInfo {
  potName: string;
  groupName: string | null;
  perHeadMinor: string;
  payeeName: string;
  payeeVpa: string | null;
  currency: string;
}

/** A form must use this payer map whenever spending from a pot. */
export function potExpensePayers(
  pot: Pick<PotRow, 'id' | 'status' | 'treasurer_member_id' | 'currency'>,
  amount: bigint,
  currency: string,
): { potId: string; payers: Record<string, bigint> } {
  if (pot.status !== 'open') throw new Error('POT_NOT_OPEN');
  if (amount <= 0n || currency !== pot.currency) throw new Error('POT_INVALID_EXPENSE');
  return { potId: pot.id, payers: { [pot.treasurer_member_id]: amount } };
}

export function createPotApi(
  supabase: SupabaseClient,
  rpc: <T>(name: string, args: Record<string, unknown>) => Promise<T>,
) {
  return {
    createPot(input: CreatePotInput): Promise<string> {
      return rpc('waves_create_pot', {
        p_group_id: input.groupId,
        p_name: input.name,
        p_currency: input.currency,
        p_per_head_minor: input.perHeadMinor.toString(),
        p_treasurer_member_id: input.treasurerMemberId,
        p_client_mutation_id: input.clientMutationId,
      });
    },
    /** Self-report only. Native intent/SMS/statement references never confirm receipt. */
    recordPotContribution(input: RecordPotContributionInput): Promise<string> {
      return rpc('waves_record_pot_settlement', {
        p_pot_id: input.potId,
        p_from_member_id: input.fromMemberId,
        p_to_member_id: input.toMemberId,
        p_amount: input.amount.toString(),
        p_client_mutation_id: input.clientMutationId,
        p_reference: input.reference ?? null,
        p_reference_source: input.referenceSource ?? 'self',
      });
    },
    /** Treasurer ticks an existing pending contribution; server checks the payee. */
    confirmPotContribution(settlementId: string): Promise<void> {
      return rpc('waves_confirm_settlement', { p_settlement_id: settlementId }).then(
        () => undefined,
      );
    },
    closePot(input: PotMutationInput): Promise<string> {
      return rpc('waves_close_pot', {
        p_pot_id: input.potId,
        p_client_mutation_id: input.clientMutationId,
      });
    },
    carryPot(input: CarryPotInput): Promise<string> {
      return rpc('waves_carry_pot', {
        p_pot_id: input.potId,
        p_group_id: input.groupId,
        p_name: input.name,
        p_client_mutation_id: input.clientMutationId,
      });
    },
    async listPots(groupId: string): Promise<PotWithContributions[]> {
      const { data, error } = await supabase
        .from('pots')
        .select(
          `
        id, group_id, name, currency, per_head_minor, treasurer_member_id, status,
        carried_from_pot_id, created_by, created_at, closed_at, pay_code,
        contributions:settlements!settlements_pot_id_fkey (
          id, pot_id, from_member_id, to_member_id, currency, amount, status,
          reference, reference_source, initiated_at, confirmed_at
        )
      `,
        )
        .eq('group_id', groupId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as PotWithContributions[];
    },
    potPayLookup(code: string): Promise<PotPayInfo | null> {
      return rpc('pot_pay_lookup', { code });
    },
    potPaySelfReport(code: string, payerName: string, utr: string): Promise<boolean> {
      return rpc('pot_pay_self_report', { code, payer_name: payerName, utr });
    },
  };
}
