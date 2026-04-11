#!/usr/bin/env bash
# End-to-end integration test runner for Leaflet.
#
# Builds the backend, CLI, and frontend, then runs the Playwright test suite
# against a dedicated e2e PostgreSQL database (leaflet_e2e).
#
# Usage:
#   npm run test:e2e          # from repository root
#   sh e2e/run.sh             # directly

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "🔨 Building backend..."
npm run build --workspace backend

echo "🔨 Building CLI..."
npm run build --workspace cli

echo "🔨 Building frontend (VITE_API_ORIGIN=http://localhost:3099)..."
VITE_API_ORIGIN=http://localhost:3099 npm run build --workspace frontend

echo "🎭 Running Playwright e2e tests..."
cd e2e
npx playwright test --config playwright.config.ts "$@"
