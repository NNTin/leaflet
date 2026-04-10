import { User as AppUser } from '../models/user';

declare global {
  namespace Express {
    interface User extends AppUser {}

    interface Request {
      apiKeyAuthenticated?: boolean;
    }
  }
}

declare module 'express-session' {
  interface SessionData {
    csrfToken?: string;
    oauthReturnTo?: string;
  }
}
