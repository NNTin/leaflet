#!/usr/bin/env node

import 'dotenv/config';
import { runCli } from './cli';

void runCli().then((exitCode) => {
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
});
