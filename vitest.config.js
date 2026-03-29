import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Run each test file in its own process so native module cleanup
    // (WebTorrent UDP/TCP sockets) doesn't crash the vitest runner
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    teardownTimeout: 15000,
  },
})
