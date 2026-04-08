const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'src', 'openapi.yaml');
const destination = path.join(__dirname, '..', 'dist', 'openapi.yaml');

fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.copyFileSync(source, destination);
