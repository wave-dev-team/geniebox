import { jest } from '@jest/globals';

import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';

import { UsersRepository } from '../users/repositories/users.repository.js';
import { AuthService } from './auth.service.js';
import { EmailCodesService } from './email-codes.service.js';
import { LoginAttempts } from './login-attempts.js';
import { PasswordHasher } from './password-hasher.js';
import { SessionStore } from './session.store.js';

const findByEmail = jest.fn();
const verify = jest.fn();
const consume = jest.fn();
const claim = jest.fn();
const reset = jest.fn();
const create = jest.fn();
let auth: AuthService;

beforeEach(async () => {
  jest.resetAllMocks();
  const module = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: UsersRepository, useValue: { findByEmail } },
      { provide: PasswordHasher, useValue: { verify } },
      { provide: EmailCodesService, useValue: { emailKey: (value: string) => value, consume } },
      { provide: LoginAttempts, useValue: { claim, reset } },
      { provide: SessionStore, useValue: { create } },
      { provide: JwtService, useValue: {} },
    ],
  }).compile();
  auth = module.get(AuthService);
});

it('verifies a dummy password hash for unknown mailboxes and issues no session', async () => {
  findByEmail.mockReturnValue(undefined);
  verify.mockReturnValue(false);

  await expect(auth.login(' Test@geniebox.test ', 'wrong', {})).rejects.toMatchObject({
    code: 'INVALID_CREDENTIALS',
  });
  expect(claim).toHaveBeenCalledWith('test@geniebox.test');
  expect(verify).toHaveBeenCalledWith(undefined, 'wrong');
  expect(reset).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

it('rejects an invalid email code before resolving an account or creating a session', async () => {
  consume.mockReturnValue(false);

  await expect(auth.loginWithCode(' Test@geniebox.test ', '111111', {})).rejects.toMatchObject({
    code: 'INVALID_EMAIL_CODE',
  });
  expect(consume).toHaveBeenCalledWith('login', 'test@geniebox.test', '111111');
  expect(findByEmail).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});
