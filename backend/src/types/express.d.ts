import { User as AppUser } from '../models/user';
import { ProviderName } from '../models/identity';

interface PendingOAuth {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string | undefined;
  codeChallenge: string | null;
  codeChallengeMethod: string;
}

interface LinkConflict {
  /** Provider that triggered the conflict. */
  provider: ProviderName;
  /** ID of the user that already owns the conflicting identity. */
  conflictingUserId: number;
}

interface PendingMerge {
  /** One-time token the client must echo back to confirm the merge. */
  token: string;
  /** The user to be dissolved into the currently logged-in user. */
  targetUserId: number;
  /** Unix timestamp (ms) after which the token is invalid. */
  expiresAt: number;
}

declare global {
  namespace Express {
    interface User extends AppUser {}

    interface Request {
      /** Set by earlyBearerAuthMiddleware when a valid OAuth 2.0 access token is presented. */
      oauthAuthenticated?: boolean;
      /** Set when a Bearer token was presented but rejected as invalid, expired, or revoked. */
      oauthTokenRejected?: boolean;
      /** OAuth client ID associated with the access token in use. */
      oauthClientId?: string;
      /** Scopes granted to the OAuth access token in use. */
      oauthScopes?: string[];
    }
  }
}

declare module 'express-session' {
  interface SessionData {
    csrfToken?: string;
    oauthReturnTo?: string;
    /** Temporary storage of a validated /oauth/authorize request pending user consent. */
    pendingOAuth?: PendingOAuth;
    /**
     * Set by the provider verify callback when a linking attempt conflicts with an
     * identity already owned by a different user.  Cleared on successful link or
     * successful merge.
     */
    linkConflict?: LinkConflict;
    /**
     * Set by POST /auth/merge/initiate.  The client must echo the token back in
     * POST /auth/merge/confirm to confirm the merge.
     */
    pendingMerge?: PendingMerge;
  }
}
