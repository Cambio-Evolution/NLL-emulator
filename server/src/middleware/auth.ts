import { NextFunction, Request, Response, Router } from 'express';
import { randomUUID } from 'crypto';
import { pool } from '../db';
import { operationOutcome } from '../fhir/helpers';

const CLIENT_ID = process.env.MOCK_CLIENT_ID || 'nll-mock-client';
const CLIENT_SECRET = process.env.MOCK_CLIENT_SECRET || 'nll-mock-secret';
const TOKEN_TTL_SECONDS = 3600;

/**
 * Mock OAuth2 client_credentials token endpoint, so client applications
 * exercise the same "fetch token, send bearer" flow they will need against
 * E-hälsomyndigheten's real environments.
 *
 * POST /auth/token  (application/x-www-form-urlencoded)
 *   grant_type=client_credentials&client_id=...&client_secret=...
 */
export const tokenRouter = Router();

tokenRouter.post('/token', async (req: Request, res: Response) => {
  const { grant_type, client_id, client_secret } = req.body ?? {};
  if (grant_type !== 'client_credentials') {
    res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: 'Only client_credentials is supported by this mock',
    });
    return;
  }
  if (client_id !== CLIENT_ID || client_secret !== CLIENT_SECRET) {
    res.status(401).json({ error: 'invalid_client' });
    return;
  }
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);
  await pool.query(
    'INSERT INTO access_tokens (token, client_id, scope, expires_at) VALUES ($1, $2, $3, $4)',
    [token, client_id, 'nll/read', expiresAt]
  );
  res.json({
    access_token: token,
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_SECONDS,
    scope: 'nll/read',
  });
});

export async function requireBearer(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    res
      .status(401)
      .json(
        operationOutcome(
          'error',
          'security',
          'Missing Authorization: Bearer <token> header. Obtain a token from POST /auth/token.'
        )
      );
    return;
  }
  const { rows } = await pool.query(
    'SELECT client_id FROM access_tokens WHERE token = $1 AND expires_at > now()',
    [match[1]]
  );
  if (rows.length === 0) {
    res
      .status(401)
      .json(
        operationOutcome('error', 'expired', 'Access token is invalid or expired.')
      );
    return;
  }
  next();
}

/**
 * The real NLL API requires purpose-of-use and system identification headers.
 * The mock warns (but does not block) when they are missing, so a client can
 * be developed incrementally while still surfacing what production requires.
 */
export function nllHeaders(req: Request, res: Response, next: NextFunction): void {
  const missing: string[] = [];
  if (!req.headers['x-purpose-of-use']) missing.push('x-purpose-of-use');
  if (!req.headers['x-system-id']) missing.push('x-system-id');
  if (missing.length > 0) {
    res.setHeader(
      'x-nll-mock-warning',
      `Missing headers required by the real NLL API: ${missing.join(', ')}`
    );
  }
  next();
}
