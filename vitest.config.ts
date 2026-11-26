import { defineConfig } from 'vitest/config'

// Tests mit echter Postgres-DB teilen sich TEST_DATABASE_URL (migrate/truncate) und müssen seriell laufen.
const dbTests = [
  'src/tests/cash-db.test.ts',
  'src/tests/cash-routes-db.test.tsx',
  'src/tests/member-settings-db.test.ts',
  'src/tests/events-pending-db.test.ts',
  'src/tests/search-route.test.tsx',
]

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      exclude: ['src/tests/**'],
      // ponytail: thresholds removed — enforcement is in CI via artifact comparison
    },
    projects: [
      { extends: true, test: { name: 'unit', exclude: ['**/node_modules/**', ...dbTests] } },
      { extends: true, test: { name: 'db', include: dbTests, fileParallelism: false } },
    ],
  },
})
