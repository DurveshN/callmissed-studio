import { defineConfig } from '@playwright/test'

/** Smoke test of the packaged app (after `npm run dist`): `npm run test:packaged`. */
export default defineConfig({
  testDir: 'tests/packaged',
  timeout: 300_000,
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure' }
})
