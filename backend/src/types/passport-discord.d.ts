// Type declarations for passport-discord (no @types package available).
declare module 'passport-discord' {
  import { Strategy as OAuth2Strategy } from 'passport-oauth2';
  import { Request } from 'express';

  export interface DiscordProfile {
    provider: 'discord';
    id: string;
    username: string;
    discriminator?: string;
    avatar?: string;
    email?: string;
    verified?: boolean;
    flags?: number;
    banner?: string;
    accent_color?: number;
    premium_type?: number;
    public_flags?: number;
    /** Set when passReqToCallback is true */
    fetchedAt?: Date;
    /** Set when passReqToCallback is true */
    accessToken?: string;
  }

  export interface StrategyOptions {
    clientID: string;
    clientSecret: string;
    callbackURL: string;
    scope?: string[];
    authorizationURL?: string;
    tokenURL?: string;
    scopeSeparator?: string;
    passReqToCallback?: false;
  }

  export interface StrategyOptionsWithRequest {
    clientID: string;
    clientSecret: string;
    callbackURL: string;
    scope?: string[];
    authorizationURL?: string;
    tokenURL?: string;
    scopeSeparator?: string;
    passReqToCallback: true;
  }

  export type VerifyCallback = (err: Error | null, user?: Express.User | false, info?: object) => void;

  export type VerifyFunction = (
    accessToken: string,
    refreshToken: string,
    profile: DiscordProfile,
    done: VerifyCallback
  ) => void;

  export type VerifyFunctionWithRequest = (
    req: Request,
    accessToken: string,
    refreshToken: string,
    profile: DiscordProfile,
    done: VerifyCallback
  ) => void;

  export class Strategy extends OAuth2Strategy {
    constructor(options: StrategyOptions, verify: VerifyFunction);
    constructor(options: StrategyOptionsWithRequest, verify: VerifyFunctionWithRequest);
    name: string;
  }
}
