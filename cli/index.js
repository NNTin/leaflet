#!/usr/bin/env node

'use strict';

require('dotenv').config();

const { program } = require('commander');
const fetch = require('node-fetch');
const chalk = require('chalk');
const ora = require('ora');

const DEFAULT_SERVER = process.env.LEAFLET_SERVER || 'http://localhost:3001';
const DEFAULT_TOKEN = process.env.LEAFLET_TOKEN || '';

program
  .name('leaflet-cli')
  .description('CLI tool for the Leaflet URL shortener')
  .version('1.0.0');

program
  .command('shorten <url>')
  .description('Shorten a URL')
  .option('--ttl <ttl>', 'Expiry time: 5m, 1h, 24h, never', '24h')
  .option('--alias <alias>', 'Custom alias for the short URL (requires auth token)')
  .option('--token <token>', 'API token or session token for authentication', DEFAULT_TOKEN)
  .option('--server <url>', 'Leaflet server URL', DEFAULT_SERVER)
  .action(async (url, options) => {
    const { ttl, alias, token, server } = options;

    const validTTLs = ['5m', '1h', '24h', 'never'];
    if (!validTTLs.includes(ttl)) {
      console.error(chalk.red(`✗ Invalid TTL "${ttl}". Must be one of: ${validTTLs.join(', ')}`));
      process.exit(1);
    }

    const spinner = ora('Creating short URL...').start();

    try {
      const body = { url, ttl };
      if (alias) body.alias = alias;

      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['Cookie'] = `connect.sid=${token}`;
      }

      const response = await fetch(`${server}/api/shorten`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        spinner.fail(chalk.red('Failed to create short URL'));
        console.error(chalk.red(`✗ Error: ${data.error || data.message || response.statusText}`));
        process.exit(1);
      }

      spinner.succeed(chalk.green('Short URL created!'));

      const shortUrl = data.shortUrl || data.short_url || `${server}/s/${data.code}`;
      const expiresAt = data.expiresAt || data.expires_at;

      console.log('');
      console.log(`${chalk.bold('Short URL:')}  ${chalk.cyan(shortUrl)}`);

      if (expiresAt) {
        const expiry = new Date(expiresAt);
        const now = new Date();
        const diffMs = expiry - now;
        const diffMins = Math.round(diffMs / 60000);
        let expiryLabel;
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
        const labelMap = { '5m': '5 minutes', '1h': '1 hour', '24h': '24 hours' };
        console.log(`${chalk.bold('Expires:')}    in ${labelMap[ttl] || ttl}`);
      }

      console.log('');
      console.log(`${chalk.bold('Copy:')} ${chalk.cyan(shortUrl)}`);
    } catch (err) {
      spinner.fail(chalk.red('Request failed'));
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
