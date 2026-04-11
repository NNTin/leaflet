import { User as AppUser } from '../models/user';

interface PendingOAuth {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string | undefined;
  codeChallenge: string | null;
  codeChallengeMethod: string;
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
  }
}
