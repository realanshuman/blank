import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

/**
 * Prefer a Chromium already on the machine over downloading one: some dev
 * containers ship a pinned build that will not match the version Playwright
 * would fetch. In CI, where Playwright installs its own, this resolves to
 * undefined and the managed browser is used.
 */
const CANDIDATES = [
  process.env.BLANK_CHROMIUM,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].filter((path): path is string => !!path)

const EXECUTABLE = CANDIDATES.find((path) => existsSync(path))

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: EXECUTABLE,
      args: ['--no-sandbox'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build:only && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
