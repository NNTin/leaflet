import { User as AppUser } from '../models/user';

declare global {
  namespace Express {
    interface User extends AppUser {}
  }
}

declare module 'express-session' {
  interface SessionData {
    csrfToken?: string;
  }
}
