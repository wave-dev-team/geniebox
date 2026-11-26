import ssh2 from 'ssh2';

import { assertPublicHost, failure } from './egress.js';
import type { CheckContext, CheckResult } from './provider.types.js';

// ssh2 is CommonJS: Node does not expose its `utils` as a named ESM export.
const { Client, utils } = ssh2;

/** Ed25519 key pair in OpenSSH format; the private half is sealed, the public one shown. */
export function generateSshKeyPair(comment: string): { privateKey: string; publicKey: string } {
  const pair = utils.generateKeyPairSync('ed25519', { comment });
  return { privateKey: pair.private, publicKey: pair.public };
}

/** Authenticates with the project key and disconnects; runs no command. */
export async function checkSsh(context: CheckContext): Promise<CheckResult> {
  const { host = '', port, username } = context.config;
  try {
    await assertPublicHost(host, context.allowPrivateHosts);
  } catch (error) {
    return failure(error);
  }
  return new Promise<CheckResult>((resolve) => {
    const client = new Client();
    const done = (result: CheckResult) => {
      client.end();
      resolve(result);
    };
    client
      .on('ready', () => done({ status: 'ok' }))
      .on('error', (error: Error & { level?: string }) =>
        done(
          error.level === 'client-authentication'
            ? { status: 'error', reason: 'UNAUTHORIZED' }
            : error.level === 'client-timeout'
              ? { status: 'error', reason: 'TIMEOUT' }
              : { status: 'error', reason: 'UNREACHABLE' },
        ),
      )
      .connect({
        host,
        port: Number(port || 22),
        username,
        privateKey: context.secret.private_key,
        readyTimeout: context.timeoutMs,
        // Host key pinning comes with the tool executor; a check only proves the key works.
        hostVerifier: () => true,
      });
  });
}
