import { Pool, PoolConfig } from 'pg';

function databaseSslConfig(): PoolConfig['ssl'] {
  const value = process.env.DATABASE_SSL?.trim().toLowerCase();
  if (!value || ['0', 'false', 'no', 'off'].includes(value)) {
    return false;
  }

  return {
    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true',
  };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: databaseSslConfig(),
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
  process.exit(-1);
});

export default pool;
