import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 5173);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: `test-results/e2e-${port}`,
  timeout: 60000,
  fullyParallel: true,
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.E2E_PORT,
  },
});
