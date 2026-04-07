#!/usr/bin/env node

import 'dotenv/config';
import { program } from 'commander';
import fetch from 'node-fetch';
import chalk from 'chalk';
import ora from 'ora';

const DEFAULT_SERVER = process.env.LEAFLET_SERVER ?? 'http://localhost:3001';
const DEFAULT_API_KEY = process.env.LEAFLET_API_KEY ?? '';

program
  .name('leaflet-cli')
  .description('CLI tool for the Leaflet URL shortener')
  .version('1.0.0');

program
  .command('shorten <url>')
  .description('Shorten a URL')
  .option('--ttl <ttl>', 'Expiry time: 5m, 1h, 24h, never', '24h')
  .option('--alias <alias>', 'Custom alias for the short URL (requires privileged/admin API key)')
  .option('--api-key <key>', 'API key for authentication (get from /auth/api-key after OAuth login)', DEFAULT_API_KEY)
  .option('--server <url>', 'Leaflet server URL', DEFAULT_SERVER)
  .action(async (url: string, options: { ttl: string; alias?: string; apiKey: string; server: string }) => {
    const { ttl, alias, server } = options;
    const apiKey = options.apiKey;

    const validTTLs = ['5m', '1h', '24h', 'never'];
    if (!validTTLs.includes(ttl)) {
      console.error(chalk.red(`✗ Invalid TTL "${ttl}". Must be one of: ${validTTLs.join(', ')}`));
      process.exit(1);
    }

    const spinner = ora('Creating short URL...').start();

    try {
      const body: Record<string, string> = { url, ttl };
      if (alias) body.alias = alias;

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };

      if (apiKey) {
        // API key auth: send as Bearer token. CSRF does not apply to Bearer-authenticated requests.
        headers['Authorization'] = `Bearer ${apiKey}`;
      } else {
        // No auth: anonymous request. Fetch a CSRF token first.
        try {
          const csrfRes = await fetch(`${server}/auth/csrf-token`);
          if (csrfRes.ok) {
            const csrfData = await csrfRes.json() as { csrfToken?: string };
            if (csrfData.csrfToken) headers['X-CSRF-Token'] = csrfData.csrfToken;
          }
        } catch {
          // CSRF token fetch failed; proceed without it (server may be lenient in dev)
        }
      }

      const response = await fetch(`${server}/api/shorten`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const data = await response.json() as {
        shortUrl?: string;
        shortCode?: string;
        expiresAt?: string | null;
        error?: string;
        errors?: Array<{ msg: string }>;
      };

      if (!response.ok) {
        spinner.fail(chalk.red('Failed to create short URL'));
        const msg = data.error ?? (data.errors?.map(e => e.msg).join(', ')) ?? response.statusText;
        console.error(chalk.red(`✗ Error: ${msg}`));
        process.exit(1);
      }

      spinner.succeed(chalk.green('Short URL created!'));

      const shortUrl = data.shortUrl ?? `${server}/s/${data.shortCode}`;
      const expiresAt = data.expiresAt;

      console.log('');
      console.log(`${chalk.bold('Short URL:')}  ${chalk.cyan(shortUrl)}`);

      if (expiresAt) {
        const expiry = new Date(expiresAt);
        const now = new Date();
        const diffMs = expiry.getTime() - now.getTime();
        const diffMins = Math.round(diffMs / 60000);
        let expiryLabel: string;
        if (diffMins < 60) {
          expiryLabel = `in ${diffMins} minute${diffMins !== 1 ? 's' : ''}`;
        } else if (diffMins < 1440) {
          const hours = Math.round(diffMins / 60);
          expiryLabel = `in ${hours} hour${hours !== 1 ? 's' : ''}`;
        } else {
          const days = Math.round(diffMins / 1440);
          expiryLabel = `in ${days} day${days !== 1 ? 's' : ''}`;
        }
        console.log(`${chalk.bold('Expires:')}    ${expiryLabel}`);
      } else if (ttl === 'never') {
        console.log(`${chalk.bold('Expires:')}    never`);
      } else {
        const labelMap: Record<string, string> = { '5m': '5 minutes', '1h': '1 hour', '24h': '24 hours' };
        console.log(`${chalk.bold('Expires:')}    in ${labelMap[ttl] ?? ttl}`);
      }

      console.log('');
      console.log(`${chalk.bold('Copy:')} ${chalk.cyan(shortUrl)}`);
    } catch (err) {
      spinner.fail(chalk.red('Request failed'));
      console.error(chalk.red(`✗ ${(err as Error).message}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
