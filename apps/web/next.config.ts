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
  async rewrites() {
    if (process.env.NODE_ENV !== 'development') {
      return [];
    }

    return [
      { source: '/api/:path*', destination: `http://127.0.0.1:${process.env.API_PORT ?? '8000'}/api/:path*` },
    ];
  },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(config);
