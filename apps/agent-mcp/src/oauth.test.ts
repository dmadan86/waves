/**
 * The two documents a remote MCP server publishes about who may call it.
 *
 * Every mistake available here fails the same way from outside: a client
 * refuses to connect and says nothing useful about why, because a client that
 * cannot discover an authorization server has nothing to report. Hence tests
 * for shapes rather than for behaviour.
 */

import { describe, expect, it } from 'vitest';

import { bearerToken, challengeHeader, metadataUrlFor, protectedResourceMetadata } from './oauth';

describe('the protected-resource document', () => {
  const metadata = protectedResourceMetadata(
    'https://app.wavs.co.in/api/mcp',
    'https://project.supabase.co',
  );

  it('names itself by the URL clients actually call', () => {
    // Checked against the token audience. A trailing slash is a mismatch, and
    // a mismatch is reported as an opaque refusal.
    expect(metadata.resource).toBe('https://app.wavs.co.in/api/mcp');
  });

  it('sends clients to Supabase for a token', () => {
    expect(metadata.authorization_servers).toEqual(['https://project.supabase.co']);
  });

  it('tolerates trailing slashes on the way in, never on the way out', () => {
    const sloppy = protectedResourceMetadata(
      'https://app.wavs.co.in/api/mcp/',
      'https://project.supabase.co/',
    );
    expect(sloppy.resource).toBe('https://app.wavs.co.in/api/mcp');
    expect(sloppy.authorization_servers).toEqual(['https://project.supabase.co']);
  });

  it('accepts the token in a header and nowhere else', () => {
    // A token in a query string ends up in server logs and browser history.
    expect(metadata.bearer_methods_supported).toEqual(['header']);
  });
});

describe('where the document lives', () => {
  it('puts the well-known segment before the path, not after it', () => {
    // RFC 9728 §3. Appending it to the path instead produces a URL every
    // compliant client will look straight past.
    expect(metadataUrlFor('https://app.wavs.co.in/api/mcp')).toBe(
      'https://app.wavs.co.in/.well-known/oauth-protected-resource/api/mcp',
    );
  });

  it('leaves nothing dangling for an endpoint at the root', () => {
    expect(metadataUrlFor('https://mcp.example.com/')).toBe(
      'https://mcp.example.com/.well-known/oauth-protected-resource',
    );
  });
});

describe('the refusal that tells a client what to do next', () => {
  it('points at the metadata, which is the whole discovery mechanism', () => {
    expect(challengeHeader('https://x/.well-known/oauth-protected-resource/api/mcp')).toBe(
      'Bearer resource_metadata="https://x/.well-known/oauth-protected-resource/api/mcp"',
    );
  });

  it('names the error when there is one to name', () => {
    expect(challengeHeader('https://x/meta', 'invalid_token')).toContain('error="invalid_token"');
  });
});

describe('reading the token off a request', () => {
  it('takes the token out of a bearer header', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('does not care how the client cased the scheme', () => {
    expect(bearerToken('bearer abc')).toBe('abc');
  });

  it('is nothing when there is no header, or nothing in it', () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken('Bearer   ')).toBeNull();
    expect(bearerToken('Basic abc')).toBeNull();
  });
});
