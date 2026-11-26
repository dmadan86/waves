import { describe, expect, it } from 'vitest';

import { createSubmitGuard } from '../src/lib/submitGuard';

describe('createSubmitGuard', () => {
  const counter = () => {
    let n = 0;
    return () => `id-${++n}`;
  };

  it('ignores a second submit while the first is in flight', async () => {
    const guard = createSubmitGuard(counter());
    const sent: string[] = [];
    let release!: () => void;
    const first = guard.run('save', async (id) => {
      sent.push(id);
      await new Promise<void>((resolve) => (release = resolve));
    });
    const second = await guard.run('save', async (id) => {
      sent.push(id);
    });
    expect(second).toBeUndefined();
    release();
    await first;
    expect(sent).toEqual(['id-1']);
  });

  it('reuses the id for a retry of the same intent after a failure, then mints a new one', async () => {
    const guard = createSubmitGuard(counter());
    const sent: string[] = [];
    await guard
      .run('save', async (id) => {
        sent.push(id);
        throw new Error('offline');
      })
      .catch(() => undefined);
    await guard.run('save', async (id) => void sent.push(id));
    await guard.run('save', async (id) => void sent.push(id));
    expect(sent).toEqual(['id-1', 'id-1', 'id-2']);
  });
});
