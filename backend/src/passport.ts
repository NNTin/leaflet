import passport from 'passport';
import pool from './db';
import { User } from './models/user';
import { registerAllProviders } from './providers/registry';

// Register all configured OAuth providers (GitHub, Google, Discord, Microsoft, Apple).
// Providers are skipped silently when their environment credentials are absent.
registerAllProviders();

passport.serializeUser((user: Express.User, done) => {
  done(null, (user as User).id);
});

passport.deserializeUser(async (id: number, done) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (result.rows.length === 0) return done(null, false);
    done(null, result.rows[0] as User);
  } catch (err) {
    done(err as Error);
  }
});
