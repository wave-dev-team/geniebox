import { flushRedis, uniqueEmail } from '../support/helpers.js';
import { ApiHarness, type TokenPair } from '../support/http-app.js';

interface AccountBody {
  id: string;
  slug: string;
  role: string;
}

describe('accounts, members, invitations (HTTP)', () => {
  let api: ApiHarness;
  let owner: TokenPair;
  let account: AccountBody;

  /** Invites `email` as `role`, signs the invitee up by code and accepts. */
  async function addMember(email: string, role: 'admin' | 'tech' | 'viewer'): Promise<TokenPair> {
    const before = api.mail.sent.length;
    await api.post(`/v1/accounts/${account.id}/invitations`, { email, role }, owner.accessToken).expect(201);
    const token = await api.mailMatch(email, /token=([A-Za-z0-9_-]+)/, before);
    const session = await api.signInWithCode(email);
    await api.post('/v1/invitations/accept', { token }, session.accessToken).expect(200);
    return session;
  }

  beforeAll(async () => {
    await flushRedis();
    api = await ApiHarness.create();
    owner = await api.signInWithCode(uniqueEmail('owner'));
    account = (await api.post('/v1/accounts', { name: 'Моя Компания' }, owner.accessToken).expect(201))
      .body as AccountBody;
  });

  afterAll(async () => {
    await api.close();
  });

  it('creates an account owned by the caller with a transliterated slug', () => {
    expect(account).toMatchObject({ slug: 'moya-kompaniya', role: 'owner' });
  });

  it('lets a user hold several accounts with different roles', async () => {
    const second = (await api.post('/v1/accounts', { name: 'Моя Компания' }, owner.accessToken).expect(201))
      .body as AccountBody;
    expect(second.slug).toMatch(/^moya-kompaniya-[0-9a-f]{6}$/);
    const mine = await api.get('/v1/accounts', owner.accessToken).expect(200);
    expect((mine.body as AccountBody[]).map((item) => item.id)).toEqual([account.id, second.id]);
  });

  it('rejects a taken explicit slug', async () => {
    const response = await api
      .post('/v1/accounts', { name: 'X', slug: 'moya-kompaniya' }, owner.accessToken)
      .expect(409);
    expect(response.body).toMatchObject({ code: 'ACCOUNT_SLUG_TAKEN' });
  });

  it('hides accounts from non-members behind 404', async () => {
    const outsider = await api.signInWithCode(uniqueEmail('outsider'));
    const response = await api.get(`/v1/accounts/${account.id}`, outsider.accessToken).expect(404);
    expect(response.body).toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
    await api.get(`/v1/accounts/${account.id}/members`, outsider.accessToken).expect(404);
    await api.get('/v1/accounts/not-a-uuid', outsider.accessToken).expect(404);
  });

  describe('invitations', () => {
    it('invites by email; the invitee joins with the emailed link', async () => {
      const email = uniqueEmail('invitee');
      const invitee = await addMember(email, 'tech');
      const joined = await api.get(`/v1/accounts/${account.id}`, invitee.accessToken).expect(200);
      expect(joined.body).toMatchObject({ id: account.id, role: 'tech' });

      const members = await api.get(`/v1/accounts/${account.id}/members`, owner.accessToken).expect(200);
      expect(
        (members.body as Array<{ email: string; role: string }>).find((m) => m.email === email),
      ).toMatchObject({ role: 'tech' });

      const again = await api
        .post(`/v1/accounts/${account.id}/invitations`, { email, role: 'tech' }, owner.accessToken)
        .expect(409);
      expect(again.body).toMatchObject({ code: 'ALREADY_MEMBER' });
    });

    it('requires the invited, verified email of the signed-in user', async () => {
      const email = uniqueEmail('target');
      const before = api.mail.sent.length;
      await api
        .post(`/v1/accounts/${account.id}/invitations`, { email, role: 'tech' }, owner.accessToken)
        .expect(201);
      const token = await api.mailMatch(email, /token=([A-Za-z0-9_-]+)/, before);

      const stranger = await api.signInWithCode(uniqueEmail('stranger'));
      const mismatch = await api.post('/v1/invitations/accept', { token }, stranger.accessToken).expect(403);
      expect(mismatch.body).toMatchObject({ code: 'INVITATION_EMAIL_MISMATCH' });

      const unverified = (
        await api.post('/v1/auth/register', { email, password: 'password for target' }).expect(201)
      ).body as TokenPair;
      const notVerified = await api
        .post('/v1/invitations/accept', { token }, unverified.accessToken)
        .expect(403);
      expect(notVerified.body).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
    });

    it('replaces a pending invitation on re-invite and supports revocation', async () => {
      const email = uniqueEmail('revoke');
      const first = api.mail.sent.length;
      await api
        .post(`/v1/accounts/${account.id}/invitations`, { email, role: 'tech' }, owner.accessToken)
        .expect(201);
      const oldToken = await api.mailMatch(email, /token=([A-Za-z0-9_-]+)/, first);
      const second = api.mail.sent.length;
      const invite = (
        await api
          .post(`/v1/accounts/${account.id}/invitations`, { email, role: 'admin' }, owner.accessToken)
          .expect(201)
      ).body as { id: string };
      const newToken = await api.mailMatch(email, /token=([A-Za-z0-9_-]+)/, second);

      const pending = await api.get(`/v1/accounts/${account.id}/invitations`, owner.accessToken).expect(200);
      expect((pending.body as Array<{ email: string }>).filter((item) => item.email === email)).toHaveLength(
        1,
      );

      const invitee = await api.signInWithCode(email);
      await api.post('/v1/invitations/accept', { token: oldToken }, invitee.accessToken).expect(404);
      await api.delete(`/v1/accounts/${account.id}/invitations/${invite.id}`, owner.accessToken).expect(204);
      await api.post('/v1/invitations/accept', { token: newToken }, invitee.accessToken).expect(404);
    });
  });

  describe('roles', () => {
    let admin: TokenPair;
    let admin2: TokenPair;
    let member: TokenPair;
    let viewer: TokenPair;

    beforeAll(async () => {
      admin = await addMember(uniqueEmail('admin'), 'admin');
      admin2 = await addMember(uniqueEmail('admin2'), 'admin');
      member = await addMember(uniqueEmail('member'), 'tech');
      viewer = await addMember(uniqueEmail('viewer'), 'viewer');
    });

    it('only admins update the account', async () => {
      const denied = await api
        .patch(`/v1/accounts/${account.id}`, { name: 'Hacked' }, member.accessToken)
        .expect(403);
      expect(denied.body).toMatchObject({ code: 'ACCOUNT_ROLE_REQUIRED' });
      const updated = await api
        .patch(`/v1/accounts/${account.id}`, { name: 'Renamed' }, admin.accessToken)
        .expect(200);
      expect(updated.body).toMatchObject({ name: 'Renamed', role: 'admin' });
    });

    it('admins manage members but not other admins or the owner', async () => {
      await api
        .patch(`/v1/accounts/${account.id}/members/${member.userId}`, { role: 'admin' }, admin.accessToken)
        .expect(204);
      await api
        .patch(`/v1/accounts/${account.id}/members/${member.userId}`, { role: 'tech' }, admin.accessToken)
        .expect(403);
      await api
        .patch(`/v1/accounts/${account.id}/members/${member.userId}`, { role: 'tech' }, owner.accessToken)
        .expect(204);

      const otherAdmin = await api
        .patch(`/v1/accounts/${account.id}/members/${admin2.userId}`, { role: 'tech' }, admin.accessToken)
        .expect(403);
      expect(otherAdmin.body).toMatchObject({ code: 'OWNER_REQUIRED' });
      const ownerRole = await api
        .patch(`/v1/accounts/${account.id}/members/${owner.userId}`, { role: 'tech' }, admin.accessToken)
        .expect(409);
      expect(ownerRole.body).toMatchObject({ code: 'OWNER_ROLE_IMMUTABLE' });
      await api
        .patch(`/v1/accounts/${account.id}/members/${member.userId}`, { role: 'owner' }, owner.accessToken)
        .expect(400);
    });

    it('viewers do not see the team; tech members see it read-only', async () => {
      const denied = await api.get(`/v1/accounts/${account.id}/members`, viewer.accessToken).expect(403);
      expect(denied.body).toMatchObject({ code: 'ACCOUNT_ROLE_REQUIRED' });
      await api.get(`/v1/accounts/${account.id}/members`, member.accessToken).expect(200);
      await api.get(`/v1/accounts/${account.id}/invitations`, member.accessToken).expect(403);
      await api
        .patch(`/v1/accounts/${account.id}/members/${viewer.userId}`, { role: 'tech' }, member.accessToken)
        .expect(403);
      const own = await api.get(`/v1/accounts/${account.id}`, viewer.accessToken).expect(200);
      expect(own.body).toMatchObject({ role: 'viewer' });
    });

    it('rejects the retired member role', async () => {
      await api
        .patch(`/v1/accounts/${account.id}/members/${viewer.userId}`, { role: 'member' }, owner.accessToken)
        .expect(400);
    });

    it('members cannot remove others; anyone but the owner can leave', async () => {
      await api.delete(`/v1/accounts/${account.id}/members/${admin2.userId}`, member.accessToken).expect(403);
      const ownerLeaves = await api
        .delete(`/v1/accounts/${account.id}/members/${owner.userId}`, owner.accessToken)
        .expect(409);
      expect(ownerLeaves.body).toMatchObject({ code: 'OWNER_ROLE_IMMUTABLE' });

      await api.delete(`/v1/accounts/${account.id}/members/${member.userId}`, member.accessToken).expect(204);
      await api.get(`/v1/accounts/${account.id}`, member.accessToken).expect(404);
    });

    it('transfers ownership: the old owner becomes admin', async () => {
      await api
        .post(`/v1/accounts/${account.id}/ownership`, { userId: admin.userId }, admin2.accessToken)
        .expect(403);
      await api
        .post(`/v1/accounts/${account.id}/ownership`, { userId: admin.userId }, owner.accessToken)
        .expect(204);

      const members = (await api.get(`/v1/accounts/${account.id}/members`, admin.accessToken).expect(200))
        .body as Array<{ userId: string; role: string }>;
      expect(members.find((m) => m.userId === admin.userId)?.role).toBe('owner');
      expect(members.find((m) => m.userId === owner.userId)?.role).toBe('admin');
      expect(members.filter((m) => m.role === 'owner')).toHaveLength(1);

      await api
        .post(`/v1/accounts/${account.id}/ownership`, { userId: owner.userId }, owner.accessToken)
        .expect(403);
    });
  });
});
