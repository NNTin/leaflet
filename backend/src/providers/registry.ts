/**
 * Multi-provider passport strategy registry.
 *
 * Each provider entry encapsulates:
 *   - Strategy constructor and options
 *   - Scopes to request
 *   - Profile normalizer (raw provider profile → NormalizedProfile)
 *
 * To add a new provider: add an entry to PROVIDER_CONFIGS below and
 * set the required env vars. The provider will be automatically registered
 * with passport if and only if its credentials are present.
 */

import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as DiscordStrategy } from 'passport-discord';
import { Strategy as MicrosoftStrategy } from 'passport-microsoft';
import { Strategy as AppleStrategy } from 'passport-apple';
import { Request } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db';
import { User } from '../models/user';
import {
  NormalizedProfile,
  ProviderName,
  findIdentityByProvider,
  findOrCreateUserByIdentity,
  upsertIdentity,
} from '../models/identity';

// ---------------------------------------------------------------------------
// Profile normalizers
// ---------------------------------------------------------------------------

// Each normalizer accepts `unknown` (the raw passport profile) and returns a
// NormalizedProfile.  We use type assertions here because passport strategies
// return loosely-typed profile objects that we cannot express in strict types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawProfile = Record<string, any>;

function normalizeGitHubProfile(raw: unknown): NormalizedProfile {
  const profile = raw as RawProfile;
  const emails: Array<{ value: string; primary?: boolean; verified?: boolean }> =
    Array.isArray(profile.emails) ? profile.emails : [];
  const primaryEmail =
    emails.find((e) => e.primary)?.value ?? emails[0]?.value ?? null;
  const emailVerified =
    emails.find((e) => e.primary)?.verified === true || emails[0]?.verified === true;
  return {
    provider: 'github',
    providerUserId: String(profile.id),
    displayName: profile.username || profile.displayName || String(profile.id),
    email: primaryEmail,
    emailVerified,
  };
}

function normalizeGoogleProfile(raw: unknown): NormalizedProfile {
  const profile = raw as RawProfile;
  const emails: Array<{ value: string; verified?: boolean }> =
    Array.isArray(profile.emails) ? profile.emails : [];
  const emailEntry = emails[0];
  return {
    provider: 'google',
    providerUserId: String(profile.id),
    displayName: profile.displayName || String(profile.id),
    email: emailEntry?.value ?? null,
    emailVerified: emailEntry?.verified === true,
  };
}

function normalizeDiscordProfile(raw: unknown): NormalizedProfile {
  const profile = raw as RawProfile;
  return {
    provider: 'discord',
    providerUserId: String(profile.id),
    displayName: profile.username || String(profile.id),
    email: typeof profile.email === 'string' ? profile.email : null,
    emailVerified: profile.verified === true,
  };
}

function normalizeMicrosoftProfile(raw: unknown): NormalizedProfile {
  const profile = raw as RawProfile;
  const emails: Array<{ value: string }> =
    Array.isArray(profile.emails) ? profile.emails : [];
  return {
    provider: 'microsoft',
    providerUserId: String(profile.id),
    displayName: profile.displayName || String(profile.id),
    email: emails[0]?.value ?? null,
    // Microsoft Graph does not surface email-verified status in the basic profile.
    emailVerified: false,
  };
}

function normalizeAppleIdToken(idToken: string): NormalizedProfile {
  // Apple sends a JWT id_token.  We decode (not verify) it here since
  // passport-apple has already validated the signature via the OAuth flow.
  // The `sub` claim is the stable, unique Apple user identifier.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const decoded = jwt.decode(idToken) as Record<string, any> | null;

  const rawSub = decoded?.sub;
  if (typeof rawSub !== 'string' || rawSub.trim() === '') {
    throw new Error('Invalid Apple id_token: missing or empty subject claim');
  }
  const sub = rawSub;

  const email: string | null = typeof decoded?.email === 'string' ? decoded.email : null;
  const emailVerified: boolean =
    decoded?.email_verified === true || decoded?.email_verified === 'true';

  return {
    provider: 'apple',
    providerUserId: sub,
    displayName: email ? email.split('@')[0] : sub,
    email,
    emailVerified,
  };
}

