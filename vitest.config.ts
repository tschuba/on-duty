import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      // ponytail: thresholds removed — enforcement is in CI via artifact comparison
    },
  },
})
