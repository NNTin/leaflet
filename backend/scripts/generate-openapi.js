/**
 * Writes dist/openapi.json from the compiled TypeScript spec module.
 *
 * Run after `tsc`: the compiled dist/openapi.js is require()'d and its
 * default export is serialised to JSON so tooling (linters, SDK generators,
 * CI checks) can consume a standalone spec file.
 */

const fs = require('fs');
const path = require('path');

const specModule = require('../dist/openapi');
// Support both CommonJS default export patterns.
const spec = specModule.default ?? specModule;

const dest = path.join(__dirname, '..', 'dist', 'openapi.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(spec, null, 2) + '\n');
console.log('OpenAPI spec written to', dest);
