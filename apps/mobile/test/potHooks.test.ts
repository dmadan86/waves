import { describe, expect, it, vi } from 'vitest';
import {
  usePots,
  useCreatePot,
  useRecordPotContribution,
  useConfirmPotContribution,
  useClosePot,
  useCarryPot,
} from '../src/data/pots';

const mocks = vi.hoisted(() => ({
  query: vi.fn((options: unknown) => options),
  mutation: vi.fn((options: unknown) => options),
  invalidate: vi.fn().mockResolvedValue(undefined),
  flush: vi.fn().mockResolvedValue(undefined),
  api: {
    listPots: vi.fn().mockResolvedValue([]),
    createPot: vi.fn().mockResolvedValue('new'),
    recordPotContribution: vi.fn().mockResolvedValue('payment'),
    confirmPotContribution: vi.fn().mockResolvedValue(undefined),
    closePot: vi.fn().mockResolvedValue('closed'),
    carryPot: vi.fn().mockResolvedValue('next'),
  },
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: mocks.query,
  useMutation: mocks.mutation,
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock('@waves/api-client', () => ({ createWavesClient: () => mocks.api }));
vi.mock('../src/lib/backend', () => ({ backend: {} }));
vi.mock('../src/sync', () => ({ useSync: () => ({ flush: mocks.flush }) }));

type Mutation<T> = { mutationFn: (input: T) => Promise<unknown>; onSuccess: () => Promise<void> };

describe('pot hooks', () => {
  it('scopes reads and waits for a group id', async () => {
    const query = usePots('g') as unknown as {
      queryKey: string[];
      queryFn: () => Promise<unknown>;
      enabled: boolean;
    };
    expect(query.queryKey).toEqual(['group', 'g', 'pots']);
    await query.queryFn();
    expect(mocks.api.listPots).toHaveBeenCalledWith('g');
    expect((usePots('') as unknown as { enabled: boolean }).enabled).toBe(false);
  });
  it('retains retry identity and refreshes the pot query and ordinary ledger after a write', async () => {
    const hook = useCreatePot('g') as unknown as Mutation<{
      name: string;
      clientMutationId: string;
    }>;
    await hook.mutationFn({ name: 'Lunch', clientMutationId: 'stable' });
    expect(mocks.api.createPot).toHaveBeenCalledWith({
      groupId: 'g',
      name: 'Lunch',
      clientMutationId: 'stable',
    });
    await hook.onSuccess();
    expect(mocks.flush).toHaveBeenCalled();
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ['group', 'g'] });
  });
  it('keeps self-report and the receipt tick separate', async () => {
    mocks.api.confirmPotContribution.mockClear();
    const report = useRecordPotContribution('g') as unknown as Mutation<{
      clientMutationId: string;
    }>;
    await report.mutationFn({ clientMutationId: 'stable' });
    expect(mocks.api.confirmPotContribution).not.toHaveBeenCalled();
    const confirm = useConfirmPotContribution('g') as unknown as Mutation<string>;
    await confirm.mutationFn('pending-id');
    expect(mocks.api.confirmPotContribution).toHaveBeenCalledWith('pending-id');
  });
  it('delegates closing and pins carry-forward to the current group', async () => {
    const close = useClosePot('g') as unknown as Mutation<{
      potId: string;
      clientMutationId: string;
    }>;
    await close.mutationFn({ potId: 'p', clientMutationId: 'close' });
    expect(mocks.api.closePot).toHaveBeenCalledWith({ potId: 'p', clientMutationId: 'close' });
    const carry = useCarryPot('g') as unknown as Mutation<{
      potId: string;
      name: string;
      clientMutationId: string;
    }>;
    await carry.mutationFn({ potId: 'p', name: 'Next', clientMutationId: 'carry' });
    expect(mocks.api.carryPot).toHaveBeenCalledWith({
      potId: 'p',
      groupId: 'g',
      name: 'Next',
      clientMutationId: 'carry',
    });
  });
});
