import { generateKeyPairSync } from 'node:crypto';

import { LocalSecretOpener, LocalSecretSealer } from './secret-cipher.js';

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

describe('local secret cipher', () => {
  const first = keyPair();
  const second = keyPair();

  it('round-trips a secret bound to its AAD', () => {
    const sealer = new LocalSecretSealer(first.publicPem);
    const sealed = sealer.seal(Buffer.from('{"token":"abc"}'), 'a|p|c');
    expect(sealed.ciphertext.toString('utf8')).not.toContain('abc');
    const opener = new LocalSecretOpener([first.privatePem]);
    expect(opener.open(sealed, 'a|p|c').toString('utf8')).toBe('{"token":"abc"}');
  });

  it('refuses a ciphertext moved to another row', () => {
    const sealed = new LocalSecretSealer(first.publicPem).seal(Buffer.from('x'), 'a|p|c1');
    const opener = new LocalSecretOpener([first.privatePem]);
    expect(() => opener.open(sealed, 'a|p|c2')).toThrow();
  });

  it('opens secrets of an old KEK after rotation and rejects unknown KEKs', () => {
    const old = new LocalSecretSealer(first.publicPem).seal(Buffer.from('old'), 'x');
    const opener = new LocalSecretOpener([second.privatePem, first.privatePem]);
    expect(opener.open(old, 'x').toString()).toBe('old');
    expect(() => new LocalSecretOpener([second.privatePem]).open(old, 'x')).toThrow(/not loaded/);
  });

  it('uses a fresh data key per secret', () => {
    const sealer = new LocalSecretSealer(first.publicPem);
    const a = sealer.seal(Buffer.from('same'), 'x');
    const b = sealer.seal(Buffer.from('same'), 'x');
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.kekId).toBe(b.kekId);
  });
});
