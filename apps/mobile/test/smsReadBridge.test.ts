/**
 * The one-shot handoff of read message bodies between two screens: whatever it
 * holds is gone the moment it is taken, so a body can never be picked up twice.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { SmsMessage } from '@waves/core';

import { clearReadMessages, offerReadMessages, takeReadMessages } from '@/lib/smsReadBridge';

const message = (body: string): SmsMessage => ({ body }) as unknown as SmsMessage;

beforeEach(() => clearReadMessages());

describe('the read-messages handoff', () => {
  it('holds nothing until something is offered', () => {
    expect(takeReadMessages()).toBeNull();
  });

  it('hands the messages over once and is empty after', () => {
    offerReadMessages([message('Rs 250 debited'), message('Rs 90 debited')]);

    expect(takeReadMessages()).toEqual([message('Rs 250 debited'), message('Rs 90 debited')]);
    expect(takeReadMessages()).toBeNull();
  });

  it('keeps its own copy, so the caller changing its array later changes nothing', () => {
    const list = [message('Rs 250 debited')];
    offerReadMessages(list);
    list.push(message('Rs 1 debited'));

    expect(takeReadMessages()).toHaveLength(1);
  });

  it('drops an abandoned handoff without reading it', () => {
    offerReadMessages([message('Rs 250 debited')]);
    clearReadMessages();
    expect(takeReadMessages()).toBeNull();
  });
});
