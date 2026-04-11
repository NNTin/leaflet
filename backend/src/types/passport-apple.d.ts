// Type declarations for passport-apple (no @types package available).
// Apple's callback is unique: it passes an idToken (JWT) instead of a profile object.
declare module 'passport-apple' {
  import { Request } from 'express';

  export interface AppleStrategyOptions {
    clientID: string;
    teamID: string;
    keyID: string;
    /** Absolute filesystem path to the .p8 private key file. */
    privateKeyLocation?: string;
    /** PEM-formatted private key string (alternative to privateKeyLocation). */
    privateKeyString?: string;
    callbackURL: string;
    passReqToCallback?: boolean;
    scope?: string[];
    authorizationURL?: string;
    tokenURL?: string;
  }

  export type VerifyCallback = (err: Error | null, user?: Express.User | false, info?: object) => void;

  /**
   * Apple returns a JWT id_token as the third token argument.
   * The `profile` parameter is always `{}` — Apple does not include profile data
   * in the access token. Decode `idToken` with a JWT library to extract the user's
   * `sub` (the stable, unique Apple user ID) and `email`.
   */
  export type VerifyFunctionWithRequest = (
    req: Request,
    accessToken: string,
    refreshToken: string,
    idToken: string,
    profile: Record<string, never>,
    done: VerifyCallback
  ) => void;

  export type VerifyFunction = (
    accessToken: string,
    refreshToken: string,
    idToken: string,
    profile: Record<string, never>,
    done: VerifyCallback
  ) => void;

  export class Strategy {
    constructor(options: AppleStrategyOptions, verify: VerifyFunction | VerifyFunctionWithRequest);
    name: string;
    authenticate(req: Request, options?: object): void;
  }
}
