import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.tsx'],
  format: ['esm'],
  outDir: 'dist',
  splitting: false,
  clean: true,
})
