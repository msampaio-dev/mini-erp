import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/support/test-db.js';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/support/global-setup.ts'],
    // Os arquivos compartilham o mesmo banco: rodam em sequência para não se atropelarem.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl(),
      LOGIN_RATE_LIMIT: '1000',
    },
  },
});
