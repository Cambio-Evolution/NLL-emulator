/**
 * Smoke test: boots the full server against an in-memory Postgres (pg-mem),
 * so the API can be exercised without Docker. Run with: npm run smoke
 * Then hit http://localhost:8099 with curl or your client.
 */
const { newDb } = require('pg-mem');
const mem = newDb({ noAstCoverageCheck: true });
const adapter = mem.adapters.createPg();
require.cache[require.resolve('pg')] = {
  id: require.resolve('pg'),
  filename: require.resolve('pg'),
  loaded: true,
  exports: adapter,
} as any;

process.env.SEED_ON_START = 'true';
process.env.PORT = process.env.PORT || '8099';
import('../src/index');