// ---------------------------------------------------------------------------
// Shared verify callback factory
// ---------------------------------------------------------------------------

/**
 * Builds the passport verify callback used by all providers.
 *
 * If req.user is set (the user is already logged in), the callback runs in
 * *linking* mode and attaches the new identity to the current user.  If a
 * conflict is detected (the identity is already owned by a different user),
 * the conflict details are stored in req.session so the auth route can relay
 * them to the frontend.
 *
 * If req.user is not set, the callback runs in *login* mode and finds or
 * creates a user account via the incoming identity.
 */
function makeVerifyCallback(normalizeProfile: (rawProfile: unknown) => NormalizedProfile) {
  return async (
    req: Request,
    accessToken: string,
    _refreshToken: string,
    rawProfile: unknown,
    done: (err: Error | null, user?: Express.User | false) => void,
  ): Promise<void> => {
    try {
      const profile = normalizeProfile(rawProfile);

      if (req.user) {
        // ---- Linking mode ----
        const currentUserId = (req.user as User).id;

        const existingIdentity = await findIdentityByProvider(
          profile.provider,
          profile.providerUserId,
        );

        if (existingIdentity && existingIdentity.user_id !== currentUserId) {
          // Conflict: this identity already belongs to a different account.
          // Store conflict info in the session so the callback route can relay
          // it to the frontend with appropriate error params.
          req.session.linkConflict = {
            provider: profile.provider,
            conflictingUserId: existingIdentity.user_id,
          };
          done(null, req.user as User);
          return;
        }

        await upsertIdentity(currentUserId, profile);
        delete req.session.linkConflict;
        done(null, req.user as User);
        return;
      }

      // ---- Login mode ----
      const user = await findOrCreateUserByIdentity(profile);

      // Apply ADMIN_GITHUB_IDS env var for GitHub logins.
      if (profile.provider === 'github') {
        const adminGithubIds = (process.env.ADMIN_GITHUB_IDS || '')
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean);

        if (adminGithubIds.includes(profile.providerUserId) && user.role !== 'admin') {
          await pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [user.id]);
          user.role = 'admin';
        }
      }

      const fullUserResult = await pool.query<User>(`SELECT * FROM users WHERE id = $1`, [user.id]);
      done(null, fullUserResult.rows[0] ?? false);
    } catch (err) {
      done(err as Error);
    }
  };
}

/** Apple's passport callback has an extra `idToken` parameter before `profile`. */
function makeAppleVerifyCallback() {
  return async (
    req: Request,
    accessToken: string,
    refreshToken: string,
    idToken: string,
    // Apple always sends `{}` for the profile; all user data is in idToken.
    _profile: Record<string, never>,
    done: (err: Error | null, user?: Express.User | false) => void,
  ): Promise<void> => {
    const inner = makeVerifyCallback(() => normalizeAppleIdToken(idToken));
    return inner(req, accessToken, refreshToken, idToken, done);
  };
}

// ---------------------------------------------------------------------------
// Provider registration
// ---------------------------------------------------------------------------

export const REGISTERED_PROVIDERS: ProviderName[] = [];

interface ProviderConfig {
  name: ProviderName;
  register: () => void;
}

const BASE_URL = process.env.PUBLIC_API_ORIGIN || 'http://localhost:3001';

