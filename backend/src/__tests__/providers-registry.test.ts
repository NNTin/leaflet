describe('registerAllProviders discord configuration', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('passes the option names expected by passport-discord-auth', () => {
    process.env = {
      ...originalEnv,
      GITHUB_CLIENT_ID: '',
      GITHUB_CLIENT_SECRET: '',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      MICROSOFT_CLIENT_ID: '',
      MICROSOFT_CLIENT_SECRET: '',
      APPLE_CLIENT_ID: '',
      APPLE_TEAM_ID: '',
      APPLE_KEY_ID: '',
      APPLE_PRIVATE_KEY: '',
      DISCORD_CLIENT_ID: 'discord-client-id',
      DISCORD_CLIENT_SECRET: 'discord-client-secret',
      DISCORD_CALLBACK_URL: 'https://example.com/auth/discord/callback',
    };

    const passportUse = jest.fn();
    const discordStrategy = jest.fn().mockImplementation(() => ({ name: 'discord' }));

    jest.doMock('passport', () => ({
      __esModule: true,
      default: { use: passportUse },
    }));
    jest.doMock('passport-discord', () => ({
      Strategy: discordStrategy,
    }));

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    jest.isolateModules(() => {
      const registry = require('../providers/registry') as typeof import('../providers/registry');
      registry.REGISTERED_PROVIDERS.length = 0;
      registry.registerAllProviders();
    });

    expect(discordStrategy).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'discord-client-id',
        clientSecret: 'discord-client-secret',
        callbackUrl: 'https://example.com/auth/discord/callback',
        scope: ['identify', 'email'],
        passReqToCallback: true,
      }),
      expect.any(Function),
    );
    expect(passportUse).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});
