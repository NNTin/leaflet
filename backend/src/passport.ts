import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import pool from './db';
import { User } from './models/user';

const adminGithubIds = (process.env.ADMIN_GITHUB_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const clientID = process.env.GITHUB_CLIENT_ID;
const clientSecret = process.env.GITHUB_CLIENT_SECRET;

if (clientID && clientSecret) {
  passport.use(
    new GitHubStrategy(
      {
        clientID,
        clientSecret,
        callbackURL: process.env.GITHUB_CALLBACK_URL || 'http://localhost:3001/auth/github/callback',
      },
      async (accessToken: string, refreshToken: string, profile: { id: string; username?: string; displayName?: string }, done: (err: Error | null, user?: unknown) => void) => {
        try {
          const githubId = String(profile.id);
          const username = profile.username || profile.displayName || githubId;
          const isAdmin = adminGithubIds.includes(githubId);

          const result = await pool.query(
            `INSERT INTO users (github_id, username, role)
             VALUES ($1, $2, $3)
             ON CONFLICT (github_id)
             DO UPDATE SET
               username = EXCLUDED.username,
               role = CASE
                 WHEN users.role = 'admin' THEN 'admin'
                 WHEN $3 = 'admin' THEN 'admin'
                 ELSE users.role
               END
             RETURNING *`,
            [githubId, username, isAdmin ? 'admin' : 'user']
          );

          return done(null, result.rows[0]);
        } catch (err) {
          return done(err as Error);
        }
      }
    )
  );
} else {
  console.warn('GitHub OAuth credentials not configured. Login will be unavailable.');
}

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
