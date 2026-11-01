import { describe, expect, it } from 'vitest';
import { pkceChallenge, randomString } from '../bimcollab';

describe('PKCE', () => {
  it('creates the RFC 7636 S256 challenge', async () => {
    // test vector from RFC 7636 appendix B
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('creates url-safe verifiers', () => {
    const v = randomString(64);
    expect(v).toHaveLength(64);
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
