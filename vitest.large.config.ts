import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/large/**/*.test.ts'],
    testTimeout: 900000,
    hookTimeout: 900000,
    fileParallelism: false
  }
})
