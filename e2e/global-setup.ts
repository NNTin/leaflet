/**
 * Playwright global setup: creates the e2e test database and runs migrations.
 * Runs once before any test suite starts (before webServer processes).
 */

import { exec as execCb } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const exec = promisify(execCb);

const E2E_DB_URL = process.env.E2E_DATABASE_URL ?? 'postgresql://leaflet:leaflet@localhost:5432/leaflet_e2e';
const MIGRATIONS_DIR = path.resolve(__dirname, '../backend/migrations');

async function dropAndCreateDb(): Promise<void> {
  // Try: sudo -u postgres psql (available in CI / Linux dev environments)
  const tryCommands = [
    `sudo -n -u postgres psql -c "DROP DATABASE IF EXISTS leaflet_e2e" && sudo -n -u postgres psql -c "CREATE DATABASE leaflet_e2e OWNER leaflet"`,
    `psql "postgresql://leaflet:leaflet@localhost:5432/postgres" -c "DROP DATABASE IF EXISTS leaflet_e2e" && psql "postgresql://leaflet:leaflet@localhost:5432/postgres" -c "CREATE DATABASE leaflet_e2e"`,
  ];

  for (const cmd of tryCommands) {
    try {
      await exec(cmd);
      return;
    } catch {
      // Try next strategy.
    }
  }
  throw new Error('Could not create the leaflet_e2e database. Ensure the postgres superuser or leaflet user (with CREATEDB) is available.');
}

async function globalSetup(): Promise<void> {
  console.log('[e2e setup] Creating test database...');
  await dropAndCreateDb();

  console.log('[e2e setup] Running migrations...');
  const migrationFiles = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  for (const file of migrationFiles) {
    const filePath = path.join(MIGRATIONS_DIR, file);
    await exec(`psql "${E2E_DB_URL}" -v ON_ERROR_STOP=1 -f "${filePath}"`);
    console.log(`[e2e setup]   ✓ ${file}`);
  }

  console.log('[e2e setup] Database ready.');
}

export default globalSetup;