const PROVIDER_CONFIGS: ProviderConfig[] = [
  {
    name: 'github',
    register() {
      const clientID = process.env.GITHUB_CLIENT_ID;
      const clientSecret = process.env.GITHUB_CLIENT_SECRET;
      if (!clientID || !clientSecret) {
        console.warn(
          '[auth] GitHub provider not configured (missing GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET).',
        );
        return;
      }
      const callbackURL =
        process.env.GITHUB_CALLBACK_URL || `${BASE_URL}/auth/github/callback`;
      passport.use(
        new GitHubStrategy(
          {
            clientID,
            clientSecret,
            callbackURL,
            passReqToCallback: true,
            scope: ['read:user', 'user:email'],
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          makeVerifyCallback(normalizeGitHubProfile) as any,
        ),
      );
      REGISTERED_PROVIDERS.push('github');
    },
  },
  {
    name: 'google',
    register() {
      const clientID = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientID || !clientSecret) {
        console.warn(
          '[auth] Google provider not configured (missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).',
        );
        return;
      }
      const callbackURL =
        process.env.GOOGLE_CALLBACK_URL || `${BASE_URL}/auth/google/callback`;
      passport.use(
        new GoogleStrategy(
          {
            clientID,
            clientSecret,
            callbackURL,
            passReqToCallback: true,
            scope: ['profile', 'email'],
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          makeVerifyCallback(normalizeGoogleProfile) as any,
        ),
      );
      REGISTERED_PROVIDERS.push('google');
    },
  },
  {
    name: 'discord',
    register() {
      const clientID = process.env.DISCORD_CLIENT_ID;
      const clientSecret = process.env.DISCORD_CLIENT_SECRET;
      if (!clientID || !clientSecret) {
        console.warn(
          '[auth] Discord provider not configured (missing DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET).',
        );
        return;
      }
      const callbackURL =
        process.env.DISCORD_CALLBACK_URL || `${BASE_URL}/auth/discord/callback`;
      passport.use(
        new DiscordStrategy(
          {
            clientID,
            clientSecret,
            callbackURL,
            scope: ['identify', 'email'],
            passReqToCallback: true,
          },
          makeVerifyCallback(normalizeDiscordProfile),
        ),
      );
      REGISTERED_PROVIDERS.push('discord');
    },
  },
  {
    name: 'microsoft',
    register() {
      const clientID = process.env.MICROSOFT_CLIENT_ID;
      const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
      if (!clientID || !clientSecret) {
        console.warn(
          '[auth] Microsoft provider not configured (missing MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET).',
        );
        return;
      }
      const callbackURL =
        process.env.MICROSOFT_CALLBACK_URL || `${BASE_URL}/auth/microsoft/callback`;
      passport.use(
        new MicrosoftStrategy(
          {
            clientID,
            clientSecret,
            callbackURL,
            passReqToCallback: true,
            scope: ['user.read'],
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          makeVerifyCallback(normalizeMicrosoftProfile) as any,
        ),
      );
      REGISTERED_PROVIDERS.push('microsoft');
    },
  },
  {
    name: 'apple',
    register() {
      const clientID = process.env.APPLE_CLIENT_ID;
      const teamID = process.env.APPLE_TEAM_ID;
      const keyID = process.env.APPLE_KEY_ID;
      const privateKeyString = process.env.APPLE_PRIVATE_KEY;
      if (!clientID || !teamID || !keyID || !privateKeyString) {
        console.warn(
          '[auth] Apple provider not configured ' +
            '(missing APPLE_CLIENT_ID / APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY).',
        );
        return;
      }
      const callbackURL =
        process.env.APPLE_CALLBACK_URL || `${BASE_URL}/auth/apple/callback`;
      passport.use(
        new AppleStrategy(
          {
            clientID,
            teamID,
            keyID,
            privateKeyString,
            callbackURL,
            passReqToCallback: true,
            scope: ['name', 'email'],
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          makeAppleVerifyCallback() as any,
        ),
      );
      REGISTERED_PROVIDERS.push('apple');
    },
  },
];

export function registerAllProviders(): void {
  for (const config of PROVIDER_CONFIGS) {
    config.register();
  }
}

export function isProviderRegistered(provider: string): provider is ProviderName {
  return REGISTERED_PROVIDERS.includes(provider as ProviderName);
}
