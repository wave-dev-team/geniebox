import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';

import { flushRedis, uniqueEmail } from '../support/helpers.js';
import { ApiHarness, type TokenPair } from '../support/http-app.js';

const PASSWORD = 'correct horse battery';

interface Signer {
  sign(claims: Record<string, unknown>): Promise<string>;
}

async function oidcProvider(
  issuer: string,
  audience: string,
): Promise<{ jwks: { keys: JWK[] }; signer: Signer }> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'e2e', alg: 'RS256' };
  return {
    jwks: { keys: [jwk] },
    signer: {
      sign: (claims) =>
        new SignJWT(claims)
          .setProtectedHeader({ alg: 'RS256', kid: 'e2e' })
          .setIssuer(issuer)
          .setAudience((claims.aud as string | undefined) ?? audience)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(privateKey),
    },
  };
}

describe('auth (HTTP)', () => {
  let api: ApiHarness;
  let google: Signer;
  let apple: Signer;

  beforeAll(async () => {
    await flushRedis();
    const g = await oidcProvider('https://accounts.google.com', 'e2e-google-client');
    const a = await oidcProvider('https://appleid.apple.com', 'e2e.apple.service');
    google = g.signer;
    apple = a.signer;
    api = await ApiHarness.create({
      google: createLocalJWKSet(g.jwks),
      apple: createLocalJWKSet(a.jwks),
    });
  });

  afterAll(async () => {
    await api.close();
  });

  it('rejects protected routes without a valid access token', async () => {
    await api.get('/v1/me').expect(401);
    const response = await api.get('/v1/me', 'not-a-jwt').expect(401);
    expect(response.body).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  describe('email + password', () => {
    const email = uniqueEmail('pwd');

    it('registers, then verifies the email with the mailed code', async () => {
      const before = api.mail.sent.length;
      const registered = await api
        .post('/v1/auth/register', {
          email: email.toUpperCase(),
          password: PASSWORD,
          displayName: 'Виктор',
        })
        .expect(201);
      const tokens = registered.body as TokenPair;
      expect(tokens.created).toBe(true);

      const me = await api.get('/v1/me', tokens.accessToken).expect(200);
      expect(me.body).toMatchObject({
        email,
        emailVerified: false,
        hasPassword: true,
        displayName: 'Виктор',
      });

      const code = await api.code(email, before);
      await api.post('/v1/auth/email/verification/confirm', { code }, tokens.accessToken).expect(204);
      const verified = await api.get('/v1/me', tokens.accessToken).expect(200);
      expect(verified.body).toMatchObject({ emailVerified: true });
    });

    it('does not register the same email twice', async () => {
      const response = await api.post('/v1/auth/register', { email, password: PASSWORD }).expect(409);
      expect(response.body).toMatchObject({ code: 'EMAIL_TAKEN' });
    });

    it('signs in with the right password only', async () => {
      const wrong = await api.post('/v1/auth/login', { email, password: 'wrong password!' }).expect(401);
      expect(wrong.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
      const unknown = await api
        .post('/v1/auth/login', { email: uniqueEmail('ghost'), password: PASSWORD })
        .expect(401);
      expect(unknown.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
      await api.post('/v1/auth/login', { email, password: PASSWORD }).expect(200);
    });

    it('locks password sign-in for an email after repeated failures', async () => {
      const victim = uniqueEmail('lock');
      await api.post('/v1/auth/register', { email: victim, password: PASSWORD }).expect(201);
      for (let i = 0; i < 10; i += 1) {
        await api.post('/v1/auth/login', { email: victim, password: 'wrong password!' }).expect(401);
      }
      const locked = await api.post('/v1/auth/login', { email: victim, password: PASSWORD }).expect(429);
      expect(locked.body).toMatchObject({ code: 'TOO_MANY_LOGIN_ATTEMPTS' });
    });

    it('validates input and rejects unknown fields', async () => {
      const response = await api
        .post('/v1/auth/register', { email: 'bad', password: 'short', admin: true })
        .expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('email code', () => {
    it('signs up on first use and signs in afterwards', async () => {
      const email = uniqueEmail('code');
      const first = await api.signInWithCode(email);
      expect(first.created).toBe(true);
      const me = await api.get('/v1/me', first.accessToken).expect(200);
      expect(me.body).toMatchObject({ email, emailVerified: true, hasPassword: false });

      const second = await api.signInWithCode(email);
      expect(second).toMatchObject({ created: false, userId: first.userId });
    });

    it('accepts a code once and rejects wrong codes', async () => {
      const email = uniqueEmail('once');
      const before = api.mail.sent.length;
      await api.post('/v1/auth/email-code', { email }).expect(202);
      const code = await api.code(email, before);
      const wrong = code === '000000' ? '111111' : '000000';
      const rejected = await api.post('/v1/auth/email-code/verify', { email, code: wrong }).expect(400);
      expect(rejected.body).toMatchObject({ code: 'INVALID_CODE' });
      await api.post('/v1/auth/email-code/verify', { email, code }).expect(200);
      await api.post('/v1/auth/email-code/verify', { email, code }).expect(400);
    });

    it('enforces a resend cooldown', async () => {
      const email = uniqueEmail('cooldown');
      await api.post('/v1/auth/email-code', { email }).expect(202);
      const again = await api.post('/v1/auth/email-code', { email }).expect(429);
      expect(again.body).toMatchObject({ code: 'CODE_RESEND_TOO_SOON' });
    });
  });

  describe('sessions', () => {
    it('rotates refresh tokens and revokes the session when an old one is replayed', async () => {
      const session = await api.signInWithCode(uniqueEmail('rotate'));
      const rotated = (await api.post('/v1/auth/refresh', { refreshToken: session.refreshToken }).expect(200))
        .body as TokenPair;
      expect(rotated.refreshToken).not.toBe(session.refreshToken);
      await api.get('/v1/me', rotated.accessToken).expect(200);

      // Within the grace window a replay is treated as a concurrent refresh, not theft.
      const concurrent = await api
        .post('/v1/auth/refresh', { refreshToken: session.refreshToken })
        .expect(409);
      expect(concurrent.body).toMatchObject({ code: 'REFRESH_IN_PROGRESS' });

      const realNow = Date.now();
      const clock = jest.spyOn(Date, 'now').mockReturnValue(realNow + 11_000);
      try {
        const replay = await api.post('/v1/auth/refresh', { refreshToken: session.refreshToken }).expect(401);
        expect(replay.body).toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });
      } finally {
        clock.mockRestore();
      }
      // The whole session is gone: the legitimate tokens stop working too.
      await api.post('/v1/auth/refresh', { refreshToken: rotated.refreshToken }).expect(401);
      await api.get('/v1/me', rotated.accessToken).expect(401);
    });

    it('rejects malformed refresh tokens', async () => {
      const response = await api.post('/v1/auth/refresh', { refreshToken: 'garbage' }).expect(401);
      expect(response.body).toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    });

    it('logout revokes the access token immediately; logout-all revokes every session', async () => {
      const email = uniqueEmail('logout');
      const one = await api.signInWithCode(email);
      await api.post('/v1/auth/logout', {}, one.accessToken).expect(204);
      await api.get('/v1/me', one.accessToken).expect(401);

      const two = await api.signInWithCode(email);
      const three = (await api.post('/v1/auth/refresh', { refreshToken: two.refreshToken }).expect(200))
        .body as TokenPair;
      const other = await api.signInWithCode(email);
      const all = await api.post('/v1/auth/logout-all', {}, three.accessToken).expect(200);
      expect(all.body).toEqual({ revoked: 2 });
      await api.get('/v1/me', other.accessToken).expect(401);
    });

    it("lists the user's sessions and signs out one of them", async () => {
      const email = uniqueEmail('sessions');
      const first = await api.signInWithCode(email);
      const second = await api.signInWithCode(email);
      const stranger = await api.signInWithCode(uniqueEmail('stranger'));

      const listed = await api.get('/v1/me/sessions', second.accessToken).expect(200);
      const sessions = listed.body as { id: string; current: boolean; lastActiveAt: string }[];
      expect(sessions).toHaveLength(2);
      expect(sessions.filter((session) => session.current)).toHaveLength(1);
      const other = sessions.find((session) => !session.current);
      expect(other).toBeDefined();

      const foreign = await api.delete(`/v1/me/sessions/${other!.id}`, stranger.accessToken).expect(404);
      expect(foreign.body).toMatchObject({ code: 'SESSION_NOT_FOUND' });
      await api.get('/v1/me', first.accessToken).expect(200);

      await api.delete(`/v1/me/sessions/${other!.id}`, second.accessToken).expect(204);
      await api.get('/v1/me', first.accessToken).expect(401);
      const after = await api.get('/v1/me/sessions', second.accessToken).expect(200);
      expect(after.body).toHaveLength(1);
    });
  });

  describe('profile', () => {
    it('stores a personal time zone and reports when the password changed', async () => {
      const email = uniqueEmail('profile');
      const session = (await api.post('/v1/auth/register', { email, password: PASSWORD }).expect(201))
        .body as TokenPair;
      const me = await api.get('/v1/me', session.accessToken).expect(200);
      expect(me.body).toMatchObject({ timezone: null, hasPassword: true });
      expect(typeof (me.body as { passwordChangedAt: unknown }).passwordChangedAt).toBe('string');

      const updated = await api
        .patch('/v1/me', { timezone: 'Asia/Novosibirsk' }, session.accessToken)
        .expect(200);
      expect(updated.body).toMatchObject({ timezone: 'Asia/Novosibirsk' });
      await api.patch('/v1/me', { timezone: 'Mars/Olympus' }, session.accessToken).expect(400);
      const reset = await api.patch('/v1/me', { timezone: null }, session.accessToken).expect(200);
      expect(reset.body).toMatchObject({ timezone: null });

      const passwordless = await api.signInWithCode(uniqueEmail('no-password'));
      const none = await api.get('/v1/me', passwordless.accessToken).expect(200);
      expect(none.body).toMatchObject({ hasPassword: false, passwordChangedAt: null });
    });
  });

  describe('passwords', () => {
    it('resets the password by code and signs out all sessions', async () => {
      const email = uniqueEmail('reset');
      await api.post('/v1/auth/register', { email, password: PASSWORD }).expect(201);
      const session = (await api.post('/v1/auth/login', { email, password: PASSWORD }).expect(200))
        .body as TokenPair;

      const before = api.mail.sent.length;
      await api.post('/v1/auth/password/forgot', { email }).expect(202);
      const code = await api.mailMatch(email, /сброса пароля: (\d{6})/, before);
      await api
        .post('/v1/auth/password/reset', { email, code, newPassword: 'new strong password' })
        .expect(204);

      await api.get('/v1/me', session.accessToken).expect(401);
      await api.post('/v1/auth/login', { email, password: PASSWORD }).expect(401);
      const fresh = (await api.post('/v1/auth/login', { email, password: 'new strong password' }).expect(200))
        .body as TokenPair;
      const me = await api.get('/v1/me', fresh.accessToken).expect(200);
      expect(me.body).toMatchObject({ emailVerified: true });
    });

    it('answers forgot-password the same way for unknown emails', async () => {
      const email = uniqueEmail('nobody');
      const before = api.mail.sent.length;
      await api.post('/v1/auth/password/forgot', { email }).expect(202);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(api.mail.sent.slice(before).some((mail) => mail.to === email)).toBe(false);
    });

    it('changes the password with the current one and keeps only the current session', async () => {
      const email = uniqueEmail('change');
      const current = (await api.post('/v1/auth/register', { email, password: PASSWORD }).expect(201))
        .body as TokenPair;
      const other = (await api.post('/v1/auth/login', { email, password: PASSWORD }).expect(200))
        .body as TokenPair;

      const wrong = await api
        .post(
          '/v1/auth/password/change',
          { currentPassword: 'nope nope nope', newPassword: 'another password' },
          current.accessToken,
        )
        .expect(403);
      expect(wrong.body).toMatchObject({ code: 'CURRENT_PASSWORD_INVALID' });

      await api
        .post(
          '/v1/auth/password/change',
          { currentPassword: PASSWORD, newPassword: 'another password' },
          current.accessToken,
        )
        .expect(204);
      await api.get('/v1/me', current.accessToken).expect(200);
      await api.get('/v1/me', other.accessToken).expect(401);
    });

    it('lets a passwordless user set a first password', async () => {
      const email = uniqueEmail('first-pwd');
      const session = await api.signInWithCode(email);
      await api
        .post('/v1/auth/password/change', { newPassword: 'first password!' }, session.accessToken)
        .expect(204);
      await api.post('/v1/auth/login', { email, password: 'first password!' }).expect(200);
    });
  });

  describe('Google / Apple', () => {
    it('signs up with Google and signs in with the same identity later', async () => {
      const email = uniqueEmail('google');
      const idToken = await google.sign({ sub: 'g-1', email, email_verified: true, name: 'G User' });
      const first = (await api.post('/v1/auth/oauth/google', { idToken }).expect(200)).body as TokenPair;
      expect(first.created).toBe(true);
      const me = await api.get('/v1/me', first.accessToken).expect(200);
      expect(me.body).toMatchObject({
        email,
        emailVerified: true,
        displayName: 'G User',
        identityProviders: ['google'],
      });

      const again = (
        await api
          .post('/v1/auth/oauth/google', {
            idToken: await google.sign({ sub: 'g-1', email, email_verified: true }),
          })
          .expect(200)
      ).body as TokenPair;
      expect(again).toMatchObject({ created: false, userId: first.userId });
    });

    it('links Apple to an existing user only when Apple verified the email', async () => {
      const email = uniqueEmail('apple');
      const existing = await api.signInWithCode(email);

      const unverified = await api
        .post('/v1/auth/oauth/apple', {
          idToken: await apple.sign({ sub: 'a-1', email, email_verified: 'false' }),
        })
        .expect(409);
      expect(unverified.body).toMatchObject({ code: 'EMAIL_TAKEN' });

      const linked = (
        await api
          .post('/v1/auth/oauth/apple', {
            idToken: await apple.sign({ sub: 'a-1', email, email_verified: 'true' }),
          })
          .expect(200)
      ).body as TokenPair;
      expect(linked).toMatchObject({ created: false, userId: existing.userId });
    });

    it('rejects tokens for another audience, with a wrong nonce or without email', async () => {
      const email = uniqueEmail('bad-oidc');
      const foreign = await google.sign({
        sub: 'g-2',
        email,
        email_verified: true,
        aud: 'someone-else',
      });
      expect((await api.post('/v1/auth/oauth/google', { idToken: foreign }).expect(401)).body).toMatchObject({
        code: 'INVALID_ID_TOKEN',
      });

      const withNonce = await google.sign({
        sub: 'g-2',
        email,
        email_verified: true,
        nonce: 'expected',
      });
      await api.post('/v1/auth/oauth/google', { idToken: withNonce, nonce: 'other' }).expect(401);

      const noEmail = await google.sign({ sub: 'g-3' });
      expect((await api.post('/v1/auth/oauth/google', { idToken: noEmail }).expect(400)).body).toMatchObject({
        code: 'OIDC_EMAIL_REQUIRED',
      });

      const appleSignedByGoogleKey = await google.sign({ sub: 'a-2', email, email_verified: true });
      await api.post('/v1/auth/oauth/apple', { idToken: appleSignedByGoogleKey }).expect(401);
    });
  });
});
