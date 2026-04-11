import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

const E2E_DB_URL = process.env.E2E_DATABASE_URL ?? 'postgresql://leaflet:leaflet@localhost:5432/leaflet_e2e';
const BACKEND_PORT = 3099;
const FRONTEND_PORT = 5099;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;

const backendEnv: NodeJS.ProcessEnv = {
  PORT: String(BACKEND_PORT),
  NODE_ENV: 'development',
  DATABASE_URL: E2E_DB_URL,
  E2E_TEST_MODE: 'true',
  SESSION_SECRET: 'e2e-test-secret-not-for-production',
  ALLOWED_FRONTEND_ORIGINS: FRONTEND_URL,
  PUBLIC_API_ORIGIN: BACKEND_URL,
  PUBLIC_SHORT_URL_BASE: `${BACKEND_URL}/s`,
  DEFAULT_FRONTEND_URL: FRONTEND_URL,
  DATABASE_SSL: 'false',
};

const backendServerJs = path.resolve(__dirname, '../backend/dist/server.js');
const frontendDistDir = path.resolve(__dirname, '../frontend');

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: require.resolve('./global-setup'),

  webServer: [
    {
      command: `node "${backendServerJs}"`,
      port: BACKEND_PORT,
      timeout: 30_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: backendEnv,
    },
    {
      // vite preview serves the already-built frontend dist.
      command: `npx vite preview --port ${FRONTEND_PORT} --host 127.0.0.1`,
      cwd: frontendDistDir,
      port: FRONTEND_PORT,
      timeout: 20_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],

  use: {
    baseURL: FRONTEND_URL,
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

export { BACKEND_URL, FRONTEND_URL };
