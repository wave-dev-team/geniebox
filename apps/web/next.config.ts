import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const config: NextConfig = {
  output: 'standalone',
  experimental: { useTypeScriptCli: false },
  agentRules: false,
  devIndicators: false,
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  poweredByHeader: false,
  transpilePackages: ['@workspace/ui'],
};

export default createNextIntlPlugin('./src/i18n/request.ts')(config);
