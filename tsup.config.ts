import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.tsx', 'src/entrypoint.ts', 'src/lib/otel.ts'],
  format: ['esm'],
  outDir: 'dist',
  splitting: false,
  clean: true,
})
