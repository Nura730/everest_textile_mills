import jwt from 'jsonwebtoken';
import { getConfig } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

// Pinned on verify: a token claiming any other algorithm (including "none") is rejected.
export const JWT_ALGORITHM = 'HS256';
export const JWT_ISSUER = 'everest-backend';
export const JWT_AUDIENCE = 'everest-api';

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/;

/**
 * Payload is deliberately minimal: sub (user id) and tv (tokenVersion).
 * Role, name and email are NOT in the token: a JWT is readable by anyone, and the
 * database is the authority, so a role change takes effect on the very next request.
 */
export function signAccessToken(user) {
  const { jwtSecret, jwtExpiresIn } = getConfig();
  const token = jwt.sign({ tv: user.tokenVersion }, jwtSecret, {
    algorithm: JWT_ALGORITHM,
    expiresIn: jwtExpiresIn,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    subject: String(user._id),
  });
  const { exp } = jwt.decode(token);
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

function invalidToken(cause) {
  return new AppError('UNAUTHENTICATED', 'Invalid or missing authentication token', { cause });
}

/** Returns { userId, tokenVersion } or throws AppError UNAUTHENTICATED / TOKEN_EXPIRED. */
export function verifyAccessToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, getConfig().jwtSecret, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  } catch (err) {
    // jsonwebtoken checks the signature before exp, so only genuine tokens reach this branch.
    if (err.name === 'TokenExpiredError') {
      throw new AppError('TOKEN_EXPIRED', 'Session expired, please log in again', { cause: err });
    }
    throw invalidToken(err);
  }

  // A malformed sub must be a 401 here, not a CastError (400) later in findById.
  if (typeof payload.sub !== 'string' || !OBJECT_ID_PATTERN.test(payload.sub) || !Number.isInteger(payload.tv)) {
    throw invalidToken();
  }
  return { userId: payload.sub, tokenVersion: payload.tv };
}
