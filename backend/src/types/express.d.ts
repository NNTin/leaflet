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
      apiKeyAuthenticated?: boolean;
      /** Set by earlyApiKeyMiddleware when a valid OAuth 2.0 access token is presented. */
      oauthAuthenticated?: boolean;
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
