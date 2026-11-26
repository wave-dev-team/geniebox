import { Module } from '@nestjs/common';

import { SecretCipher } from './secret-cipher.js';

@Module({ providers: [SecretCipher], exports: [SecretCipher] })
export class SecretsModule {}
