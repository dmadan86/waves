import { describe, expect, it } from 'vitest';
import { runRemoveDemo } from '../src/demo/removeDemoPure';

describe('demo removal', () => {
  it('confirms and navigates before removing the demo', async () => {
    const order: string[] = [];
    const removed = await runRemoveDemo(
      async () => {
        order.push('confirm');
        return true;
      },
      () => {
        order.push('onConfirmed');
      },
      async () => {
        order.push('remove');
      },
    );
    expect(removed).toBe(true);
    expect(order).toEqual(['confirm', 'onConfirmed', 'remove']);
  });
  it('does not navigate or remove when cancelled', async () => {
    const order: string[] = [];
    const removed = await runRemoveDemo(
      async () => {
        order.push('confirm');
        return false;
      },
      () => {
        order.push('onConfirmed');
      },
      async () => {
        order.push('remove');
      },
    );
    expect(removed).toBe(false);
    expect(order).toEqual(['confirm']);
  });
});
