import { describe, expect, it } from 'vitest';
import { agentClientId } from '../src/lib/agentToken';

function token(payload: unknown): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

describe('agentClientId (after JWT verification)', () => {
  it('reads the OAuth client ID, including Unicode', () => {
    expect(agentClientId(token({ client_id: 'assistant-α' }))).toBe('assistant-α');
  });
  it.each([
    {},
    { client_id: '' },
    { client_id: '  ' },
    { client_id: 123 },
    { client_id: null },
    null,
    [],
    'client_id',
  ])('rejects non-agent payload %j', (payload) => {
    expect(agentClientId(token(payload))).toBeNull();
  });
  it.each(['', 'invalid', 'a.%.b', 'a.b.c', 'a.e30', 'a.e30.b.extra'])(
    'rejects malformed token %j',
    (value) => {
      expect(agentClientId(value)).toBeNull();
    },
  );
});
