const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;
const pool = require('./db');

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
    async (accessToken, refreshToken, profile, done) => {
      try {
        const githubId = String(profile.id);
        const username = profile.username || profile.displayName || githubId;

        // Determine role: admin if github ID is in the admin list
        const isAdmin = adminGithubIds.includes(githubId);

        // Upsert user: insert or update username; role is only elevated to admin on first insert
        // or if they are in the admin list (allows retroactive admin assignment)
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
        return done(err);
      }
    }
  )
);
} else {
  console.warn('GitHub OAuth credentials not configured. Login will be unavailable.');
}

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (result.rows.length === 0) return done(null, false);
    done(null, result.rows[0]);
  } catch (err) {
    done(err);
  }
});
