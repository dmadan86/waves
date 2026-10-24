import { describe, expect, it } from 'vitest';

import { isVoiceAssistantRequest } from '@/lib/voiceAssistantRequest';

describe('basic voice assistant request detection', () => {
  it.each([
    'Who owes me?',
    ' WHO owes me ',
    'What did I spend',
    'How much did I spend',
    'When did I pay',
    'Where did I spend',
    'Why is my balance negative',
    'Show my expenses',
    'List expenses over 500',
    'Can you help me',
    'Please show my balance',
    'Hey Waves, tell me my balance',
    'My balance?  ',
    '“Who owes me?”',
  ])('recognizes %s', (words) => {
    expect(isVoiceAssistantRequest(words)).toBe(true);
  });

  it.each([
    '',
    '  ',
    'Coffee 50',
    'Dinner 500 with Sam',
    'Paid 200 for a show',
    'Wholesale groceries 100',
    '500 for what we ate',
    'Can you please add 500 for tea shop',
  ])('keeps expenses: %s', (words) => {
    expect(isVoiceAssistantRequest(words)).toBe(false);
  });
});
