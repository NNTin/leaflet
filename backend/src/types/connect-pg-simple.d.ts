declare module 'connect-pg-simple' {
  import session from 'express-session';
  function connectPgSimple(
    session: typeof import('express-session')
  ): new (options: {
    conString?: string;
    tableName?: string;
    createTableIfMissing?: boolean;
  }) => session.Store;
  export = connectPgSimple;
}
