import crypto from 'crypto';

/**
 * Verifies a PKCE code_verifier against a stored code_challenge.
 * Only S256 method is supported (plain is intentionally omitted for security).
 */
export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  if (computed.length !== codeChallenge.length) return false;

  return crypto.timingSafeEqual(
    Buffer.from(computed),
    Buffer.from(codeChallenge),
  );
}

/**
 * Computes the S256 code_challenge for a given verifier.
 * Exposed for use in tests and the CLI.
 */
export function computeCodeChallenge(codeVerifier: string): string {
  return crypto.createHash('sha256').update(codeVerifier).digest('base64url');
}
