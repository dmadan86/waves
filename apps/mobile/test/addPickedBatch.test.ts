import { describe, expect, it } from 'vitest';

import { addPickedBatch } from '../src/lib/addPickedBatch';

const messages = (caught: unknown): string => `failed: ${String(caught)}`;

describe('addPickedBatch', () => {
  it('reports every name when each add is rejected', async () => {
    const out = await addPickedBatch(
      [{ name: 'Asha' }, { name: 'Ravi' }],
      () => Promise.reject(new Error('boom')),
      messages,
    );
    expect(out.failed).toEqual(['Asha', 'Ravi']);
    expect(out.reason).not.toBe('');
  });

  it('keeps the ones that landed and reports only the failure', async () => {
    const added: string[] = [];
    const out = await addPickedBatch(
      [{ name: 'Asha' }, { name: 'Ravi' }],
      (p) => {
        if (p.name === 'Ravi') return Promise.reject(new Error('boom'));
        added.push(p.name);
        return Promise.resolve();
      },
      messages,
    );
    expect(added).toEqual(['Asha']);
    expect(out.failed).toEqual(['Ravi']);
  });

  it('reports nothing when all succeed', async () => {
    const out = await addPickedBatch([{ name: 'A' }], () => Promise.resolve(), messages);
    expect(out).toEqual({ failed: [], reason: '' });
  });
});
