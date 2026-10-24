import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Directs Vitest to parse everything in your tests/ folder
    include: ['tests/**/*.test.ts'], 
  },
})